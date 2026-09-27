"""Evaluate mode + Advanced independent LLM (plan §10/§11/§65/§66/§47).

All providers are hermetic stubs — no LLM, no Typesafe, no emulator HTTP.
`compare-and-evaluate` = emulator + JEV + fidelity (existing) THEN the Judge
(§65 step 4). The independent prediction runs in the §65 parallel phase in
ANY mode when `advanced.independent_openai_prediction` is true, receiving ONLY
the original request (§11). The Judge NEVER sees it (§11 independence).
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.dependencies import (
    get_emulator_provider,
    get_independent_openai_provider,
    get_jev_provider,
    get_judge_provider,
    get_session,
)
from app.domain.executions.independent_openai import IndependentOpenaiPrediction, IndependentOpenaiProviderError
from app.domain.executions.jev import JevProviderError
from app.domain.executions.judge import JudgeOutcome, JudgeProviderError
from app.main import app
from app.persistence.database import Base
from app.persistence.repositories.executions import SQLAlchemyExecutionRepository
from app.providers.judge import build_judge_input
from app.schemas.judge_evaluation import JudgeEvaluation
from app.schemas.system_one_result import SystemOneResult

CANONICAL_SYSTEM_ONE = {
    "state": {"message": "I was charged twice on my invoice."},
    "questions": {
        "request_type": {
            "type": "choice",
            "instructions": "Classify this request.",
            "criteria": {
                "billing": "Billing issue",
                "technical": "Technical issue",
                "sales": "Sales request",
            },
        },
        "urgency": {"type": "score", "criteria": ["low", "medium", "high"]},
        "refund_requested": {"type": "noul"},
    },
}

SCORE_LEGEND = {"0": "low", "1": "medium", "2": "high"}

EMULATOR_RESULT = {
    "model": "jev-emulator",
    "answers": {
        "request_type": {
            "type": "choice",
            "choice": "billing",
            "confidence": 0.875,
            "probabilities": {"billing": 0.75, "technical": 0.125, "sales": 0.125},
        },
        "urgency": {
            "type": "score",
            "score": 1.5,
            "confidence": 0.75,
            "legend": SCORE_LEGEND,
            "probabilities": {"0": 0.125, "1": 0.625, "2": 0.25},
        },
        "refund_requested": {"type": "noul", "noul": 0.8125},
    },
    "usage": {"input_tokens": 120, "output_tokens": 45},
}

JEV_RESULT = {
    "model": "jev-latest",
    "answers": {
        "request_type": {
            "type": "choice",
            "choice": "billing",
            "confidence": 0.625,
            "probabilities": {"billing": 0.625, "technical": 0.125, "sales": 0.25},
        },
        "urgency": {
            "type": "score",
            "score": 1.0,
            "confidence": 0.625,
            "legend": SCORE_LEGEND,
            "probabilities": {"0": 0.25, "1": 0.5, "2": 0.25},
        },
        "refund_requested": {"type": "noul", "noul": 0.5625},
    },
    "usage": {"input_tokens": 210, "output_tokens": 64},
}

# Same answers as the emulator: aligned with BOTH sides on every question
# (noul 0.8125 and 0.5625 sit on the same side of .5; dominant level 1).
INDEPENDENT_RESULT = {
    "model": "gpt-4o-mini",
    "answers": {
        "request_type": {
            "type": "choice",
            "choice": "billing",
            "confidence": 0.875,
            "probabilities": {"billing": 0.75, "technical": 0.125, "sales": 0.125},
        },
        "urgency": {
            "type": "score",
            "score": 1.5,
            "confidence": 0.75,
            "legend": SCORE_LEGEND,
            "probabilities": {"0": 0.125, "1": 0.625, "2": 0.25},
        },
        "refund_requested": {"type": "noul", "noul": 0.8125},
    },
    "usage": {"input_tokens": 300, "output_tokens": 80},
}

INDEPENDENT_RUN_CONFIG = {
    "model": "gpt-4o-mini",
    "base_url": "https://api.openai.com/v1",
    "structured_outputs": True,
    "llm_answer_mode": "probabilities",
    "normalize_probabilities": True,
    "max_retries": 2,
    "n_retry_malformed_structure": 1,
    "timeout_seconds": 120.0,
    "retry_budget_seconds": 300.0,
    "api": "chat_completions",
    "temperature": None,
}

JUDGE_ANSWER = {
    "overall": {
        "prediction_quality": "mixed",
        "semantic_divergence": "minor",
        "summary": "Numeric differences leave the interpretation unchanged.",
    },
    "questions": {
        "request_type": {
            "emulator_support": "strong",
            "jev_support": "strong",
            "semantic_divergence": "none",
            "preferred": "tie",
            "reason": "Both select billing.",
        },
        "urgency": {
            "emulator_support": "partial",
            "jev_support": "partial",
            "semantic_divergence": "minor",
            "preferred": "tie",
            "reason": "Scores differ but stay in the medium band.",
        },
        "refund_requested": {
            "emulator_support": "partial",
            "jev_support": "weak",
            "semantic_divergence": "minor",
            "preferred": "emulator",
            "reason": "Both above .5 with different strength.",
        },
    },
}

JUDGE_RAW_RESPONSE = json.dumps(JUDGE_ANSWER)


class StubProvider:
    """Hermetic stand-in answering like a SystemOne provider."""

    def __init__(self, result: dict | None = None, error: Exception | None = None):
        self.result = SystemOneResult.model_validate(result) if result is not None else None
        self.error = error
        self.requests: list[dict] = []

    async def execute(self, request: dict):
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        return self.result


class StubIndependentProvider:
    """Hermetic stand-in for the Independent port."""

    def __init__(self, result: dict | None = None, error: Exception | None = None):
        self.prediction = (
            IndependentOpenaiPrediction(
                result=SystemOneResult.model_validate(result),
                llm_attempts=[{"messages": [], "debug_info": {"model_name": "gpt-4o-mini"}}],
                run_config=dict(INDEPENDENT_RUN_CONFIG),
            )
            if result is not None
            else None
        )
        self.error = error
        self.requests: list[dict] = []

    async def execute(self, request: dict):
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        return self.prediction


class StubJudgeProvider:
    """Hermetic stand-in for the Judge port; mirrors the real input contract."""

    def __init__(self, answer: dict | None = None, error: Exception | None = None):
        self.outcome = (
            JudgeOutcome(
                model="judge-llm",
                evaluation=JudgeEvaluation.model_validate(answer),
                judge_input={},
                output_schema=JudgeEvaluation.model_json_schema(),
                raw_response=JUDGE_RAW_RESPONSE,
                system_instruction="stub judge system instruction",
                configuration={"model": "judge-llm"},
            )
            if answer is not None
            else None
        )
        self.error = error
        self.calls: list[dict] = []

    async def evaluate(self, request, emulator_result, jev_result, comparison):
        self.calls.append(
            {
                "request": request,
                "emulator_result": emulator_result,
                "jev_result": jev_result,
                "comparison": comparison,
            }
        )
        if self.error is not None:
            raise self.error
        self.outcome = JudgeOutcome(
            model=self.outcome.model,
            evaluation=self.outcome.evaluation,
            judge_input=build_judge_input(request, emulator_result, jev_result, comparison),
            output_schema=self.outcome.output_schema,
            raw_response=self.outcome.raw_response,
            system_instruction=self.outcome.system_instruction,
            configuration=self.outcome.configuration,
        )
        return self.outcome


def stub_emulator(**kwargs):
    stub = StubProvider(result=kwargs.pop("result", EMULATOR_RESULT), **kwargs)
    app.dependency_overrides[get_emulator_provider] = lambda: stub
    return stub


def stub_jev(**kwargs):
    stub = StubProvider(result=kwargs.pop("result", JEV_RESULT), **kwargs)
    app.dependency_overrides[get_jev_provider] = lambda: stub
    return stub


def stub_independent(**kwargs):
    stub = StubIndependentProvider(**kwargs)
    app.dependency_overrides[get_independent_openai_provider] = lambda: stub
    return stub


def stub_judge(**kwargs):
    stub = StubJudgeProvider(**kwargs)
    app.dependency_overrides[get_judge_provider] = lambda: stub
    return stub


@pytest.fixture
def db_session(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'api.db'}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with SessionLocal() as session:
        yield session


@pytest.fixture
def client(db_session, monkeypatch):
    monkeypatch.delenv("AUTH_USER", raising=False)
    monkeypatch.delenv("AUTH_PASS", raising=False)

    def override_session():
        yield db_session

    app.dependency_overrides[get_session] = override_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def envelope(mode: str = "compare-and-evaluate", advanced: dict | None = None) -> dict:
    body = {"system_one": CANONICAL_SYSTEM_ONE, "mode": mode}
    if advanced is not None:
        body["advanced"] = advanced
    return body


def persisted_count(db_session) -> int:
    return len(SQLAlchemyExecutionRepository(db_session).list(limit=100).items)


def history_item(client, execution_id: str) -> dict:
    listing = client.get("/api/v1/executions")
    return next(i for i in listing.json()["items"] if i["execution_id"] == execution_id)


# --- Evaluate mode ------------------------------------------------------------


def test_evaluate_success_persists_the_full_47_snapshot_with_judge_sections(client):
    stub_emulator()
    stub_jev()
    judge = stub_judge(answer=JUDGE_ANSWER)

    response = client.post("/api/v1/executions", json=envelope())

    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["mode"] == "compare-and-evaluate"
    assert body["status"] == "completed"
    assert body["emulator"]["status"] == "success"
    assert body["jev"]["status"] == "success"
    assert body["comparison"]["overall_fidelity"] == 0.8125
    assert "independent_openai" not in body
    evaluation = body["ai_evaluation"]
    assert evaluation["status"] == "success"
    assert evaluation["model"] == "judge-llm"
    assert evaluation["overall"] == JUDGE_ANSWER["overall"]
    assert evaluation["questions"] == JUDGE_ANSWER["questions"]
    # §51: the Judge exchange evidence rides along.
    assert evaluation["evidence"]["raw_response"] == JUDGE_RAW_RESPONSE
    # §45: the Full LLM Exchange carries the system instruction and the
    # request configuration alongside input/schema/raw.
    assert evaluation["evidence"]["system_instruction"] == "stub judge system instruction"
    assert evaluation["evidence"]["configuration"] == {"model": "judge-llm"}
    assert evaluation["evidence"]["output_schema"] == JudgeEvaluation.model_json_schema()
    assert set(evaluation["evidence"]["input"]) == {
        "request",
        "emulator_result",
        "jev_result",
        "comparison",
    }
    # The judge received the executed results and the deterministic
    # comparison (§65 step 4, after fidelity).
    call = judge.calls[0]
    assert call["request"] == CANONICAL_SYSTEM_ONE
    assert call["emulator_result"].model == "jev-emulator"
    assert call["jev_result"].model == "jev-latest"
    assert call["comparison"]["overall_fidelity"] == 0.8125
    # The execution's semantic_divergence column comes from the judge.
    item = history_item(client, body["execution_id"])
    assert item["semantic_divergence"] == "minor"
    assert item["overall_fidelity"] == 0.8125
    assert item["aligned_questions"] == 3
    # 201 body is exactly the persisted snapshot.
    detail = client.get(f"/api/v1/executions/{body['execution_id']}")
    assert detail.json() == body


def test_judge_failure_is_a_66_partial_state_not_an_error(client):
    stub_emulator()
    stub_jev()
    stub_judge(error=JudgeProviderError(message="The LLM Judge returned HTTP 503.", status=503))

    response = client.post("/api/v1/executions", json=envelope())

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "completed"
    assert body["comparison"]["overall_fidelity"] == 0.8125
    assert body["ai_evaluation"] == {
        "status": "failed",
        "error": "The LLM Judge returned HTTP 503.",
    }
    # The summary column stays NULL while the judge is unavailable.
    item = history_item(client, body["execution_id"])
    assert item["semantic_divergence"] is None


def test_evaluate_with_jev_failure_has_no_comparison_and_no_ai_evaluation(client):
    # §66 JEV failure row: fidelity unavailable AND AI evaluation unavailable.
    stub_emulator()
    stub_jev(error=JevProviderError(message="The JEV returned HTTP 500.", status=500))
    judge = stub_judge(answer=JUDGE_ANSWER)

    response = client.post("/api/v1/executions", json=envelope())

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "completed"
    assert body["emulator"]["status"] == "success"
    assert body["jev"] == {"status": "failed", "error": "The JEV returned HTTP 500."}
    assert "comparison" not in body
    assert "ai_evaluation" not in body
    assert judge.calls == []
    item = history_item(client, body["execution_id"])
    assert item["semantic_divergence"] is None


# --- Advanced independent ------------------------------------------------------


def test_advanced_independent_in_compare_mode_persists_alignment_against_both_sides(client):
    emulator = stub_emulator()
    jev = stub_jev()
    independent = stub_independent(result=INDEPENDENT_RESULT)
    judge = stub_judge(answer=JUDGE_ANSWER)

    response = client.post(
        "/api/v1/executions",
        json=envelope(mode="compare", advanced={"independent_openai_prediction": True}),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["mode"] == "compare"
    section = body["independent_openai"]
    assert section["status"] == "success"
    assert section["model"] == "gpt-4o-mini"
    assert section["result"]["answers"]["request_type"]["choice"] == "billing"
    assert section["result"]["usage"] == {"input_tokens": 300, "output_tokens": 80}
    assert section["alignment"] == {
        "aligned": True,
        "questions": {
            "request_type": {"agrees_with_emulator": True, "agrees_with_jev": True},
            "urgency": {
                "agrees_with_emulator": True,
                "agrees_with_jev": True,
                "independent_dominant_level": "1",
            },
            "refund_requested": {"agrees_with_emulator": True, "agrees_with_jev": True},
        },
    }
    assert section["run_config"] == INDEPENDENT_RUN_CONFIG
    assert section["llm_attempts"] == [{"messages": [], "debug_info": {"model_name": "gpt-4o-mini"}}]
    # §11: the independent call received ONLY the original request.
    assert independent.requests == [CANONICAL_SYSTEM_ONE]
    # compare mode (not evaluate): no judge section at all.
    assert "ai_evaluation" not in body
    assert judge.calls == []
    assert emulator.requests == [CANONICAL_SYSTEM_ONE]
    assert jev.requests == [CANONICAL_SYSTEM_ONE]


def test_advanced_independent_in_emulator_mode_aligns_against_emulator_only(client):
    stub_emulator()
    jev = stub_jev()
    independent = stub_independent(result=INDEPENDENT_RESULT)

    response = client.post(
        "/api/v1/executions",
        json=envelope(mode="emulator", advanced={"independent_openai_prediction": True}),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["mode"] == "emulator"
    assert "jev" not in body
    assert "comparison" not in body
    section = body["independent_openai"]
    assert section["status"] == "success"
    assert section["alignment"]["aligned"] is True
    for question in section["alignment"]["questions"].values():
        # The JEV did not run: its flags are null, never guessed.
        assert question["agrees_with_jev"] is None
        assert question["agrees_with_emulator"] is True
    assert jev.requests == []
    assert independent.requests == [CANONICAL_SYSTEM_ONE]
    detail = client.get(f"/api/v1/executions/{body['execution_id']}")
    assert detail.json() == body


def test_advanced_independent_divergence_is_persisted_verbatim(client):
    diverged = json.loads(json.dumps(INDEPENDENT_RESULT))
    diverged["answers"]["request_type"]["choice"] = "technical"

    stub_emulator()
    stub_jev()
    stub_independent(result=diverged)

    response = client.post(
        "/api/v1/executions",
        json=envelope(mode="compare", advanced={"independent_openai_prediction": True}),
    )

    body = response.json()
    alignment = body["independent_openai"]["alignment"]
    assert alignment["aligned"] is False
    assert alignment["questions"]["request_type"] == {
        "agrees_with_emulator": False,
        "agrees_with_jev": False,
    }


def test_independent_failure_is_a_66_partial_state_everything_else_available(client):
    stub_emulator()
    stub_jev()
    stub_independent(error=IndependentOpenaiProviderError(message="The independent LLM prediction failed."))
    stub_judge(answer=JUDGE_ANSWER)

    response = client.post(
        "/api/v1/executions",
        json=envelope(advanced={"independent_openai_prediction": True}),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "completed"
    assert body["independent_openai"] == {
        "status": "failed",
        "error": "The independent LLM prediction failed.",
    }
    assert body["comparison"]["overall_fidelity"] == 0.8125
    assert body["ai_evaluation"]["status"] == "success"
    assert history_item(client, body["execution_id"])["semantic_divergence"] == "minor"


def test_independent_failure_in_emulator_mode_still_completes(client):
    stub_emulator()
    stub_independent(error=IndependentOpenaiProviderError(message="The independent LLM prediction failed."))

    response = client.post(
        "/api/v1/executions",
        json=envelope(mode="emulator", advanced={"independent_openai_prediction": True}),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "completed"
    assert body["emulator"]["status"] == "success"
    assert body["independent_openai"]["status"] == "failed"


def test_paid_independent_failure_persists_its_evidence_in_the_failed_section(client):
    # F4: a terminal adapter failure already cost tokens — the failed
    # §66 section must carry the run's own evidence (run_config + redacted
    # llm_attempts + retry_reasons) alongside the error, not discard it.
    stub_emulator()
    stub_jev()
    stub_independent(error=IndependentOpenaiProviderError(
        message="The independent LLM prediction failed.",
        run_config=dict(INDEPENDENT_RUN_CONFIG),
        llm_attempts=[
            {
                "messages": [],
                "request": {"headers": {"Authorization": "[REDACTED]"}},
                "debug_info": {"api_key": "[REDACTED]", "model_name": "gpt-4o-mini"},
            }
        ],
        retry_reasons=[["http_status", "500"]],
    ))
    stub_judge(answer=JUDGE_ANSWER)

    response = client.post(
        "/api/v1/executions",
        json=envelope(advanced={"independent_openai_prediction": True}),
    )

    assert response.status_code == 201
    section = response.json()["independent_openai"]
    assert section["status"] == "failed"
    assert section["error"] == "The independent LLM prediction failed."
    assert section["run_config"] == INDEPENDENT_RUN_CONFIG
    assert section["llm_attempts"][0]["request"]["headers"]["Authorization"] == "[REDACTED]"
    assert section["llm_attempts"][0]["debug_info"]["api_key"] == "[REDACTED]"
    assert section["retry_reasons"] == [["http_status", "500"]]
    # The evidence rides in the persisted snapshot, not just the 201 body.
    detail = client.get(f"/api/v1/executions/{response.json()['execution_id']}").json()
    assert detail["independent_openai"] == section


def test_advanced_false_does_not_run_the_independent_branch(client):
    stub_emulator()
    independent = stub_independent(result=INDEPENDENT_RESULT)

    response = client.post(
        "/api/v1/executions",
        json=envelope(mode="emulator", advanced={"independent_openai_prediction": False}),
    )

    assert response.status_code == 201
    assert "independent_openai" not in response.json()
    assert independent.requests == []


def test_judge_never_sees_independent_data(client):
    # §11 independence at the snapshot level: run evaluate + advanced and
    # verify the persisted Judge input evidence contains nothing from the
    # independent section (pinned by the marker model name).
    stub_emulator()
    stub_jev()
    stub_independent(result=INDEPENDENT_RESULT)
    stub_judge(answer=JUDGE_ANSWER)

    response = client.post(
        "/api/v1/executions",
        json=envelope(advanced={"independent_openai_prediction": True}),
    )

    assert response.status_code == 201
    evidence = response.json()["ai_evaluation"]["evidence"]
    assert "gpt-4o-mini" not in json.dumps(evidence)
    assert "independent" not in json.dumps(evidence).lower()
    assert set(evidence["input"]) == {"request", "emulator_result", "jev_result", "comparison"}


# --- Configuration preconditions -----------------------------------------------


def test_evaluate_without_openai_configured_returns_503_and_persists_nothing(client, db_session):
    emulator = stub_emulator()
    jev = stub_jev()
    app.dependency_overrides[get_judge_provider] = lambda: None

    response = client.post("/api/v1/executions", json=envelope())

    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["title"] == "LLM Not Configured"
    assert body["type"].endswith("/llm-not-configured")
    assert body["status"] == 503
    assert persisted_count(db_session) == 0
    assert emulator.requests == []
    assert jev.requests == []


def test_advanced_without_openai_configured_returns_503_and_persists_nothing(client, db_session):
    emulator = stub_emulator()
    app.dependency_overrides[get_independent_openai_provider] = lambda: None

    response = client.post(
        "/api/v1/executions",
        json=envelope(mode="emulator", advanced={"independent_openai_prediction": True}),
    )

    assert response.status_code == 503
    body = response.json()
    assert body["type"].endswith("/llm-not-configured")
    assert body["title"] == "LLM Not Configured"
    assert persisted_count(db_session) == 0
    assert emulator.requests == []


# --- Post-provider failure discipline ------------------------------------------


def test_unexpected_independent_exception_persists_first_then_500(client, db_session):
    stub_emulator()
    stub_independent(error=RuntimeError("independent provider bug"))

    response = client.post(
        "/api/v1/executions",
        json=envelope(mode="emulator", advanced={"independent_openai_prediction": True}),
    )

    assert response.status_code == 500
    problem = response.json()
    assert problem["type"].endswith("/internal-server-error")
    assert "independent provider bug" not in response.text
    detail = client.get(f"/api/v1/executions/{problem['execution_id']}")
    snapshot = detail.json()
    assert snapshot["status"] == "failed"
    assert snapshot["emulator"]["status"] == "success"
    assert snapshot["independent_openai"] == {"status": "failed", "error": "unexpected provider error"}
    assert persisted_count(db_session) == 1


def test_unexpected_judge_exception_persists_first_then_500(client, db_session):
    stub_emulator()
    stub_jev()
    stub_judge(error=RuntimeError("judge provider bug"))

    response = client.post("/api/v1/executions", json=envelope())

    assert response.status_code == 500
    problem = response.json()
    assert problem["type"].endswith("/internal-server-error")
    assert "judge provider bug" not in response.text
    detail = client.get(f"/api/v1/executions/{problem['execution_id']}")
    snapshot = detail.json()
    assert snapshot["status"] == "failed"
    assert snapshot["comparison"]["overall_fidelity"] == 0.8125
    assert "ai_evaluation" not in snapshot
    assert persisted_count(db_session) == 1


def test_emulator_failure_with_independent_success_keeps_evidence_without_alignment(client, db_session):
    # The run fails on the emulator (502, failed snapshot), but the
    # independent prediction SUCCEEDED concurrently: its §45 evidence
    # (result, run config, llm_attempts) must survive in the snapshot — with
    # NO alignment key, since there is no emulator side to align against.
    from app.domain.executions.emulator import EmulatorProviderError

    stub_emulator(error=EmulatorProviderError(message="The emulator returned HTTP 500.", status=500))
    stub_jev()
    stub_independent(result=INDEPENDENT_RESULT)

    response = client.post(
        "/api/v1/executions",
        json=envelope(mode="compare", advanced={"independent_openai_prediction": True}),
    )

    assert response.status_code == 502
    problem = response.json()
    snapshot = client.get(f"/api/v1/executions/{problem['execution_id']}").json()
    assert snapshot["status"] == "failed"
    assert snapshot["emulator"] == {"status": "failed", "error": "The emulator returned HTTP 500."}
    section = snapshot["independent_openai"]
    assert section["status"] == "success"
    assert section["model"] == "gpt-4o-mini"
    assert section["result"]["answers"]["request_type"]["choice"] == "billing"
    assert section["run_config"] == INDEPENDENT_RUN_CONFIG
    assert section["llm_attempts"]
    assert "alignment" not in section
    assert persisted_count(db_session) == 1

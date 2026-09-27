"""P28 (FB1): progressive streaming of execution results via SSE.

Content negotiation on POST /api/v1/executions: an `Accept` header carrying
`text/event-stream` opens a 201 SSE stream whose `section` frames land as the
§65 legs resolve (real completion order), closed by one terminal frame —
`final` with the complete §64 envelope for every run that is 201/completed
today (including §66 partials), or `error` with the same RFC 7807 problem the
JSON lane builds for post-provider failures (502/500). Everything else —
missing Accept, application/json, pre-stream 400/422/503 failures — behaves
EXACTLY like the JSON transport (§50: one code path, byte-identical
snapshots).

All providers are hermetic stubs — no LLM, no Typesafe, no emulator HTTP.
"""

import asyncio
import contextlib
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
from app.domain.executions.independent_openai import IndependentOpenaiPrediction
from app.domain.executions.judge import JudgeOutcome, JudgeProviderError
from app.domain.executions.models import Execution
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

SSE_ACCEPT = {"accept": "text/event-stream"}


class StubProvider:
    """Hermetic stand-in answering like a SystemOne provider.

    `delay` and `release` exist to pin the REAL completion order of the §65
    parallel phase in streaming tests (never a faked sequence).
    """

    def __init__(
        self,
        result: dict | None = None,
        error: Exception | None = None,
        delay: float = 0.0,
        release: asyncio.Event | None = None,
    ):
        self.result = SystemOneResult.model_validate(result) if result is not None else None
        self.error = error
        self.delay = delay
        self.release = release
        self.requests: list[dict] = []

    async def execute(self, request: dict):
        self.requests.append(request)
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.release is not None:
            await self.release.wait()
        if self.error is not None:
            raise self.error
        return self.result


class StubIndependentProvider:
    """Hermetic stand-in for the Independent port."""

    def __init__(self, result: dict | None = None, error: Exception | None = None, delay: float = 0.0):
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
        self.delay = delay
        self.requests: list[dict] = []

    async def execute(self, request: dict):
        self.requests.append(request)
        if self.delay:
            await asyncio.sleep(self.delay)
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
    stub = StubIndependentProvider(result=kwargs.pop("result", INDEPENDENT_RESULT), **kwargs)
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


def parse_frames(text: str) -> list[tuple[str | None, str | None]]:
    """Split an SSE body into (event, data) frames on blank-line separators.

    Mirrors the tolerant client contract: comment lines (leading ':') are
    ignored; each frame carries one event line and one data line.
    """
    frames: list[tuple[str | None, str | None]] = []
    for block in text.split("\n\n"):
        event: str | None = None
        data: str | None = None
        for line in block.split("\n"):
            if not line or line.startswith(":"):
                continue
            if line.startswith("event:"):
                event = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data = line[len("data:") :].lstrip()
        if event is not None or data is not None:
            frames.append((event, data))
    return frames


def stream_execution(client: TestClient, body: dict | str, headers: dict | None = None) -> tuple[int, dict, list]:
    """POST one execution asking for SSE; return status, headers, frames."""
    with client.stream(
        "POST",
        "/api/v1/executions",
        content=body if isinstance(body, str) else json.dumps(body),
        headers={"content-type": "application/json", **SSE_ACCEPT, **(headers or {})},
    ) as response:
        text = "".join(response.iter_text())
        return response.status_code, dict(response.headers), parse_frames(text)


def section_frames(frames: list[tuple[str | None, str | None]]) -> list[dict]:
    return [json.loads(data) for event, data in frames if event == "section"]


def terminal_frame(frames: list[tuple[str | None, str | None]], name: str) -> dict:
    matches = [json.loads(data) for event, data in frames if event == name]
    assert len(matches) == 1, f"expected exactly one '{name}' frame, got {len(matches)}"
    return matches[0]


# --- Content negotiation ------------------------------------------------------


def test_missing_accept_header_keeps_the_json_transport(client):
    stub_emulator()
    stub_jev()

    response = client.post("/api/v1/executions", json=envelope("compare"))

    assert response.status_code == 201
    assert response.headers["content-type"].startswith("application/json")
    assert response.headers["cache-control"] == "no-store"
    assert response.json()["mode"] == "compare"


def test_application_json_accept_keeps_the_json_transport(client):
    stub_emulator()
    stub_jev()

    response = client.post(
        "/api/v1/executions", json=envelope("compare"), headers={"accept": "application/json"}
    )

    assert response.status_code == 201
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["mode"] == "compare"


def test_sse_accept_opens_a_201_event_stream_with_negotiated_headers(client):
    stub_emulator()
    stub_jev()

    status, headers, frames = stream_execution(client, envelope("compare"))

    assert status == 201
    assert headers["content-type"] == "text/event-stream; charset=utf-8"
    # §13 default (no-store) is replaced on the SSE lane by stream-safe
    # directives: no caching and no intermediary transformation.
    assert headers["cache-control"] == "no-cache, no-transform"
    assert [event for event, _ in frames][-1] == "final"


# --- The stream itself --------------------------------------------------------


def test_sse_evaluate_run_streams_sections_in_real_completion_order(client):
    # The emulator is the SLOWEST leg of the §65 pair, so the pair lands as
    # jev -> emulator. P40: the comparison publishes the moment the pair
    # resolves (never waiting on the independent leg), then the independent
    # section (its outcome already resolved) publishes, and the judge —
    # started right after the comparison — closes the sections. The stream
    # must reflect that order, never a faked sequence.
    stub_emulator(delay=0.05)
    stub_jev()
    stub_independent()
    stub_judge(answer=JUDGE_ANSWER)

    status, _, frames = stream_execution(
        client, envelope("compare-and-evaluate", advanced={"independent_openai_prediction": True})
    )

    assert status == 201
    sections = section_frames(frames)
    assert [s["section"] for s in sections] == ["jev", "emulator", "comparison", "independent", "judge"]
    assert all(s["status"] == "success" for s in sections)

    # The terminal frame is the complete §64 envelope, exactly the document
    # the detail route serves for the persisted run (201/completed semantics,
    # §66 partials included).
    final = terminal_frame(frames, "final")
    detail = client.get(f"/api/v1/executions/{final['execution_id']}")
    assert detail.status_code == 200
    assert detail.json() == final
    assert final["status"] == "completed"

    # Each section frame's payload is byte-identical to the persisted section
    # (snapshot key independent_openai <-> SSE section independent; ai_evaluation
    # <-> judge).
    by_section = {s["section"]: s for s in sections}
    assert by_section["emulator"]["payload"] == final["emulator"]
    assert by_section["jev"]["payload"] == final["jev"]
    assert by_section["independent"]["payload"] == final["independent_openai"]
    assert by_section["comparison"]["payload"] == final["comparison"]
    assert by_section["judge"]["payload"] == final["ai_evaluation"]


def test_sse_slow_independent_does_not_delay_the_comparison_and_judge_runs_concurrent(client):
    # P40 central pin: the independent leg is the SLOWEST §65 leg (200ms)
    # while the pair is fast (jev 0ms, emulator 50ms). The comparison must
    # publish the moment the pair resolves — index 2, BEFORE the slow
    # independent's section — and the judge (started after the comparison)
    # resolves CONCURRENTLY with the still-flying independent, so its
    # section lands while the independent has not published yet.
    stub_emulator(delay=0.05)
    stub_jev()
    stub_independent(delay=0.2)
    stub_judge(answer=JUDGE_ANSWER)

    status, _, frames = stream_execution(
        client, envelope("compare-and-evaluate", advanced={"independent_openai_prediction": True})
    )

    assert status == 201
    sections = section_frames(frames)
    names = [s["section"] for s in sections]
    # The pair lands first in its REAL completion order (jev is faster here);
    # only its membership is pinned so emulator/jev stays order-free.
    assert set(names[:2]) == {"emulator", "jev"}
    assert names[2] == "comparison"
    # The judge resolved while the independent was still in flight (both run
    # concurrent after the comparison), and the independent closes the
    # section stream.
    assert names[3] == "judge"
    assert names[4] == "independent"
    assert all(s["status"] == "success" for s in sections)

    final = terminal_frame(frames, "final")
    assert final["status"] == "completed"
    assert final["mode"] == "compare-and-evaluate"
    # The completed snapshot carries every §47 section, byte-identical to
    # the streamed frames (snapshot key independent_openai <-> SSE section
    # independent; ai_evaluation <-> judge).
    by_section = {s["section"]: s for s in sections}
    assert by_section["comparison"]["payload"] == final["comparison"]
    assert by_section["independent"]["payload"] == final["independent_openai"]
    assert by_section["judge"]["payload"] == final["ai_evaluation"]


def test_sse_concurrent_judge_never_sees_the_independent_prediction(client):
    # P40 §11 pin: the judge now runs CONCURRENT with the independent leg,
    # which makes its blindness to that prediction load-bearing. Its input
    # evidence stays exactly the four §11-safe sections — request, both
    # results, comparison — with nothing from the independent prediction
    # (pinned by the marker model name), and it resolves before the delayed
    # independent publishes (the concurrency itself is observable).
    stub_emulator(delay=0.05)
    stub_jev()
    stub_independent(delay=0.2)
    judge = stub_judge(answer=JUDGE_ANSWER)

    status, _, frames = stream_execution(
        client, envelope("compare-and-evaluate", advanced={"independent_openai_prediction": True})
    )

    assert status == 201
    names = [s["section"] for s in section_frames(frames)]
    assert names.index("judge") < names.index("independent")
    # The port saw exactly one call, carrying only the §11-safe inputs.
    # (The stub records the typed SystemOneResult legs, so the dump renders
    # them through their pydantic model_dump for the marker scan.)
    assert len(judge.calls) == 1
    assert set(judge.calls[0]) == {"request", "emulator_result", "jev_result", "comparison"}
    dumped_calls = json.dumps(judge.calls, default=lambda o: o.model_dump(mode="json"))
    assert "gpt-4o-mini" not in dumped_calls
    assert "independent" not in dumped_calls.lower()
    # The streamed judge section's evidence input keeps the same four keys
    # (structural assert: the stub captures its inputs via build_judge_input).
    by_section = {s["section"]: s for s in section_frames(frames)}
    assert set(by_section["judge"]["payload"]["evidence"]["input"]) == {
        "request",
        "emulator_result",
        "jev_result",
        "comparison",
    }


def test_sse_emulator_mode_streams_emulator_and_final(client):
    stub_emulator()

    status, _, frames = stream_execution(client, envelope("emulator"))

    assert status == 201
    assert [s["section"] for s in section_frames(frames)] == ["emulator"]
    final = terminal_frame(frames, "final")
    assert final["mode"] == "emulator"
    assert final["status"] == "completed"


def test_sse_jev_partial_failure_streams_failed_jev_then_final_without_comparison(client):
    from app.domain.executions.jev import JevProviderError

    stub_emulator()
    stub_jev(error=JevProviderError(message="The JEV returned HTTP 503.", status=503))

    status, _, frames = stream_execution(client, envelope("compare"))

    assert status == 201
    sections = section_frames(frames)
    # §66 partial: the JEV section arrives as observed (failed) and the run
    # still completes — comparison is ABSENT because it needs both sides.
    assert [(s["section"], s["status"]) for s in sections] == [
        ("emulator", "success"),
        ("jev", "failed"),
    ]
    final = terminal_frame(frames, "final")
    assert final["status"] == "completed"
    assert final["jev"] == {"status": "failed", "error": "The JEV returned HTTP 503."}
    assert "comparison" not in final


def test_sse_judge_failure_streams_failed_judge_section_then_final(client):
    stub_emulator()
    stub_jev()
    stub_judge(error=JudgeProviderError(message="The Judge could not be reached."))

    status, _, frames = stream_execution(client, envelope("compare-and-evaluate"))

    assert status == 201
    sections = section_frames(frames)
    assert (sections[-1]["section"], sections[-1]["status"]) == ("judge", "failed")
    assert sections[-1]["payload"] == {"status": "failed", "error": "The Judge could not be reached."}
    final = terminal_frame(frames, "final")
    # §66 partial: AI evaluation unavailable, run completes (201 semantics).
    assert final["status"] == "completed"
    assert final["ai_evaluation"]["status"] == "failed"


def test_sse_independent_failure_still_completes_the_run(client):
    from app.domain.executions.independent_openai import IndependentOpenaiProviderError

    stub_emulator()
    stub_jev()
    stub_independent(error=IndependentOpenaiProviderError(message="The independent LLM prediction failed."))

    status, _, frames = stream_execution(
        client, envelope("compare", advanced={"independent_openai_prediction": True})
    )

    assert status == 201
    by_section = {s["section"]: s for s in section_frames(frames)}
    assert by_section["independent"]["status"] == "failed"
    final = terminal_frame(frames, "final")
    assert final["status"] == "completed"
    assert final["independent_openai"]["status"] == "failed"


# --- Terminal error frames (post-provider failures) ---------------------------


def test_sse_emulator_failure_yields_error_frame_and_never_final(client, db_session):
    from app.domain.executions.emulator import EmulatorProviderError

    # The emulator is slower, so the JEV section lands first (real order).
    stub_emulator(error=EmulatorProviderError(message="The emulator returned HTTP 500.", status=500), delay=0.05)
    stub_jev()

    status, _, frames = stream_execution(client, envelope("compare"))

    assert status == 201  # the stream itself opened successfully
    # Both legs are observed as sections (the JEV side succeeded concurrently).
    assert [(s["section"], s["status"]) for s in section_frames(frames)] == [
        ("jev", "success"),
        ("emulator", "failed"),
    ]
    problem = terminal_frame(frames, "error")
    # Mirrors the JSON lane's 502 problem shape verbatim (title/detail/status/
    # type + execution_id).
    assert problem["title"] == "Emulator Unavailable"
    assert problem["status"] == 502
    assert problem["type"].endswith("/emulator-unavailable")
    assert problem["detail"].startswith("The emulator returned HTTP 500.")
    assert problem["execution_id"].startswith("run_")
    # No final frame after an error, and the failed snapshot was persisted.
    assert all(event != "final" for event, _ in frames)
    detail = client.get(f"/api/v1/executions/{problem['execution_id']}")
    assert detail.json()["status"] == "failed"
    assert persisted_count(db_session) == 1


def test_sse_provider_bug_yields_internal_error_frame(client, db_session):
    stub_emulator(error=RuntimeError("provider bug"))
    stub_jev()

    status, _, frames = stream_execution(client, envelope("compare"))

    assert status == 201
    sections = section_frames(frames)
    by_section = {s["section"]: s for s in sections}
    assert by_section["emulator"]["payload"] == {"status": "failed", "error": "unexpected provider error"}
    problem = terminal_frame(frames, "error")
    assert problem["title"] == "Internal Server Error"
    assert problem["status"] == 500
    assert problem["type"].endswith("/internal-server-error")
    # The generic problem never echoes crash details.
    assert "provider bug" not in json.dumps(problem)
    assert all(event != "final" for event, _ in frames)
    assert persisted_count(db_session) == 1


def test_sse_comparison_failure_yields_internal_error_frame(client, db_session):
    # The JEV answers only one of the three questions, so the deterministic
    # comparison raises after both providers succeeded.
    stub_emulator()
    stub_jev(result={"model": "jev-latest", "answers": {"request_type": JEV_RESULT["answers"]["request_type"]}, "usage": {"input_tokens": 210, "output_tokens": 64}})

    status, _, frames = stream_execution(client, envelope("compare"))

    assert status == 201
    assert all(s["section"] != "comparison" for s in section_frames(frames))
    problem = terminal_frame(frames, "error")
    assert problem["status"] == 500
    assert problem["type"].endswith("/internal-server-error")
    assert all(event != "final" for event, _ in frames)
    detail = client.get(f"/api/v1/executions/{problem['execution_id']}")
    assert detail.json()["status"] == "failed"
    assert persisted_count(db_session) == 1


# --- Pre-stream errors stay RFC 7807 JSON (no stream is opened) ---------------


@pytest.mark.parametrize(
    ("body", "status", "problem_type"),
    [
        ("{not json", 400, "invalid-json"),
        ({"system_one": {"questions": {}}, "mode": "unknown-mode"}, 422, "validation-error"),
        ({"system_one": CANONICAL_SYSTEM_ONE, "mode": "emulator", "advanced": {"independent_openai_prediction": True}}, 503, "llm-not-configured"),
    ],
)
def test_sse_pre_stream_errors_return_the_same_json_problems(client, db_session, body, status, problem_type):
    stub_emulator()

    if isinstance(body, str):
        response = client.post(
            "/api/v1/executions", content=body, headers={"content-type": "application/json", **SSE_ACCEPT}
        )
    else:
        response = client.post("/api/v1/executions", json=body, headers=SSE_ACCEPT)

    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["type"].endswith(f"/{problem_type}")
    assert persisted_count(db_session) == 0


def test_sse_config_precondition_returns_json_problem_and_persists_nothing(client, db_session):
    stub_emulator()
    app.dependency_overrides[get_jev_provider] = lambda: None

    response = client.post("/api/v1/executions", json=envelope("compare"), headers=SSE_ACCEPT)

    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["type"].endswith("/jev-not-configured")
    assert persisted_count(db_session) == 0


# --- §50 snapshot invariants ---------------------------------------------------

# Keys that legitimately differ between two runs of the same fakes (identity,
# wall-clock and §61.4 timings): everything else — every section, mode, status
# and the comparison — must be IDENTICAL across transports.
VOLATILE_KEYS = ("execution_id", "created_at", "request_hash", "runtime", "provenance")


def normalized(snapshot: dict) -> dict:
    return {key: value for key, value in snapshot.items() if key not in VOLATILE_KEYS}


def test_sse_persists_the_same_snapshot_as_the_json_transport(client, db_session):
    # Same fakes, both transports: the persisted §47 snapshots must be
    # identical (§50/ADR-003 ruling 1 — one code path, one snapshot).
    stub_emulator()
    stub_jev()
    stub_independent()
    stub_judge(answer=JUDGE_ANSWER)
    body = envelope("compare-and-evaluate", advanced={"independent_openai_prediction": True})

    json_response = client.post("/api/v1/executions", json=body)
    assert json_response.status_code == 201

    _, _, frames = stream_execution(client, body)
    final = terminal_frame(frames, "final")

    assert normalized(json_response.json()) == normalized(final)
    # Exactly ONE snapshot per run in each transport.
    assert persisted_count(db_session) == 2


# --- Client-disconnect shielding (§50: evidence is never lost) ----------------


class RecordingRepository:
    """In-memory ExecutionRepository Protocol implementation for the
    disconnect test (the route-level generator is driven directly)."""

    def __init__(self) -> None:
        self.created: list[Execution] = []

    def create(self, execution: Execution) -> Execution:
        self.created.append(execution)
        return execution

    def get(self, execution_id: str) -> Execution | None:
        return next((e for e in self.created if e.execution_id == execution_id), None)

    def list(self, *, limit: int, cursor=None, request_hash=None, status=None):
        from app.domain.executions.models import ExecutionListItem, ExecutionPage

        return ExecutionPage(items=[ExecutionListItem(execution=e, cursor="") for e in self.created[:limit]], next_cursor=None)


def test_cancelling_the_stream_consumer_never_loses_the_snapshot():
    from app.api.routes.executions import stream_execution_events
    from app.schemas.execution_request import ExecutionRequestEnvelope

    release = asyncio.Event()
    emulator = StubProvider(result=EMULATOR_RESULT, release=release)  # blocked until released
    jev = StubProvider(result=JEV_RESULT)
    repo = RecordingRepository()
    envelope_model = ExecutionRequestEnvelope.model_validate(envelope("compare"))

    async def scenario() -> None:
        generator = stream_execution_events(
            repo=repo,
            emulator=emulator,
            jev=jev,
            judge=None,
            independent=None,
            envelope=envelope_model,
            request=None,
        )
        # The JEV leg completes immediately; the emulator leg is still blocked,
        # so the FIRST frame on the wire is the jev section.
        first = await generator.__anext__()
        assert first.startswith("event: section")
        assert '"section": "jev"' in first or '"section":"jev"' in first

        # The consumer goes away mid-run (client disconnect).
        consumer = asyncio.current_task()
        assert consumer is not None
        consumer.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await generator.__anext__()

        # The shielded run keeps going: release the emulator and wait for the
        # immutable snapshot to land (§50 — evidence must not be lost).
        release.set()
        for _ in range(500):
            if repo.created:
                break
            await asyncio.sleep(0.01)

    asyncio.run(scenario())

    assert len(repo.created) == 1
    persisted = repo.created[0]
    assert persisted.status == "completed"
    assert persisted.payload["emulator"]["status"] == "success"
    assert persisted.payload["jev"]["status"] == "success"
    assert "comparison" in persisted.payload


# --- Keep-alive cadence (dual-review finding 2): silent windows are real -----


def test_sse_stream_emits_keep_alive_comments_during_silent_windows(monkeypatch):
    """Mid-run silences (judge timeout 120s, independent retry budget 300s)
    must not look like a dead connection to idle-timeout intermediaries: the
    stream emits SSE comment frames on a cadence, which every consumer
    ignores by contract. Sections and the terminal frame are never delayed by
    the cadence — any resolved future wins the wait."""
    from app.api.routes import executions as routes_module
    from app.api.routes.executions import stream_execution_events
    from app.schemas.execution_request import ExecutionRequestEnvelope

    monkeypatch.setattr(routes_module, "SSE_KEEPALIVE_SECONDS", 0.02)

    release = asyncio.Event()
    emulator = StubProvider(result=EMULATOR_RESULT, release=release)
    jev = StubProvider(result=JEV_RESULT, release=release)
    repo = RecordingRepository()
    envelope_model = ExecutionRequestEnvelope.model_validate(envelope("compare"))

    async def scenario():
        generator = stream_execution_events(
            repo=repo,
            emulator=emulator,
            jev=jev,
            judge=None,
            independent=None,
            envelope=envelope_model,
            request=None,
        )
        # Both legs are gated: the first frames on the wire can only be
        # keep-alive comments (bounded waits prove the cadence fires).
        first = await asyncio.wait_for(generator.__anext__(), timeout=1.0)
        second = await asyncio.wait_for(generator.__anext__(), timeout=1.0)
        release.set()
        rest = [frame async for frame in generator]
        return first, second, rest

    first, second, rest = asyncio.run(scenario())

    assert first == ": keep-alive\n\n"
    assert second == ": keep-alive\n\n"
    # Once the legs resolve, real frames flow and the terminal frame is LAST
    # (the cadence never trails the stream).
    assert rest[-1].startswith("event: final")
    sections = [json.loads(f.split("data: ", 1)[1]) for f in rest if f.startswith("event: section")]
    assert {s["section"] for s in sections} == {"emulator", "jev", "comparison"}
    # §50: the run still persisted exactly one completed snapshot.
    assert len(repo.created) == 1
    assert repo.created[0].status == "completed"


# --- D6 pin (dual-review finding 9): unexpected judge exception -------------


def test_sse_judge_unexpected_exception_streams_no_judge_section_then_error(client, db_session):
    """The unexpected-exception judge branch persists NO ai_evaluation
    section (§66), so no judge section event may stream either — the terminal
    error frame speaks for the run. Regression pin for deviation D6."""
    stub_emulator()
    stub_jev()
    stub_judge(error=RuntimeError("judge crash"))

    status, _, frames = stream_execution(client, envelope("compare-and-evaluate"))

    assert status == 201
    sections = section_frames(frames)
    assert {s["section"] for s in sections} == {"emulator", "jev", "comparison"}
    assert all(s["section"] != "judge" for s in sections)
    problem = terminal_frame(frames, "error")
    assert problem["status"] == 500
    assert problem["type"].endswith("/internal-server-error")
    assert problem["execution_id"]
    # The generic problem never echoes crash details.
    assert "judge crash" not in json.dumps(problem)
    assert all(event != "final" for event, _ in frames)
    detail = client.get(f"/api/v1/executions/{problem['execution_id']}")
    assert detail.json()["status"] == "failed"
    assert "ai_evaluation" not in detail.json()
    assert persisted_count(db_session) == 1

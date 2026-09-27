"""Compare-mode execution flow (plan §10/§65/§66, snapshot §47).

All provider interactions are hermetic stubs — the real Typesafe API is
never called. Comparison expectations are hand-computed with dyadic
fractions so every assert is exact in binary floating point.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.dependencies import get_emulator_provider, get_jev_provider, get_session
from app.domain.executions.emulator import EmulatorProviderError
from app.domain.executions.jev import JevProviderError
from app.main import app
from app.persistence.database import Base
from app.persistence.repositories.executions import SQLAlchemyExecutionRepository
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

COMPARE_EMULATOR_RESULT = {
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

COMPARE_JEV_RESULT = {
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

# Hand-computed §24-§26 comparison for the fixtures above. All values are
# dyadic fractions and the sum (14/16 + 13/16 + 12/16 = 39/16) divides
# exactly by three, so the mean 13/16 is exact in binary floating point.
EXPECTED_COMPARISON = {
    "overall_fidelity": 0.8125,  # (0.875 + 0.8125 + 0.75) / 3
    "questions": {
        "request_type": {
            "primitive": "choice",
            "fidelity": 0.875,
            "aligned": True,
            "components": {
                "decision_match": True,
                "confidence_delta": 0.25,
                "distribution_similarity": 0.875,
            },
        },
        "urgency": {
            "primitive": "score",
            "fidelity": 0.8125,
            "aligned": True,
            "components": {
                "score_delta": 0.5,
                "max_score": 2,
                "score_similarity": 0.75,
                "distribution_similarity": 0.875,
                "confidence_delta": 0.125,
                "emulator_dominant_level": "1",
                "jev_dominant_level": "1",
            },
        },
        "refund_requested": {
            "primitive": "noul",
            "fidelity": 0.75,
            "aligned": True,
            # P38/FB11: the §26/§27 midpoint categories travel in the payload
            # (0.8125 and 0.5625 are both strictly above .5 — category 1).
            "components": {
                "probability_delta": 0.25,
                "emulator_midpoint_category": 1,
                "jev_midpoint_category": 1,
            },
        },
    },
}


class StubProvider:
    """Hermetic stand-in for a provider dependency (emulator or JEV)."""

    def __init__(self, result: dict | None = None, error: Exception | None = None):
        self.result = SystemOneResult.model_validate(result) if result is not None else None
        self.error = error
        self.requests: list[dict] = []

    async def execute(self, request: dict):
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        return self.result


def stub_emulator(result: dict | None = None, error: Exception | None = None) -> StubProvider:
    stub = StubProvider(result=result or COMPARE_EMULATOR_RESULT, error=error)
    app.dependency_overrides[get_emulator_provider] = lambda: stub
    return stub


def stub_jev(result: dict | None = None, error: Exception | None = None) -> StubProvider:
    stub = StubProvider(result=result or COMPARE_JEV_RESULT, error=error)
    app.dependency_overrides[get_jev_provider] = lambda: stub
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


def compare_envelope(system_one: dict = CANONICAL_SYSTEM_ONE, **extra) -> dict:
    return {"system_one": system_one, "mode": "compare"} | extra


def persisted_count(db_session) -> int:
    return len(SQLAlchemyExecutionRepository(db_session).list(limit=100).items)


def test_compare_success_persists_full_snapshot_with_exact_comparison(client):
    emulator = stub_emulator()
    jev = stub_jev()

    response = client.post("/api/v1/executions", json=compare_envelope())

    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["mode"] == "compare"
    assert body["status"] == "completed"
    assert body["emulator"]["status"] == "success"
    assert body["emulator"]["model"] == "jev-emulator"
    assert body["emulator"]["result"]["answers"]["request_type"] == COMPARE_EMULATOR_RESULT["answers"]["request_type"]
    assert body["jev"]["status"] == "success"
    assert body["jev"]["model"] == "jev-latest"
    assert body["jev"]["result"]["answers"]["urgency"] == COMPARE_JEV_RESULT["answers"]["urgency"]
    assert body["jev"]["result"]["usage"] == COMPARE_JEV_RESULT["usage"]
    assert body["comparison"] == EXPECTED_COMPARISON
    assert isinstance(body["runtime"]["duration_ms"], int)
    assert body["runtime"]["duration_ms"] >= 0
    # Both providers received the same canonical request document.
    assert emulator.requests == [CANONICAL_SYSTEM_ONE]
    assert jev.requests == [CANONICAL_SYSTEM_ONE]
    # The 201 body is exactly the snapshot served by the detail route.
    detail = client.get(f"/api/v1/executions/{body['execution_id']}")
    assert detail.status_code == 200
    assert detail.json() == body


def test_compare_success_appears_in_history_summary_with_fidelity(client):
    stub_emulator()
    stub_jev()

    created = client.post("/api/v1/executions", json=compare_envelope())
    listing = client.get("/api/v1/executions")

    assert listing.status_code == 200
    item = next(
        item for item in listing.json()["items"] if item["execution_id"] == created.json()["execution_id"]
    )
    assert item["mode"] == "compare"
    assert item["status"] == "completed"
    assert item["question_count"] == 3
    assert item["overall_fidelity"] == 0.8125
    assert item["aligned_questions"] == 3
    assert item["semantic_divergence"] is None  # STEP 6 owns the Judge


def test_compare_with_jev_unconfigured_returns_503_and_persists_nothing(client, db_session):
    emulator = stub_emulator()
    app.dependency_overrides[get_jev_provider] = lambda: None

    response = client.post("/api/v1/executions", json=compare_envelope())

    # ADR-003 ruling 4 pattern: a configuration precondition is not a run —
    # nothing is persisted and no provider is invoked.
    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["title"] == "JEV Not Configured"
    assert body["type"].endswith("/jev-not-configured")
    assert body["status"] == 503
    assert persisted_count(db_session) == 0
    assert emulator.requests == []


def test_compare_with_emulator_unconfigured_returns_503_and_persists_nothing(client, db_session):
    app.dependency_overrides[get_emulator_provider] = lambda: None
    jev = stub_jev()

    response = client.post("/api/v1/executions", json=compare_envelope())

    assert response.status_code == 503
    assert response.json()["type"].endswith("/emulator-not-configured")
    assert persisted_count(db_session) == 0
    assert jev.requests == []


def test_compare_jev_failure_returns_201_with_partial_snapshot(client):
    # §66 JEV failure is a persisted STATE, not an error: Emulator ok, JEV
    # failed, fidelity unavailable (no comparison section), snapshot completed.
    emulator = stub_emulator()
    jev = stub_jev(error=JevProviderError(message="The JEV returned HTTP 503.", status=503))

    response = client.post("/api/v1/executions", json=compare_envelope())

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "completed"
    assert body["emulator"]["status"] == "success"
    assert body["jev"] == {"status": "failed", "error": "The JEV returned HTTP 503."}
    assert "comparison" not in body
    assert isinstance(body["runtime"]["duration_ms"], int)
    # Concurrency: the JEV failure did not cancel the emulator run.
    assert emulator.requests == [CANONICAL_SYSTEM_ONE]
    assert jev.requests == [CANONICAL_SYSTEM_ONE]
    detail = client.get(f"/api/v1/executions/{body['execution_id']}")
    assert detail.json() == body
    # The partial run appears in history without fidelity values.
    listing = client.get("/api/v1/executions")
    item = next(i for i in listing.json()["items"] if i["execution_id"] == body["execution_id"])
    assert item["overall_fidelity"] is None
    assert item["aligned_questions"] is None


def test_compare_emulator_failure_returns_502_with_failed_snapshot(client):
    emulator = stub_emulator(error=EmulatorProviderError(message="The emulator returned HTTP 500.", status=500))
    jev = stub_jev()

    response = client.post("/api/v1/executions", json=compare_envelope())

    assert response.status_code == 502
    assert response.headers["content-type"].startswith("application/problem+json")
    problem = response.json()
    assert problem["title"] == "Emulator Unavailable"
    assert problem["type"].endswith("/emulator-unavailable")
    assert problem["execution_id"].startswith("run_")
    # The JEV side still ran concurrently and is recorded as observed.
    assert jev.requests == [CANONICAL_SYSTEM_ONE]
    detail = client.get(f"/api/v1/executions/{problem['execution_id']}")
    snapshot = detail.json()
    assert snapshot["status"] == "failed"
    assert snapshot["mode"] == "compare"
    assert snapshot["emulator"] == {"status": "failed", "error": "The emulator returned HTTP 500."}
    assert snapshot["jev"]["status"] == "success"
    assert "comparison" not in snapshot


def test_compare_both_providers_failing_returns_502_with_both_failed_sections(client):
    stub_emulator(error=EmulatorProviderError(message="The emulator could not be reached."))
    stub_jev(error=JevProviderError(message="The JEV did not respond within the timeout."))

    response = client.post("/api/v1/executions", json=compare_envelope())

    assert response.status_code == 502
    problem = response.json()
    detail = client.get(f"/api/v1/executions/{problem['execution_id']}")
    snapshot = detail.json()
    assert snapshot["status"] == "failed"
    assert snapshot["emulator"] == {"status": "failed", "error": "The emulator could not be reached."}
    assert snapshot["jev"] == {"status": "failed", "error": "The JEV did not respond within the timeout."}
    assert "comparison" not in snapshot


def test_compare_mode_is_reachable_while_evaluate_without_openai_stays_503(client, db_session):
    # STEP 6 made compare-and-evaluate real: without LLM configured it is a
    # configuration precondition (503 llm-not-configured, nothing persisted)
    # — no provider runs.
    emulator = stub_emulator()
    response = client.post(
        "/api/v1/executions",
        json={"system_one": CANONICAL_SYSTEM_ONE, "mode": "compare-and-evaluate"},
    )

    assert response.status_code == 503
    body = response.json()
    assert body["type"].endswith("/llm-not-configured")
    assert persisted_count(db_session) == 0
    assert emulator.requests == []


# --- Post-provider failures persist FIRST (revised ADR-004 ruling, B2) ---
#
# Both providers may succeed and the deterministic comparison still raise
# (FidelityComparisonError), or a provider may crash with an unexpected
# exception. In both cases the evidence is persisted before the 500 so the
# run stays inspectable through its execution_id.

# Parses through the mirror but answers only 2 of the 3 request questions,
# so the deterministic comparison raises FidelityComparisonError.
COMPARISON_FAILURE_JEV_RESULT = {
    "model": "jev-latest",
    "answers": {"request_type": COMPARE_JEV_RESULT["answers"]["request_type"]},
    "usage": {"input_tokens": 210, "output_tokens": 64},
}


def test_comparison_failure_returns_500_with_persisted_failed_snapshot(client, db_session):
    stub_emulator()
    stub_jev(result=COMPARISON_FAILURE_JEV_RESULT)

    response = client.post("/api/v1/executions", json=compare_envelope())

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.headers["cache-control"] == "no-store"
    problem = response.json()
    assert problem["title"] == "Internal Server Error"
    assert problem["type"].endswith("/internal-server-error")
    assert problem["status"] == 500
    # The problem stays generic: no comparison internals are ever echoed.
    assert problem["detail"] == "An unexpected error occurred."
    assert "refund_requested" not in response.text
    assert problem["execution_id"].startswith("run_")
    # The evidence was preserved: BOTH provider sections as observed, no
    # comparison section, status failed.
    detail = client.get(f"/api/v1/executions/{problem['execution_id']}")
    assert detail.status_code == 200
    snapshot = detail.json()
    assert snapshot["mode"] == "compare"
    assert snapshot["status"] == "failed"
    assert snapshot["emulator"]["status"] == "success"
    assert snapshot["jev"]["status"] == "success"
    assert snapshot["jev"]["model"] == "jev-latest"
    assert "comparison" not in snapshot
    assert persisted_count(db_session) == 1


@pytest.mark.parametrize("side", ["emulator", "jev"])
def test_unexpected_provider_exception_returns_500_with_persisted_failed_snapshot(
    client, db_session, side
):
    stub_emulator(error=RuntimeError("provider bug") if side == "emulator" else None)
    stub_jev(error=RuntimeError("provider bug") if side == "jev" else None)

    response = client.post("/api/v1/executions", json=compare_envelope())

    assert response.status_code == 500
    problem = response.json()
    assert problem["type"].endswith("/internal-server-error")
    assert problem["execution_id"].startswith("run_")
    assert "provider bug" not in response.text
    detail = client.get(f"/api/v1/executions/{problem['execution_id']}")
    snapshot = detail.json()
    assert snapshot["status"] == "failed"
    assert snapshot[side] == {"status": "failed", "error": "unexpected provider error"}
    other = "jev" if side == "emulator" else "emulator"
    assert snapshot[other]["status"] == "success"
    assert "comparison" not in snapshot
    assert persisted_count(db_session) == 1

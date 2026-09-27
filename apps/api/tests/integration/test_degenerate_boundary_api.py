"""Boundary pins for the degenerate provider-result family (dual-review B4).

End-to-end through the REAL route + REAL provider clients (MockTransport
fakes the wire): a degenerate provider result is rejected by the mirror at
parse time, becomes a provider error, and flows through §66 — it never
reaches fidelity. Also pins the 2-level rubric (maxScore=1) comparison and
the non-contiguous score-key 500.
"""

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.dependencies import get_emulator_provider, get_jev_provider, get_session
from app.main import app
from app.persistence.database import Base
from app.providers.emulator import EmulatorClient
from app.providers.jev import JevClient
from app.schemas.system_one_result import SystemOneResult

REQUEST = {"state": "s", "questions": {"ok": {"type": "noul"}}}

GOOD_EMULATOR_RESULT = {
    "model": "jev-emulator",
    "answers": {"ok": {"type": "noul", "noul": 0.75}},
    "usage": {"input_tokens": 10, "output_tokens": 5},
}

# The degenerate family member under test: a probability outside [0, 1].
# The wire body is well-formed JSON with the right shape — only the VALUE is
# degenerate, so only the mirror's parse-time constraints can catch it.
OUT_OF_RANGE_RESULT = {
    "model": "jev-emulator",
    "answers": {"ok": {"type": "noul", "noul": 1.5}},
    "usage": {"input_tokens": 10, "output_tokens": 5},
}


def json_handler(body: dict):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    return handler


class StubProvider:
    def __init__(self, result: dict):
        self.result = SystemOneResult.model_validate(result)

    async def execute(self, request: dict):
        return self.result


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


def test_out_of_range_probability_in_emulator_mode_persists_failed_502(client):
    # Real EmulatorClient: the mirror rejects noul=1.5 at parse time ->
    # EmulatorProviderError -> §66 failed snapshot + 502 with execution_id.
    app.dependency_overrides[get_emulator_provider] = lambda: EmulatorClient(
        base_url="https://emulator.test", transport=httpx.MockTransport(json_handler(OUT_OF_RANGE_RESULT))
    )

    response = client.post("/api/v1/executions", json={"system_one": REQUEST, "mode": "emulator"})

    assert response.status_code == 502
    problem = response.json()
    assert problem["type"].endswith("/emulator-unavailable")
    assert problem["execution_id"].startswith("run_")
    detail = client.get(f"/api/v1/executions/{problem['execution_id']}")
    snapshot = detail.json()
    assert snapshot["status"] == "failed"
    assert snapshot["mode"] == "emulator"
    assert snapshot["emulator"] == {"status": "failed", "error": "The emulator returned an unparsable result."}


def test_out_of_range_probability_from_jev_flows_to_66_partial_201(client):
    # Real JevClient on the JEV side: the mirror rejects the value at parse
    # time -> JevProviderError -> §66 JEV row = partial STATE (201, completed,
    # no comparison), never a fidelity run on degenerate numbers.
    app.dependency_overrides[get_emulator_provider] = lambda: EmulatorClient(
        base_url="https://emulator.test", transport=httpx.MockTransport(json_handler(GOOD_EMULATOR_RESULT))
    )
    app.dependency_overrides[get_jev_provider] = lambda: JevClient(
        base_url="https://api.typesafe.test",
        api_key="ts-key",
        transport=httpx.MockTransport(json_handler(OUT_OF_RANGE_RESULT)),
    )

    response = client.post("/api/v1/executions", json={"system_one": REQUEST, "mode": "compare"})

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "completed"
    assert body["emulator"]["status"] == "success"
    assert body["jev"] == {"status": "failed", "error": "The JEV returned an unparsable result."}
    assert "comparison" not in body


def test_two_level_rubric_compares_with_exact_values(client):
    # maxScore = len(criteria) - 1 = 1: the minimal rubric. Hand-computed
    # dyadic expectations:
    #   scoreSimilarity = 1 - min(|1.0-0.5|/1, 1) = 0.5
    #   TVD = 0.5 x (|0.25-0.5| + |0.75-0.5|) = 0.25 -> distribution 0.75
    #   fidelity = (0.5 + 0.75)/2 = 0.625
    #   dominant: emulator argmax "1"; JEV tie 0.5/0.5 -> first key "0"
    request = {"state": "s", "questions": {"yes_no": {"type": "score", "criteria": ["no", "yes"]}}}
    app.dependency_overrides[get_emulator_provider] = lambda: StubProvider(
        {
            "model": "jev-emulator",
            "answers": {
                "yes_no": {
                    "type": "score",
                    "score": 1.0,
                    "confidence": 0.75,
                    "legend": {"0": "no", "1": "yes"},
                    "probabilities": {"0": 0.25, "1": 0.75},
                }
            },
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
    )
    app.dependency_overrides[get_jev_provider] = lambda: StubProvider(
        {
            "model": "jev-latest",
            "answers": {
                "yes_no": {
                    "type": "score",
                    "score": 0.5,
                    "confidence": 0.5,
                    "legend": {"0": "no", "1": "yes"},
                    "probabilities": {"0": 0.5, "1": 0.5},
                }
            },
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
    )

    response = client.post("/api/v1/executions", json={"system_one": request, "mode": "compare"})

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "completed"
    assert body["comparison"] == {
        "overall_fidelity": 0.625,
        "questions": {
            "yes_no": {
                "primitive": "score",
                "fidelity": 0.625,
                "aligned": False,
                "components": {
                    "score_delta": 0.5,
                    "max_score": 1,
                    "score_similarity": 0.5,
                    "distribution_similarity": 0.75,
                    "confidence_delta": 0.25,
                    "emulator_dominant_level": "1",
                    "jev_dominant_level": "0",
                },
            }
        },
    }


def test_non_contiguous_score_keys_return_500_with_persisted_failed_snapshot(client):
    # Both results parse through the mirror, but the emulator distribution
    # skips level "1" (keys {"0","2"} on a 3-level rubric): fidelity rejects
    # the key set (ruling F3), the failed snapshot persists BOTH sections as
    # observed with NO comparison, and the 500 carries the execution_id.
    request = {"state": "s", "questions": {"urgency": {"type": "score", "criteria": ["low", "medium", "high"]}}}
    legend = {"0": "low", "1": "medium", "2": "high"}
    app.dependency_overrides[get_emulator_provider] = lambda: StubProvider(
        {
            "model": "jev-emulator",
            "answers": {
                "urgency": {
                    "type": "score",
                    "score": 1.5,
                    "confidence": 0.75,
                    "legend": legend,
                    "probabilities": {"0": 0.625, "2": 0.375},
                }
            },
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
    )
    app.dependency_overrides[get_jev_provider] = lambda: StubProvider(
        {
            "model": "jev-latest",
            "answers": {
                "urgency": {
                    "type": "score",
                    "score": 1.0,
                    "confidence": 0.5,
                    "legend": legend,
                    "probabilities": {"0": 0.25, "1": 0.5, "2": 0.25},
                }
            },
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
    )

    response = client.post("/api/v1/executions", json={"system_one": request, "mode": "compare"})

    assert response.status_code == 500
    problem = response.json()
    assert problem["type"].endswith("/internal-server-error")
    assert problem["execution_id"].startswith("run_")
    assert "urgency" not in response.text  # no comparison internals echoed
    detail = client.get(f"/api/v1/executions/{problem['execution_id']}")
    snapshot = detail.json()
    assert snapshot["status"] == "failed"
    assert snapshot["emulator"]["status"] == "success"
    assert snapshot["jev"]["status"] == "success"
    assert "comparison" not in snapshot

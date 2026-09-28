import base64
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.dependencies import get_emulator_provider
from app.domain.executions.emulator import EmulatorProviderError
from app.domain.executions.models import Execution, compute_request_hash
from app.main import app
from app.persistence.database import Base, get_session
from app.persistence.repositories.executions import SQLAlchemyExecutionRepository
from app.schemas.system_one_result import SystemOneResult


REQUEST = {
    "state": {"topic": "history"},
    "questions": {"ok": {"type": "noul", "criteria": {"true": None, "false": None}}},
}


def basic(user: str, password: str) -> str:
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    return f"Basic {token}"


def cursor_from_payload(payload: dict) -> str:
    raw = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def assert_invalid_cursor_problem(response) -> None:
    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["type"].endswith("/invalid-cursor")
    assert body["status"] == 400
    assert UUID(body["trace_id"], version=4).version == 4
    assert isinstance(body["ref"], int)


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


def make_execution(execution_id: str, created_at: datetime, status: str = "completed") -> Execution:
    return Execution.create(
        execution_id=execution_id,
        created_at=created_at,
        request=REQUEST,
        mode="compare-and-evaluate",
        status=status,
        payload={
            "comparison": {"overall_fidelity": 0.9, "questions": {}},
            "runtime": {"duration_ms": 184},
            "provenance": {
                "providers": [],
                "versions": {"application": "test-fixture"},
                "timings": {"total_ms": 184},
            },
        },
        overall_fidelity=0.9,
        aligned_questions=1,
        semantic_divergence="none",
        duration_ms=184,
    )


def seed(db_session, *executions: Execution) -> None:
    repo = SQLAlchemyExecutionRepository(db_session)
    for execution in executions:
        repo.create(execution)


def make_section_execution(execution_id: str, created_at: datetime, sections: dict, status: str = "completed") -> Execution:
    """Seed helper for §66 matrices: an execution whose payload carries the
    provider/judge sections at top level exactly as the application layer
    persists them (a section exists only when that leg ran)."""
    return Execution.create(
        execution_id=execution_id,
        created_at=created_at,
        request=REQUEST,
        mode="compare-and-evaluate",
        status=status,
        payload=dict(sections),
    )


def test_list_executions_is_cursor_paginated_newest_first_and_filterable(client, db_session):
    base = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    seed(
        db_session,
        make_execution("run_0001", base, status="completed"),
        make_execution("run_0002", base + timedelta(minutes=1), status="failed"),
        make_execution("run_0003", base + timedelta(minutes=2), status="completed"),
    )
    request_hash = SQLAlchemyExecutionRepository(db_session).get("run_0001").request_hash

    first = client.get("/api/v1/executions", params={"limit": 1, "status": "completed", "request_hash": request_hash})
    assert first.status_code == 200
    assert first.json()["items"][0]["execution_id"] == "run_0003"
    assert first.json()["items"][0]["duration_ms"] == 184
    assert first.json()["next_cursor"] is not None

    second = client.get(
        "/api/v1/executions",
        params={"limit": 1, "status": "completed", "request_hash": request_hash, "cursor": first.json()["next_cursor"]},
    )
    assert second.status_code == 200
    assert [item["execution_id"] for item in second.json()["items"]] == ["run_0001"]
    assert second.json()["next_cursor"] is None


def test_list_items_carry_operational_status_for_every_classification(client, db_session):
    # §66 single-sourced classification (J1/R2): the LIST API delivers
    # operational_status (completed|partial|failed) so the web renders it
    # verbatim and never re-derives partial from fidelity nulls.
    base = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    seed(
        db_session,
        make_section_execution(
            "run_full",
            base,
            {
                "emulator": {"status": "success"},
                "jev": {"status": "success"},
                "comparison": {"overall_fidelity": 0.95, "questions": {}},
                "ai_evaluation": {"status": "success"},
            },
        ),
        make_section_execution(
            "run_jev_partial",
            base + timedelta(minutes=1),
            {
                "emulator": {"status": "success"},
                "jev": {"status": "failed", "error": "The JEV returned HTTP 503."},
            },
        ),
        make_section_execution(
            "run_independent_partial",
            base + timedelta(minutes=2),
            {
                "emulator": {"status": "success"},
                "jev": {"status": "success"},
                "independent_openai": {"status": "failed", "error": "rate limit exceeded"},
                "comparison": {"overall_fidelity": 0.95, "questions": {}},
                "ai_evaluation": {"status": "success"},
            },
        ),
        make_section_execution(
            "run_judge_partial",
            base + timedelta(minutes=3),
            {
                "emulator": {"status": "success"},
                "jev": {"status": "success"},
                "comparison": {"overall_fidelity": 0.95, "questions": {}},
                "ai_evaluation": {"status": "failed", "error": "Judge schema parse failed"},
            },
        ),
        make_section_execution(
            "run_failed",
            base + timedelta(minutes=4),
            {"emulator": {"status": "failed", "error": "emulator crashed"}},
            status="failed",
        ),
    )

    response = client.get("/api/v1/executions", params={"limit": 10})

    assert response.status_code == 200
    by_id = {item["execution_id"]: item for item in response.json()["items"]}
    assert by_id["run_full"]["operational_status"] == "completed"
    # All three §66 partial matrices classify as partial — not only the JEV
    # fidelity-null signature the web used to infer.
    assert by_id["run_jev_partial"]["operational_status"] == "partial"
    assert by_id["run_independent_partial"]["operational_status"] == "partial"
    assert by_id["run_judge_partial"]["operational_status"] == "partial"
    # A failed run stays failed; the persisted status column is untouched.
    assert by_id["run_failed"]["operational_status"] == "failed"
    assert by_id["run_failed"]["status"] == "failed"
    assert by_id["run_jev_partial"]["status"] == "completed"


def test_list_items_operational_status_degrades_to_persisted_status_without_sections(client, db_session):
    # Old payloads without any section never invent a partial.
    base = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    seed(db_session, make_execution("run_legacy_ok", base))
    seed(db_session, make_execution("run_legacy_failed", base + timedelta(minutes=1), status="failed"))

    response = client.get("/api/v1/executions", params={"limit": 10})

    assert response.status_code == 200
    by_id = {item["execution_id"]: item for item in response.json()["items"]}
    assert by_id["run_legacy_ok"]["operational_status"] == "completed"
    assert by_id["run_legacy_failed"]["operational_status"] == "failed"


def test_list_executions_rejects_malformed_cursor_with_problem_details(client):
    response = client.get("/api/v1/executions", params={"cursor": "!!!"})

    assert_invalid_cursor_problem(response)


def test_list_executions_paginates_exactly_through_equal_created_at(client, db_session):
    # F8a: five executions sharing ONE created_at force the limit-2 pages to
    # break inside a tie. The history API must return every row exactly once
    # (no duplicates, no gaps), newest execution_id first, and terminate with
    # a null next_cursor.
    same_instant = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    seed(
        db_session,
        *(
            make_execution(f"run_{n:04d}", same_instant)
            for n in range(1, 6)
        ),
    )

    walked: list[str] = []
    cursor: str | None = None
    pages = 0
    while True:
        params = {"limit": 2}
        if cursor is not None:
            params["cursor"] = cursor
        response = client.get("/api/v1/executions", params=params)
        assert response.status_code == 200
        body = response.json()
        walked.extend(item["execution_id"] for item in body["items"])
        cursor = body["next_cursor"]
        pages += 1
        if cursor is None:
            break
        assert pages < 10, "pagination did not terminate"

    assert walked == ["run_0005", "run_0004", "run_0003", "run_0002", "run_0001"]
    assert len(walked) == len(set(walked))
    assert pages == 3


def test_list_executions_equal_created_at_order_is_deterministic_across_repeated_walks(client, db_session):
    # Same tie-heavy history walked twice: identical sequence both times.
    same_instant = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    seed(
        db_session,
        *(
            make_execution(f"run_{n:04d}", same_instant)
            for n in range(5, 0, -1)
        ),
    )

    def walk() -> list[str]:
        walked: list[str] = []
        cursor: str | None = None
        while True:
            params = {"limit": 2}
            if cursor is not None:
                params["cursor"] = cursor
            body = client.get("/api/v1/executions", params=params).json()
            walked.extend(item["execution_id"] for item in body["items"])
            cursor = body["next_cursor"]
            if cursor is None:
                return walked

    assert walk() == walk() == ["run_0005", "run_0004", "run_0003", "run_0002", "run_0001"]


def test_list_executions_rejects_base64_cursor_missing_required_keys(client):
    cursor = cursor_from_payload({"created_at": "2026-09-21T12:00:00+00:00"})

    response = client.get("/api/v1/executions", params={"cursor": cursor})

    assert_invalid_cursor_problem(response)


def test_get_execution_returns_full_snapshot_with_provenance(client, db_session):
    seed(db_session, make_execution("run_0001", datetime(2026, 9, 21, 12, 0, tzinfo=UTC)))

    response = client.get("/api/v1/executions/run_0001")

    assert response.status_code == 200
    body = response.json()
    assert body["execution_id"] == "run_0001"
    assert body["request"] == REQUEST
    assert body["provenance"] == {
        "providers": [],
        "versions": {"application": "test-fixture"},
        "timings": {"total_ms": 184},
    }


def test_get_execution_404_uses_existing_problem_details(client):
    response = client.get("/api/v1/executions/missing")

    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["type"].endswith("/not-found")
    assert UUID(body["trace_id"], version=4).version == 4
    assert isinstance(body["ref"], int)


def test_execution_detail_route_remains_behind_basic_auth(db_session, monkeypatch):
    seed(db_session, make_execution("run_secure", datetime(2026, 9, 21, 12, 0, tzinfo=UTC)))

    def override_session():
        yield db_session

    app.dependency_overrides[get_session] = override_session
    monkeypatch.setenv("AUTH_USER", "admin")
    monkeypatch.setenv("AUTH_PASS", "secret")
    try:
        anonymous = TestClient(app).get("/api/v1/executions/run_secure")
        authenticated = TestClient(app).get(
            "/api/v1/executions/run_secure",
            headers={"Authorization": basic("admin", "secret")},
        )
    finally:
        app.dependency_overrides.clear()

    assert anonymous.status_code == 401
    assert anonymous.headers["content-type"].startswith("application/problem+json")
    assert authenticated.status_code == 200
    assert authenticated.json()["execution_id"] == "run_secure"


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

EMULATOR_RESULT = {
    "model": "jev-emulator",
    "answers": {
        "request_type": {
            "type": "choice",
            "choice": "billing",
            "confidence": 0.92,
            "probabilities": {"billing": 0.92, "technical": 0.05, "sales": 0.03},
        },
        "urgency": {
            "type": "score",
            "score": 1.5,
            "confidence": 0.8,
            "legend": {"0": "low", "1": "medium", "2": "high"},
            "probabilities": {"0": 0.1, "1": 0.6, "2": 0.3},
        },
        "refund_requested": {"type": "noul", "noul": 0.87},
    },
    "usage": {"input_tokens": 120, "output_tokens": 45},
}

MIRROR_INTERNAL_FRAGMENTS = (
    "NoulQuestion",
    "ChoiceQuestion",
    "ScoreQuestion",
    "dict[str,any]",
    "list[any]",
)


class StubEmulator:
    """Hermetic stand-in for the emulator provider dependency."""

    def __init__(self, result: SystemOneResult | None = None, error: EmulatorProviderError | None = None):
        self.result = result if result is not None else SystemOneResult.model_validate(EMULATOR_RESULT)
        self.error = error
        self.requests: list[dict] = []

    async def execute(self, request: dict) -> SystemOneResult:
        self.requests.append(request)
        if self.error is not None:
            raise self.error
        return self.result


def use_emulator(stub: StubEmulator) -> StubEmulator:
    app.dependency_overrides[get_emulator_provider] = lambda: stub
    return stub


def emulator_envelope(system_one: dict, **extra) -> dict:
    return {"system_one": system_one, "mode": "emulator"} | extra


def test_create_execution_emulator_mode_persists_and_returns_snapshot(client):
    stub = use_emulator(StubEmulator())

    response = client.post("/api/v1/executions", json=emulator_envelope(CANONICAL_SYSTEM_ONE))

    assert response.status_code == 201
    body = response.json()
    assert body["execution_id"].startswith("run_")
    assert body["created_at"]
    assert body["mode"] == "emulator"
    assert body["status"] == "completed"
    assert body["request_hash"] == compute_request_hash(CANONICAL_SYSTEM_ONE)
    # §47 conformance: duration lives ONLY inside runtime.duration_ms; the
    # top-level duplicate was removed (the history summary keeps its own copy
    # via the domain field, not the payload).
    assert isinstance(body["runtime"]["duration_ms"], int)
    assert body["runtime"]["duration_ms"] >= 0
    assert "duration_ms" not in body
    assert body["request"] == CANONICAL_SYSTEM_ONE
    emulator = body["emulator"]
    assert emulator["status"] == "success"
    assert emulator["model"] == "jev-emulator"
    answers = emulator["result"]["answers"]
    assert answers["request_type"] == EMULATOR_RESULT["answers"]["request_type"]
    assert answers["urgency"] == EMULATOR_RESULT["answers"]["urgency"]
    assert answers["refund_requested"] == EMULATOR_RESULT["answers"]["refund_requested"]
    assert emulator["result"]["usage"] == EMULATOR_RESULT["usage"]
    # The provider received the raw validated system_one document.
    assert stub.requests == [CANONICAL_SYSTEM_ONE]
    # The 201 body is the very snapshot served by the history detail route,
    # so the web can reuse either.
    detail = client.get(f"/api/v1/executions/{body['execution_id']}")
    assert detail.status_code == 200
    assert detail.json() == body


def test_create_execution_same_request_creates_new_execution_id(client):
    use_emulator(StubEmulator())

    first = client.post("/api/v1/executions", json=emulator_envelope(CANONICAL_SYSTEM_ONE))
    second = client.post("/api/v1/executions", json=emulator_envelope(CANONICAL_SYSTEM_ONE))

    assert first.status_code == second.status_code == 201
    assert first.json()["request_hash"] == second.json()["request_hash"]
    assert first.json()["execution_id"] != second.json()["execution_id"]


def test_create_execution_emulator_failure_persists_failed_run_and_returns_502(client):
    use_emulator(
        StubEmulator(error=EmulatorProviderError(message="The emulator returned HTTP 503.", status=503))
    )

    response = client.post("/api/v1/executions", json=emulator_envelope(CANONICAL_SYSTEM_ONE))

    assert response.status_code == 502
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["title"] == "Emulator Unavailable"
    assert body["type"].endswith("/emulator-unavailable")
    assert body["status"] == 502
    # The failed run stays inspectable through its execution_id.
    assert body["execution_id"].startswith("run_")
    detail = client.get(f"/api/v1/executions/{body['execution_id']}")
    assert detail.status_code == 200
    snapshot = detail.json()
    assert snapshot["status"] == "failed"
    assert snapshot["mode"] == "emulator"
    assert snapshot["emulator"]["status"] == "failed"
    assert snapshot["request"] == CANONICAL_SYSTEM_ONE


def test_create_execution_without_configured_emulator_returns_503(client):
    app.dependency_overrides[get_emulator_provider] = lambda: None

    response = client.post("/api/v1/executions", json=emulator_envelope(CANONICAL_SYSTEM_ONE))

    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["type"].endswith("/emulator-not-configured")
    assert body["status"] == 503


def persisted_count(db_session) -> int:
    return len(SQLAlchemyExecutionRepository(db_session).list(limit=100).items)


def test_openai_precondition_failure_persists_no_execution(client, db_session):
    # ADR-001 persistence boundary: snapshots exist only for executions that
    # actually ran. STEP 6 made compare-and-evaluate real: without LLM
    # configured the §65 order raises the 503 precondition before any
    # provider call, so no row may be written.
    assert persisted_count(db_session) == 0

    response = client.post(
        "/api/v1/executions",
        json={"system_one": CANONICAL_SYSTEM_ONE, "mode": "compare-and-evaluate"},
    )

    assert response.status_code == 503
    assert response.json()["type"].endswith("/llm-not-configured")
    assert persisted_count(db_session) == 0


def test_emulator_not_configured_failure_persists_no_execution(client, db_session):
    # Same boundary: a 503 configuration problem happens before the provider
    # or the repository is touched.
    app.dependency_overrides[get_emulator_provider] = lambda: None
    assert persisted_count(db_session) == 0

    response = client.post("/api/v1/executions", json=emulator_envelope(CANONICAL_SYSTEM_ONE))

    assert response.status_code == 503
    assert persisted_count(db_session) == 0


def test_invalid_system_one_failure_persists_no_execution(client, db_session):
    # §65 step 1 rejects the canonical request before execution; nothing is
    # persisted from an unparseable payload.
    assert persisted_count(db_session) == 0

    response = client.post(
        "/api/v1/executions",
        json=emulator_envelope({"state": "x", "questions": {"q": {"type": "classification"}}}),
    )

    assert response.status_code == 422
    assert persisted_count(db_session) == 0


def test_compare_and_evaluate_without_openai_returns_503_precondition(client):
    # STEP 6: the mode is real; its LLM precondition is honest about what
    # is missing instead of a phase-gap 501.
    response = client.post(
        "/api/v1/executions",
        json={"system_one": CANONICAL_SYSTEM_ONE, "mode": "compare-and-evaluate"},
    )

    assert response.status_code == 503
    body = response.json()
    assert body["title"] == "LLM Not Configured"
    assert body["detail"] == (
        "The LLM integration is not configured. Configure the Judge and "
        "Independent providers in Settings (or the OPENAI_* environment "
        "variables) to run LLM executions."
    )


def test_advanced_independent_openai_without_openai_returns_503_even_in_emulator_mode(client):
    response = client.post(
        "/api/v1/executions",
        json=emulator_envelope(
            CANONICAL_SYSTEM_ONE, advanced={"independent_openai_prediction": True}
        ),
    )

    assert response.status_code == 503
    body = response.json()
    assert body["type"].endswith("/llm-not-configured")
    assert body["title"] == "LLM Not Configured"


def test_unknown_question_type_returns_422_with_domain_copy(client):
    # The R17 fix-forward consumed by STEP 4: the plan §7 domain copy reaches
    # the HTTP client verbatim.
    response = client.post(
        "/api/v1/executions",
        json=emulator_envelope(
            {"state": "x", "questions": {"request_type": {"type": "classification"}}}
        ),
    )

    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["title"] == "Unsupported question type"
    assert body["detail"] == (
        "Question 'request_type' has unsupported type 'classification'. "
        "Expected: choice | score | noul."
    )
    assert UUID(body["trace_id"], version=4).version == 4
    serialized = json.dumps(body)
    for fragment in MIRROR_INTERNAL_FRAGMENTS:
        assert fragment not in serialized


def test_model_null_inside_system_one_returns_422_with_domain_detail(client):
    response = client.post(
        "/api/v1/executions",
        json=emulator_envelope(CANONICAL_SYSTEM_ONE | {"model": None}),
    )

    assert response.status_code == 422
    body = response.json()
    assert body["title"] == "Invalid SystemOneRequest"
    assert "at 'model'." in body["detail"]


def test_envelope_validation_problem_is_sanitized(client):
    # A bare SystemOneRequest is not a §64 envelope: the 422 problem's
    # errors[] must never publish mirror internals (union branch tags) nor
    # echo the raw payload (the 'input' key).
    response = client.post("/api/v1/executions", json={"state": "x", "questions": {}})

    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["title"] == "Validation Error"
    assert body["type"].endswith("/validation-error")
    assert UUID(body["trace_id"], version=4).version == 4
    serialized = json.dumps(body)
    for fragment in MIRROR_INTERNAL_FRAGMENTS:
        assert fragment not in serialized
    assert body["errors"]
    for error in body["errors"]:
        assert "input" not in error
    assert ("system_one",) in [tuple(error["loc"]) for error in body["errors"]]
    assert ("mode",) in [tuple(error["loc"]) for error in body["errors"]]


def test_envelope_rejects_unknown_mode_value_with_sanitized_problem(client):
    response = client.post(
        "/api/v1/executions",
        json={"system_one": CANONICAL_SYSTEM_ONE, "mode": "fast"},
    )

    assert response.status_code == 422
    body = response.json()
    assert body["type"].endswith("/validation-error")
    assert ("mode",) in [tuple(error["loc"]) for error in body["errors"]]
    for error in body["errors"]:
        assert "input" not in error


def test_envelope_rejects_explicit_advanced_null_with_sanitized_problem(client):
    # The wire schema rejects "advanced": null; only omission means disabled.
    response = client.post(
        "/api/v1/executions",
        json=emulator_envelope(CANONICAL_SYSTEM_ONE, advanced=None),
    )

    assert response.status_code == 422
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["type"].endswith("/validation-error")
    assert ("advanced",) in [tuple(error["loc"]) for error in body["errors"]]
    for error in body["errors"]:
        assert "input" not in error


def test_malformed_json_body_returns_400_problem(client):
    response = client.post("/api/v1/executions", content=b"{not json")

    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["type"].endswith("/invalid-json")
    assert body["status"] == 400


def test_history_routes_remain_behind_basic_auth(db_session, monkeypatch):
    def override_session():
        yield db_session

    app.dependency_overrides[get_session] = override_session
    monkeypatch.setenv("AUTH_USER", "admin")
    monkeypatch.setenv("AUTH_PASS", "secret")
    try:
        anonymous = TestClient(app).get("/api/v1/executions")
        authenticated = TestClient(app).get(
            "/api/v1/executions",
            headers={"Authorization": basic("admin", "secret")},
        )
    finally:
        app.dependency_overrides.clear()

    assert anonymous.status_code == 401
    assert authenticated.status_code == 200


def test_execution_success_responses_carry_no_store_cache_control(client, db_session):
    # Plan §13: execution documents are dynamic per-run snapshots and must
    # never be cached — on all three endpoints (POST create, GET list, GET
    # detail) alike. The web proxy forwards this header back to browsers.
    use_emulator(StubEmulator())

    created = client.post("/api/v1/executions", json=emulator_envelope(CANONICAL_SYSTEM_ONE))
    assert created.status_code == 201
    assert created.headers["cache-control"] == "no-store"

    listing = client.get("/api/v1/executions")
    assert listing.status_code == 200
    assert listing.headers["cache-control"] == "no-store"

    detail = client.get(f"/api/v1/executions/{created.json()['execution_id']}")
    assert detail.status_code == 200
    assert detail.headers["cache-control"] == "no-store"


def test_execution_problem_responses_carry_no_store_cache_control(client):
    use_emulator(
        StubEmulator(error=EmulatorProviderError(message="The emulator returned HTTP 503.", status=503))
    )

    unprocessable = client.post("/api/v1/executions", json={"state": "x", "questions": {}})
    assert unprocessable.status_code == 422
    assert unprocessable.headers["cache-control"] == "no-store"

    unavailable = client.post("/api/v1/executions", json=emulator_envelope(CANONICAL_SYSTEM_ONE))
    assert unavailable.status_code == 502
    assert unavailable.headers["cache-control"] == "no-store"

    not_found = client.get("/api/v1/executions/missing")
    assert not_found.status_code == 404
    assert not_found.headers["cache-control"] == "no-store"


def test_execution_auth_rejection_carries_no_store_cache_control(monkeypatch):
    # S1 pin: the 401 from BasicAuthMiddleware on executions paths carries the
    # §13 header only because of middleware add-order — pin it so a future
    # reorder cannot silently strip it.
    monkeypatch.setenv("AUTH_USER", "admin")
    monkeypatch.setenv("AUTH_PASS", "secret")
    anonymous = TestClient(app).get("/api/v1/executions")
    assert anonymous.status_code == 401
    assert anonymous.headers["cache-control"] == "no-store"


def test_execution_unhandled_500_carries_no_store_cache_control(client):
    # W1 pin: the unhandled-exception handler runs in ServerErrorMiddleware,
    # OUTSIDE NoStoreCacheMiddleware, so its 500 problem must set the §13
    # header itself on executions paths.
    def explode():
        raise RuntimeError("boom")

    app.dependency_overrides[get_emulator_provider] = explode
    try:
        # raise_server_exceptions=False lets the registered Exception handler
        # produce the 500 problem instead of re-raising into the test.
        client = TestClient(app, raise_server_exceptions=False)
        response = client.post("/api/v1/executions", json=emulator_envelope(CANONICAL_SYSTEM_ONE))
    finally:
        app.dependency_overrides.pop(get_emulator_provider, None)

    assert response.status_code == 500
    assert response.headers["cache-control"] == "no-store"


def test_non_execution_routes_do_not_carry_no_store_cache_control(client):
    # The no-store ruling is scoped to executions (plan §13); the operational
    # endpoints stay untouched so infrastructure probes may cache them.
    for path in ("/health", "/ready", "/api/v1/capabilities"):
        response = client.get(path)
        assert response.headers.get("cache-control") != "no-store"

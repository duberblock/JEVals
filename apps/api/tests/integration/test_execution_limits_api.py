"""Admission control on POST /api/v1/executions (body cap + rate/concurrency).

Hermetic: the emulator is a stub; every ceiling comes from Settings via
monkeypatched env. Only VALID envelopes consume a run slot — invalid JSON
and oversized bodies must never drain the budget.
"""

import json
import threading

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.api.dependencies import get_emulator_provider, get_session
from app.core.config import get_settings
from app.core.limits import reset_execution_limits
from app.main import app
from app.persistence.database import Base
from app.schemas.system_one_result import SystemOneResult

ENVELOPE = {
    "system_one": {
        "state": {"message": "I was charged twice on my invoice."},
        "questions": {"ok": {"type": "noul"}},
    },
    "mode": "emulator",
}

STUB_RESULT = {
    "model": "jev-emulator",
    "answers": {"ok": {"type": "noul", "noul": 0.5}},
    "usage": {"input_tokens": 10, "output_tokens": 5},
}


class StubEmulator:
    """Hermetic emulator leg; a threading blocker holds the run in flight
    across event loops (set from the test thread, awaited via to_thread)."""

    def __init__(self, blocker: threading.Event | None = None):
        import asyncio

        self._asyncio = asyncio
        self._blocker = blocker

    async def execute(self, request: dict):
        if self._blocker is not None:
            await self._asyncio.to_thread(self._blocker.wait)
        return SystemOneResult.model_validate(STUB_RESULT)

    async def aclose(self) -> None:
        pass


@pytest.fixture(autouse=True)
def hermetic_limits(monkeypatch):
    """Fresh admission state and settings around every test."""
    for name in (
        "MAX_EXECUTION_REQUEST_BYTES",
        "MAX_CONCURRENT_EXECUTIONS",
        "MAX_EXECUTIONS_PER_MINUTE",
        "AUTH_USER",
        "AUTH_PASS",
    ):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    reset_execution_limits()
    yield
    get_settings.cache_clear()
    reset_execution_limits()
    app.dependency_overrides.clear()


@pytest.fixture
def client(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'limits.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=engine)
    Session_local = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override_session():
        with Session_local() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    app.dependency_overrides[get_emulator_provider] = lambda: StubEmulator()
    with TestClient(app) as test_client:
        yield test_client


def run(client: TestClient) -> object:
    return client.post("/api/v1/executions", json=ENVELOPE)


def test_oversized_content_length_answers_413_without_draining_the_budget(client, monkeypatch):
    monkeypatch.setenv("MAX_EXECUTION_REQUEST_BYTES", "200")
    get_settings.cache_clear()

    oversized = {
        **ENVELOPE,
        "system_one": {**ENVELOPE["system_one"], "state": {"message": "x" * 500}},
    }
    response = client.post("/api/v1/executions", json=oversized)

    assert response.status_code == 413
    assert response.json()["type"].endswith("/payload-too-large")
    # The rejected request consumed no rate token: a normal run still goes.
    assert run(client).status_code == 201


def test_body_size_is_enforced_exactly_when_content_length_is_absent(client, monkeypatch):
    encoded = json.dumps(ENVELOPE).encode("utf-8")
    monkeypatch.setenv("MAX_EXECUTION_REQUEST_BYTES", str(len(encoded) - 1))
    get_settings.cache_clear()

    # Raw bytes: no JSON helper, and Starlette synthesizes Content-Length
    # only after reading — the exact-length check is the one under test.
    response = client.post(
        "/api/v1/executions",
        content=encoded,
        headers={"content-type": "application/json", "content-length": ""},
    )

    assert response.status_code == 413


def test_invalid_json_never_consumes_a_run_slot(client):
    response = client.post(
        "/api/v1/executions",
        content=b"{not json",
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 400
    assert run(client).status_code == 201


def test_rate_ceiling_rejects_with_retry_after(client, monkeypatch):
    monkeypatch.setenv("MAX_EXECUTIONS_PER_MINUTE", "2")
    monkeypatch.setenv("MAX_CONCURRENT_EXECUTIONS", "10")
    get_settings.cache_clear()

    assert run(client).status_code == 201
    assert run(client).status_code == 201
    third = run(client)

    assert third.status_code == 429
    assert third.json()["type"].endswith("/rate-limit-exceeded")
    assert int(third.headers["retry-after"]) >= 1


def test_concurrency_ceiling_rejects_the_second_in_flight_run(client, monkeypatch):
    monkeypatch.setenv("MAX_EXECUTIONS_PER_MINUTE", "100")
    monkeypatch.setenv("MAX_CONCURRENT_EXECUTIONS", "1")
    get_settings.cache_clear()

    blocker = threading.Event()
    app.dependency_overrides[get_emulator_provider] = lambda: StubEmulator(blocker=blocker)

    from app.core import limits as limits_module

    outcomes: dict[str, int] = {}

    def first_request():
        # A SECOND TestClient in this thread: each sync client drives the
        # app on its own event loop, so the blocked run truly overlaps the
        # main thread's second request.
        with TestClient(app) as blocked_client:
            outcomes["first"] = blocked_client.post(
                "/api/v1/executions", json=ENVELOPE
            ).status_code

    thread = threading.Thread(target=first_request)
    thread.start()
    # Wait until the first run is IN FLIGHT (its slot is held), then fire
    # the second request from the main thread.
    for _ in range(500):
        if limits_module._in_flight >= 1:
            break
        import time as _time

        _time.sleep(0.01)

    assert limits_module._in_flight == 1
    second = run(client)
    assert second.status_code == 429
    assert second.headers["retry-after"] == "5"

    # Release the blocked run; it must complete normally.
    blocker.set()
    thread.join(timeout=10)
    assert outcomes.get("first") == 201

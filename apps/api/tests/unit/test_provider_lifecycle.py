"""Fix-forward F10: lifespan-scoped provider clients + cached Settings.

The provider factories are per-process singletons whose clients are built
ONCE and closed by the FastAPI lifespan on shutdown; Settings is cached the
same way, with an explicit reset helper so env-isolated tests stay hermetic.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import get_emulator_provider, get_independent_openai_provider, get_jev_provider
from app.core.config import get_settings, reset_settings_cache
from app.main import app
from app.providers.emulator import EmulatorClient
from app.providers.jev import JevClient

RESULT = {
    "model": "stub",
    "answers": {"ok": {"type": "noul", "noul": 0.5}},
    "usage": {"input_tokens": 1, "output_tokens": 1},
}

REQUEST = {"state": "s", "questions": {"ok": {"type": "noul"}}}


def test_settings_instance_is_cached_per_process():
    assert get_settings() is get_settings()


def test_reset_settings_cache_builds_a_fresh_instance():
    first = get_settings()
    try:
        reset_settings_cache()
        assert get_settings() is not first
    finally:
        reset_settings_cache()


def test_emulator_provider_factory_returns_the_same_instance(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("EMULATOR_URL", "https://emulator.example")

    assert get_emulator_provider() is get_emulator_provider()


def test_jev_provider_factory_returns_the_same_instance(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-key")

    assert get_jev_provider() is get_jev_provider()


def test_emulator_client_reuses_one_httpx_client_across_executions():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=RESULT)

    client = EmulatorClient(base_url="https://emulator.test", transport=httpx.MockTransport(handler))
    internal = client._client
    try:
        asyncio.run(client.execute(REQUEST))
        asyncio.run(client.execute(REQUEST))
    finally:
        asyncio.run(client.aclose())

    assert client._client is internal  # one client, not one per call
    assert len(captured) == 2
    assert internal.is_closed  # aclose closes the shared client


def test_jev_client_reuses_one_httpx_client_across_executions():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=RESULT)

    client = JevClient(
        base_url="https://api.typesafe.test", api_key="ts-key", transport=httpx.MockTransport(handler)
    )
    internal = client._client
    try:
        asyncio.run(client.execute(REQUEST))
        asyncio.run(client.execute(REQUEST))
    finally:
        asyncio.run(client.aclose())

    assert client._client is internal
    assert internal.is_closed


def test_lifespan_closes_shared_clients_and_clears_factories(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("AUTH_USER", raising=False)
    monkeypatch.delenv("AUTH_PASS", raising=False)
    monkeypatch.setenv("EMULATOR_URL", "https://emulator.example")
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-key")

    with TestClient(app) as test_client:
        assert test_client.get("/health").status_code == 200
        emulator = get_emulator_provider()
        jev = get_jev_provider()

    assert isinstance(emulator, EmulatorClient)
    assert emulator._client.is_closed
    assert isinstance(jev, JevClient)
    assert jev._client.is_closed
    # The factories were cleared on shutdown: the next call builds fresh
    # (already-closed) clients instead of reusing dead ones.
    assert get_emulator_provider() is not emulator
    assert get_jev_provider() is not jev


def test_lifespan_closes_the_independent_openai_provider_pool(tmp_path, monkeypatch):
    # F1: the independent path injects its timeout-bounded provider into the
    # adapter as `model=` — the adapter only closes providers it OWNS, so the
    # app lifespan must reach through the wrapper to the underlying OpenAI
    # pool. This probes the REAL wiring (no seams): construction is offline,
    # shutdown must close `adapter.model._client`.
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("AUTH_USER", raising=False)
    monkeypatch.delenv("AUTH_PASS", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "llm-key")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")

    with TestClient(app) as test_client:
        assert test_client.get("/health").status_code == 200
        provider = get_independent_openai_provider()
        assert provider is not None
        adapter = provider._adapter
        pool = adapter.model._client
        assert not pool.is_closed()  # open while the app runs

    assert pool.is_closed()  # the OpenAI pool was released on shutdown
    assert adapter._closed is True


def test_testclient_remains_usable_after_a_lifespan_close(monkeypatch):
    monkeypatch.delenv("AUTH_USER", raising=False)
    monkeypatch.delenv("AUTH_PASS", raising=False)

    with TestClient(app) as first:
        assert first.get("/health").status_code == 200
    with TestClient(app) as second:
        assert second.get("/health").status_code == 200
        assert second.get("/api/v1/capabilities").status_code == 200

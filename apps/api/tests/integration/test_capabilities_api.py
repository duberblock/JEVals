"""Capabilities endpoint (plan §63): honest availability, no inventions.

Every combination is pinned with an isolated environment — the endpoint
reflects configuration truth only: never invented availability, never
invented names, and `default_model` appears ONLY when a real default is
configured.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app

CAPABILITY_VARS = (
    "EMULATOR_URL",
    "TYPESAFE_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
    "DEFAULT_MODEL",
)


@pytest.fixture
def client(tmp_path, monkeypatch):
    # chdir isolates pydantic-settings' relative env_file resolution so a
    # developer's local .env cannot leak provider configuration into tests.
    monkeypatch.chdir(tmp_path)
    for var in CAPABILITY_VARS:
        monkeypatch.delenv(var, raising=False)
    monkeypatch.delenv("AUTH_USER", raising=False)
    monkeypatch.delenv("AUTH_PASS", raising=False)
    return TestClient(app)


def test_with_nothing_configured_the_default_emulator_is_available(client):
    # Out of the box the emulator points at the free public Simple Jev demo
    # — the other sources still need real credentials.
    response = client.get("/api/v1/capabilities")

    assert response.status_code == 200
    assert response.json() == {
        "emulator": {"available": True},
        "jev": {"available": False},
        "openai": {"available": False, "models": []},
    }


def test_with_everything_configured_all_capabilities_are_available(client, monkeypatch):
    monkeypatch.setenv("EMULATOR_URL", "https://emulator.example")
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-key")
    monkeypatch.setenv("OPENAI_API_KEY", "llm-key")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("DEFAULT_MODEL", "jev-latest")

    response = client.get("/api/v1/capabilities")

    assert response.status_code == 200
    assert response.json() == {
        "emulator": {"available": True},
        "jev": {"available": True},
        "openai": {"available": True, "models": ["gpt-4o-mini"]},
        "default_model": "jev-latest",
    }


def test_openai_models_stay_empty_when_the_key_is_set_without_a_model(client, monkeypatch):
    # STEP 6 alignment: both LLM branches (independent + judge) require the
    # key AND the model — a key without a model cannot run anything, so
    # `available` must stay false (§63: never invent availability).
    monkeypatch.setenv("OPENAI_API_KEY", "llm-key")
    monkeypatch.delenv("OPENAI_MODEL", raising=False)

    body = client.get("/api/v1/capabilities").json()

    assert body["openai"] == {"available": False, "models": []}


def test_openai_model_without_key_is_neither_available_nor_listed(client, monkeypatch):
    # §63: never invent availability — a configured model name cannot make
    # LLM available when its key is missing.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")

    body = client.get("/api/v1/capabilities").json()

    assert body["openai"] == {"available": False, "models": []}


def test_default_model_key_is_omitted_when_unset(client, monkeypatch):
    response = client.get("/api/v1/capabilities")

    assert "default_model" not in response.json()


def test_each_capability_reflects_its_own_variable_only(client, monkeypatch):
    monkeypatch.setenv("EMULATOR_URL", "https://emulator.example")

    body = client.get("/api/v1/capabilities").json()

    assert body["emulator"] == {"available": True}
    assert body["jev"] == {"available": False}
    assert body["openai"] == {"available": False, "models": []}
    assert "default_model" not in body

"""Settings API (UI provider configuration): effective view, encrypted
keys, env fallback, and capabilities reflecting the saved configuration.

The plaintext of a saved key NEVER appears in a response body or in the
stored database document — the row holds a Fernet token and GET reports
``keySet`` only.
"""

import json

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core import crypto
from app.main import app
from app.persistence.database import get_session
from app.persistence.models import Base

ENCRYPTION_KEY = Fernet.generate_key().decode("ascii")


@pytest.fixture
def db_session(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'settings.db'}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    factory = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    with factory() as session:
        yield session


@pytest.fixture
def client(db_session, tmp_path, monkeypatch):
    # chdir keeps pydantic-settings' relative .env and the settings-key
    # fallback file inside the test's tmp dir.
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SETTINGS_ENCRYPTION_KEY", ENCRYPTION_KEY)
    crypto.reset_crypto_cache()
    for var in (
        "EMULATOR_URL",
        "EMULATOR_API_KEY",
        "EMULATOR_MODEL",
        "TYPESAFE_API_KEY",
        "TYPESAFE_MODEL",
        "OPENAI_API_KEY",
        "OPENAI_MODEL",
        "JUDGE_API_KEY",
        "JUDGE_BASE_URL",
        "JUDGE_MODEL",
        "INDEPENDENT_API_KEY",
        "INDEPENDENT_BASE_URL",
        "INDEPENDENT_MODEL",
        "DEFAULT_MODEL",
        "AUTH_USER",
        "AUTH_PASS",
    ):
        monkeypatch.delenv(var, raising=False)

    def override_session():
        yield db_session

    app.dependency_overrides[get_session] = override_session
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    crypto.reset_crypto_cache()


def test_get_with_nothing_configured_shows_the_honest_empty_view(client):
    response = client.get("/api/v1/settings")

    assert response.status_code == 200
    providers = response.json()["providers"]
    not_configured = {"model": None, "keySet": False, "available": False,
                      "configuredHere": {"endpoint": False, "model": False, "apiKey": False}}
    # Endpoints show their environment DEFAULTS (nothing invented, just the
    # documented base URLs); nothing is available without keys/models.
    assert providers["emulator"] == {"endpoint": None, **not_configured}
    assert providers["jev"] == {"endpoint": "https://api.typesafe.ai", **not_configured}
    assert providers["judge"] == {"endpoint": "https://api.openai.com/v1", **not_configured}
    assert providers["independent"] == {"endpoint": "https://api.openai.com/v1", **not_configured}


def test_get_reflects_the_environment_layer_with_keyset_but_never_the_key(client, monkeypatch):
    monkeypatch.setenv("EMULATOR_URL", "https://emulator.example")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-shared")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")

    response = client.get("/api/v1/settings")
    providers = response.json()["providers"]

    assert providers["emulator"]["endpoint"] == "https://emulator.example"
    assert providers["emulator"]["available"] is True
    assert providers["judge"]["keySet"] is True
    assert providers["independent"]["keySet"] is True
    # Key material never leaves the server.
    assert "sk-shared" not in response.text


def test_put_saves_configuration_and_the_view_reports_it(client, db_session):
    response = client.put(
        "/api/v1/settings",
        json={
            "emulator": {
                "endpoint": "http://localhost:8100",
                "model": "demo-model",
                "api_key": "emulator-secret",
            },
            "judge": {"endpoint": "http://localhost:11434/v1", "model": "qwen3:8b", "api_key": "ollama"},
        },
    )

    assert response.status_code == 200
    providers = response.json()["providers"]
    assert providers["emulator"]["endpoint"] == "http://localhost:8100"
    assert providers["emulator"]["model"] == "demo-model"
    assert providers["emulator"]["keySet"] is True
    assert providers["emulator"]["configuredHere"] == {
        "endpoint": True,
        "model": True,
        "apiKey": True,
    }
    assert providers["judge"]["available"] is True

    # At rest: the stored document holds Fernet tokens, never plaintext.
    stored = json.loads(
        db_session.execute(text("SELECT data FROM app_settings WHERE id = 1")).scalar_one()
    )
    assert "emulator-secret" not in stored["emulator"]["api_key"]
    assert stored["emulator"]["api_key"]
    assert Fernet(ENCRYPTION_KEY.encode()).decrypt(
        stored["emulator"]["api_key"].encode()
    ).decode() == "emulator-secret"
    # And the response body never echoed it either.
    assert "emulator-secret" not in response.text


def test_ui_overrides_win_over_the_environment_and_clearing_falls_back(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-shared")
    monkeypatch.setenv("OPENAI_MODEL", "shared-model")

    put = client.put(
        "/api/v1/settings",
        json={"independent": {"model": "my-own-model"}},
    )
    assert put.json()["providers"]["independent"]["model"] == "my-own-model"

    # Clearing the override falls back to the environment layer.
    cleared = client.put(
        "/api/v1/settings",
        json={"independent": {"model": None}},
    )
    assert cleared.json()["providers"]["independent"]["model"] == "shared-model"
    assert cleared.json()["providers"]["independent"]["configuredHere"]["model"] is False


def test_per_leg_env_configuration_wins_over_the_shared_pair(client, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-shared")
    monkeypatch.setenv("OPENAI_MODEL", "shared-model")
    monkeypatch.setenv("JUDGE_MODEL", "judge-only-model")

    providers = client.get("/api/v1/settings").json()["providers"]
    assert providers["judge"]["model"] == "judge-only-model"
    assert providers["independent"]["model"] == "shared-model"


def test_capabilities_reflect_saved_settings(client):
    assert client.get("/api/v1/capabilities").json()["openai"]["available"] is False

    client.put(
        "/api/v1/settings",
        json={
            "judge": {"model": "m-judge", "api_key": "k1"},
            "independent": {"model": "m-indep", "api_key": "k2"},
            "emulator": {"endpoint": "http://localhost:8100"},
        },
    )

    capabilities = client.get("/api/v1/capabilities").json()
    assert capabilities["emulator"]["available"] is True
    # The aggregate LLM entry needs BOTH legs; models lists the distinct set.
    assert capabilities["openai"] == {"available": True, "models": ["m-indep", "m-judge"]}


def test_a_partial_llm_configuration_keeps_the_aggregate_honest(client):
    client.put(
        "/api/v1/settings",
        json={"judge": {"model": "m-judge", "api_key": "k1"}},
    )

    capabilities = client.get("/api/v1/capabilities").json()
    assert capabilities["openai"]["available"] is False
    assert capabilities["openai"]["models"] == []


def test_an_undecryptable_stored_key_degrades_to_not_set(client, db_session):
    client.put("/api/v1/settings", json={"jev": {"api_key": "real-key"}})
    assert client.get("/api/v1/settings").json()["providers"]["jev"]["keySet"] is True

    # A rotated master key: the token can no longer be decrypted — the
    # credential degrades to "not configured" instead of crashing.
    db_session.execute(
        text("UPDATE app_settings SET data = json_replace(data, '$.jev.api_key', 'not-a-token') WHERE id = 1")
    )
    db_session.commit()

    assert client.get("/api/v1/settings").json()["providers"]["jev"]["keySet"] is False


def test_compose_style_empty_env_strings_read_as_not_configured(client, monkeypatch):
    # Deployment templates pass `${VAR:-}` — an empty string must behave
    # exactly like an unset variable (the live compose exposed "" endpoints
    # and keySet=true for empty keys).
    monkeypatch.setenv("EMULATOR_URL", "")
    monkeypatch.setenv("EMULATOR_API_KEY", "")
    monkeypatch.setenv("OPENAI_API_KEY", "")
    monkeypatch.setenv("OPENAI_MODEL", "")

    providers = client.get("/api/v1/settings").json()["providers"]
    assert providers["emulator"]["endpoint"] is None
    assert providers["emulator"]["keySet"] is False
    assert providers["judge"]["keySet"] is False
    assert providers["independent"]["keySet"] is False

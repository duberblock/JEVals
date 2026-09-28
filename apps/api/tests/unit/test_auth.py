import base64

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.main import app


@pytest.fixture(autouse=True)
def fresh_settings_cache():
    """The middleware reads the canonical (lru_cached) Settings — clear the
    cache around each test so the monkeypatched environment is what it sees."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def basic(user: str, password: str) -> str:
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    return f"Basic {token}"


def test_auth_is_pass_through_when_credentials_are_unset_and_auth_required_unset(monkeypatch):
    monkeypatch.delenv("AUTH_USER", raising=False)
    monkeypatch.delenv("AUTH_PASS", raising=False)
    monkeypatch.delenv("AUTH_REQUIRED", raising=False)

    response = TestClient(app).get("/api/v1/capabilities")

    assert response.status_code == 200


def test_auth_required_fails_closed_when_credentials_are_missing(monkeypatch):
    monkeypatch.delenv("AUTH_USER", raising=False)
    monkeypatch.delenv("AUTH_PASS", raising=False)
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    client = TestClient(app)

    response = client.get("/api/v1/capabilities")

    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.headers["www-authenticate"] == "Basic"

    # Public paths stay open even under AUTH_REQUIRED (healthcheck contract).
    assert client.get("/health").status_code == 200
    assert client.get("/ready").status_code == 200


def test_auth_required_enforces_normally_when_credentials_are_set(monkeypatch):
    monkeypatch.setenv("AUTH_USER", "admin")
    monkeypatch.setenv("AUTH_PASS", "secret")
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    client = TestClient(app)

    assert client.get("/api/v1/capabilities").status_code == 401
    assert (
        client.get("/api/v1/capabilities", headers={"Authorization": basic("admin", "secret")}).status_code
        == 200
    )


def test_auth_rejects_non_health_routes_when_credentials_are_set(monkeypatch):
    monkeypatch.setenv("AUTH_USER", "admin")
    monkeypatch.setenv("AUTH_PASS", "secret")

    response = TestClient(app).get("/api/v1/capabilities")

    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.headers["www-authenticate"] == "Basic"


def test_auth_accepts_valid_basic_credentials(monkeypatch):
    monkeypatch.setenv("AUTH_USER", "admin")
    monkeypatch.setenv("AUTH_PASS", "secret")

    response = TestClient(app).get(
        "/api/v1/capabilities",
        headers={"Authorization": basic("admin", "secret")},
    )

    assert response.status_code == 200


def test_credentials_from_an_env_file_reach_the_middleware(tmp_path, monkeypatch):
    """The reported seam: pydantic loads apps/api/.env into Settings but
    never exports it to the process environment — a middleware reading
    os.getenv could not see file credentials. The canonical Settings read
    must enforce auth from the file alone."""
    env_file = tmp_path / "test.env"
    env_file.write_text("AUTH_USER=file-user\nAUTH_PASS=file-pass\n")
    monkeypatch.delenv("AUTH_USER", raising=False)
    monkeypatch.delenv("AUTH_PASS", raising=False)
    monkeypatch.setattr(
        "app.core.security.get_settings",
        lambda: Settings(_env_file=env_file),
    )

    client = TestClient(app)

    assert client.get("/api/v1/capabilities").status_code == 401
    assert (
        client.get(
            "/api/v1/capabilities",
            headers={"Authorization": basic("file-user", "file-pass")},
        ).status_code
        == 200
    )

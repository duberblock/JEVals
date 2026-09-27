from fastapi.testclient import TestClient

from app.main import app


def test_api_smoke_health_ready_and_capabilities(monkeypatch):
    monkeypatch.delenv("AUTH_USER", raising=False)
    monkeypatch.delenv("AUTH_PASS", raising=False)
    client = TestClient(app)

    assert client.get("/health").status_code == 200
    assert client.get("/ready").status_code == 200
    assert client.get("/api/v1/capabilities").status_code == 200

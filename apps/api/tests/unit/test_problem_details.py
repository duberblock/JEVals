import re
from uuid import UUID

from fastapi.testclient import TestClient

from app.main import app

UUID_V4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


@app.get("/__test/unhandled-exception")
async def raise_unhandled_exception():
    raise RuntimeError("forced unhandled exception")


def assert_problem(response, status):
    assert response.status_code == status
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["status"] == status
    assert body["type"].startswith("https://jevals.local/problems/")
    assert body["title"]
    assert body["instance"]
    UUID(body["trace_id"], version=4)
    assert isinstance(body["ref"], int)
    return body


def test_404_uses_problem_details():
    response = TestClient(app).get("/missing")

    assert_problem(response, 404)


def test_validation_error_uses_problem_details():
    response = TestClient(app).post("/api/v1/executions", json={"state": 42, "questions": {}})

    body = assert_problem(response, 422)
    assert "validation" in body["type"]


def test_unhandled_exception_uses_problem_details_and_logs_trace_id(caplog):
    response = TestClient(app, raise_server_exceptions=False).get("/__test/unhandled-exception")

    body = assert_problem(response, 500)
    assert body["type"] == "https://jevals.local/problems/internal-server-error"
    assert body["title"] == "Internal Server Error"
    assert body["detail"] == "An unexpected error occurred."
    assert body["instance"] == "/__test/unhandled-exception"
    assert UUID_V4_RE.match(body["trace_id"])
    assert body["status"] == 500
    assert isinstance(body["ref"], int)
    assert str(body["ref"]).isdecimal()
    assert body["trace_id"] in caplog.text

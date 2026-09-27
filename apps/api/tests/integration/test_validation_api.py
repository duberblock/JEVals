import pytest
from fastapi.testclient import TestClient

from app.main import app

CANONICAL_REQUEST = {
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


@pytest.fixture
def client(monkeypatch):
    monkeypatch.delenv("AUTH_USER", raising=False)
    monkeypatch.delenv("AUTH_PASS", raising=False)
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_canonical_request_is_valid_with_ordered_detection(client):
    response = client.post("/api/v1/validations", json=CANONICAL_REQUEST)

    assert response.status_code == 200
    assert response.json() == {
        "valid": True,
        "questions": [
            {"name": "request_type", "primitive": "choice"},
            {"name": "urgency", "primitive": "score"},
            {"name": "refund_requested", "primitive": "noul"},
        ],
    }


def test_detection_preserves_question_insertion_order(client):
    reordered = {
        "state": None,
        "questions": {
            "refund_requested": {"type": "noul"},
            "request_type": {
                "type": "choice",
                "criteria": {"billing": "Billing issue"},
            },
        },
    }

    response = client.post("/api/v1/validations", json=reordered)

    assert response.status_code == 200
    assert response.json() == {
        "valid": True,
        "questions": [
            {"name": "refund_requested", "primitive": "noul"},
            {"name": "request_type", "primitive": "choice"},
        ],
    }


def test_unknown_question_type_reports_the_domain_copy_verbatim(client):
    response = client.post(
        "/api/v1/validations",
        json={"state": "x", "questions": {"request_type": {"type": "classification"}}},
    )

    assert response.status_code == 200
    assert response.json() == {
        "valid": False,
        "error": {
            "title": "Unsupported question type",
            "detail": (
                "Question 'request_type' has unsupported type 'classification'. "
                "Expected: choice | score | noul."
            ),
        },
    }


def test_contract_violation_reports_domain_title_and_detail(client):
    response = client.post(
        "/api/v1/validations",
        json={"state": "Plain.", "questions": {"q": {"type": "noul"}}} | {"model": None},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert body["error"]["title"] == "Invalid SystemOneRequest"
    assert "at 'model'." in body["error"]["detail"]


def test_non_object_json_document_is_invalid_not_an_http_error(client):
    # The document under validation is user content, not the API call's own
    # contract: any JSON parses, then fails validation with a domain verdict.
    response = client.post("/api/v1/validations", json="just a string")

    assert response.status_code == 200
    body = response.json()
    assert body["valid"] is False
    assert body["error"]["title"] == "Invalid SystemOneRequest"
    assert body["error"]["detail"]


def test_malformed_json_body_returns_400_problem(client):
    response = client.post("/api/v1/validations", content=b"{not json")

    assert response.status_code == 400
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["type"].endswith("/invalid-json")
    assert body["status"] == 400


def test_empty_body_returns_400_problem(client):
    response = client.post("/api/v1/validations", content=b"")

    assert response.status_code == 400
    assert response.json()["type"].endswith("/invalid-json")

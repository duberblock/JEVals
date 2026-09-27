from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.problems import problem_response
from app.domain.requests.detection import validate_and_detect
from app.domain.requests.models import RequestContractError

router = APIRouter(prefix="/api/v1/validations", tags=["validations"])


@router.post("")
async def validate_system_one(request: Request) -> dict:
    """Validate a raw SystemOneRequest and detect its primitives (plan §19.1).

    This is the validation/detection panel's data source: it never executes
    anything. The posted document is user content under validation, not the
    API call's own contract, so any JSON is accepted and answered with a
    domain verdict — only non-JSON bodies are a 400 transport error.
    """
    try:
        raw = await request.json()
    except ValueError:
        # json.JSONDecodeError (and UnicodeDecodeError) are ValueErrors.
        # Problem branches return the RFC 7807 JSONResponse directly; the
        # dict annotation above describes the success body for OpenAPI.
        return problem_response(  # type: ignore[return-value]
            request,
            status=400,
            title="Invalid JSON",
            detail="The request body is not valid JSON.",
            problem_type="invalid-json",
        )
    try:
        detection = validate_and_detect(raw)
    except RequestContractError as error:
        return {"valid": False, "error": {"title": error.title, "detail": error.detail}}
    return {
        "valid": True,
        "questions": [
            {"name": question.name, "primitive": question.primitive}
            for question in detection.questions
        ],
    }

"""The Simple Jev classifier contract, shared by every provider box.

Both the emulator and the JEV baseline accept a Simple Jev endpoint
(…/v1/classifier) — the same question taxonomy (choice/score/noul over a
state context) with a REQUIRED model and a slightly different envelope.
This module owns the translation so both clients speak it identically.
"""

from __future__ import annotations

from typing import Any

from pydantic import ValidationError

from app.schemas.system_one_result import SystemOneResult

DEFAULT_CLASSIFIER_MODEL = "featherless-ai/Qwen3.6-35B-A3B-classifier"

# The SystemOneResult contract forbids extras per answer, so classifier
# answers are reduced to exactly the keys each type allows.
_ANSWER_KEYS = {
    "noul": {"type", "noul"},
    "choice": {"type", "choice", "confidence", "probabilities"},
    "score": {"type", "score", "confidence", "legend", "probabilities"},
}


def classifier_payload(request: dict[str, Any], default_model: str | None) -> dict[str, Any]:
    """Map a SystemOneRequest onto the Simple Jev classifier request.

    Raises ValueError when the request lacks state/questions, or when the
    caller needs a domain-specific error surface instead.
    """
    if "state" not in request or "questions" not in request:
        raise ValueError("the request needs 'state' and 'questions'")
    # Simple Jev REQUIRES `instructions` on every question; the SystemOne
    # contract allows omitting them. A default derived from the question's
    # name fills the gap without touching the caller's request.
    questions: dict[str, Any] = {}
    raw_questions = request["questions"]
    if isinstance(raw_questions, dict):
        for name, question in raw_questions.items():
            if isinstance(question, dict):
                copied = dict(question)
                if not copied.get("instructions"):
                    copied["instructions"] = f"Answer the question '{name}'."
                questions[name] = copied
            else:
                questions[name] = question
    model = request.get("model")
    return {
        "model": (
            model
            if isinstance(model, str) and model
            else (default_model or DEFAULT_CLASSIFIER_MODEL)
        ),
        "state": request["state"],
        "questions": questions,
    }


def result_from_classifier(data: object) -> SystemOneResult:
    """Map the classifier response onto the SystemOneResult contract.

    Raises ValueError when the body is not a classifier-shaped result.
    """
    if not isinstance(data, dict):
        raise ValueError("not a classifier result")
    answers_raw = data.get("answers")
    if not isinstance(answers_raw, dict) or not answers_raw:
        raise ValueError("no answers")
    answers: dict[str, dict[str, Any]] = {}
    for name, answer in answers_raw.items():
        if not isinstance(answer, dict):
            raise ValueError("answer is not an object")
        answer_type = answer.get("type")
        allowed = _ANSWER_KEYS.get(answer_type) if isinstance(answer_type, str) else None
        if allowed is None or not allowed.issubset(answer):
            raise ValueError("unsupported or incomplete answer")
        answers[name] = {key: answer[key] for key in allowed}
    usage_raw = data.get("usage")
    usage = usage_raw if isinstance(usage_raw, dict) else {}
    model = data.get("model")
    try:
        return SystemOneResult.model_validate(
            {
                "model": model if isinstance(model, str) and model else DEFAULT_CLASSIFIER_MODEL,
                "answers": answers,
                "usage": {
                    "input_tokens": usage.get("input_tokens", 0) or 0,
                    "output_tokens": usage.get("output_tokens", 0) or 0,
                },
            }
        )
    except ValidationError as error:
        raise ValueError("invalid result") from error

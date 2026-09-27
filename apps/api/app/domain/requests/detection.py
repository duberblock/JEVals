from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from pydantic import ValidationError

from app.domain.requests.models import (
    PRIMITIVES,
    QuestionDetection,
    RequestContractError,
    RequestDetection,
    UnsupportedQuestionTypeError,
)
from app.schemas.system_one import SystemOneRequest


def validate_and_detect(raw: Any) -> RequestDetection:
    """Validate raw parsed JSON as a canonical SystemOneRequest and detect primitives.

    Detection reads questions[name].type exclusively (plan §7); the criteria shape
    is never used to infer the primitive. Raises RequestContractError (or its
    UnsupportedQuestionTypeError subclass) when the payload is not canonical.
    """
    try:
        request = SystemOneRequest.model_validate(raw)
    except ValidationError as error:
        raise _contract_error(raw, error) from error

    questions = tuple(
        QuestionDetection(name=name, primitive=question.type)
        for name, question in request.questions.root.items()
    )
    return RequestDetection(request=request, questions=questions)


def sanitize_problem_errors(errors: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Sanitize Pydantic error dicts for the HTTP 422 problem extension member.

    Accepts pydantic's ErrorDetails (a TypedDict sequence) as well as the
    looser shapes FastAPI's own validation handler produces.

    The RequestValidationError handler publishes these as the problem's
    `errors` member, so mirror internals and raw payload echoes must not
    leak: question union branch tags are stripped at their structural
    position — the segment immediately following a ('questions', <name>)
    pair, found by scanning for the 'questions' segment wherever it occurs
    (HTTP locs are prefixed with 'body', so there is no fixed index to
    test) — and EntryType branch tags are stripped when terminal. The
    'input' key (the raw payload echo) is removed; every other key
    (type/msg/ctx/url) passes through unchanged.
    """
    sanitized: list[dict[str, Any]] = []
    for err in errors:
        entry = {key: value for key, value in err.items() if key != "input"}
        entry["loc"] = _sanitized_loc(err.get("loc") or ())
        sanitized.append(entry)
    return sanitized


def _contract_error(raw: Any, error: ValidationError) -> RequestContractError:
    unsupported = _find_unsupported_question_type(raw)
    if unsupported is not None:
        return unsupported
    location = _non_string_type_location(raw) or _first_error_location(error, raw)
    detail = "Payload does not match the canonical SystemOneRequest contract."
    if location:
        detail = f"Payload does not match the canonical SystemOneRequest contract at '{location}'."
    return RequestContractError(title="Invalid SystemOneRequest", detail=detail)


def _find_unsupported_question_type(raw: Any) -> UnsupportedQuestionTypeError | None:
    if not isinstance(raw, dict):
        return None
    questions = raw.get("questions")
    if not isinstance(questions, dict):
        return None
    for name, question in questions.items():
        if not isinstance(question, dict):
            continue
        question_type = question.get("type")
        if isinstance(question_type, str) and question_type not in PRIMITIVES:
            return UnsupportedQuestionTypeError(
                question_name=str(name), question_type=question_type
            )
    return None


def _non_string_type_location(raw: Any) -> str | None:
    """Forced location for a question whose `type` key is missing or not a string.

    Without this scan the union discrimination noise (every branch failing on
    a different field) would surface criteria locations instead. Kept distinct
    from _find_unsupported_question_type: only an unknown STRING type raises
    UnsupportedQuestionTypeError; a missing or non-string type is a generic
    contract violation pinned to `questions.<name>.type`.
    """
    if not isinstance(raw, dict):
        return None
    questions = raw.get("questions")
    if not isinstance(questions, dict):
        return None
    for name, question in questions.items():
        if not isinstance(question, dict):
            continue
        if not isinstance(question.get("type"), str):
            return f"questions.{name}.type"
    return None


# Pydantic union branch tags appearing in ValidationError locations. They are
# mirror internals (not payload fields) and must never surface in error details.
_QUESTION_BRANCH_TAGS = frozenset({"NoulQuestion", "ChoiceQuestion", "ScoreQuestion"})

# Terminal tags of the EntryType union (str | dict[str, Any] | list[Any] |
# None): the failing leaf of an EntryType union error always ends with one of
# these. 'NoneType' can never appear because None always matches its branch.
# Stripped ONLY when terminal: a question or criteria LABEL named 'str' is a
# non-terminal segment and must survive.
_ENTRY_TYPE_BRANCH_TAGS = frozenset({"str", "dict[str,any]", "list[any]"})

# Discrimination-noise error types: a candidate path is skipped for ending in
# 'type' ONLY when its ORIGINAL error type is one of these (the non-matching
# branch's literal_error, or a missing 'type'). A genuine failure on a payload
# field/key literally named 'type' — e.g. a choice criteria KEY 'type' —
# carries a different error type and must surface.
_TYPE_NOISE_ERROR_TYPES = frozenset({"literal_error", "missing"})

_PRIMITIVE_TO_BRANCH = {"choice": "ChoiceQuestion", "score": "ScoreQuestion", "noul": "NoulQuestion"}


def _sanitized_loc(loc: tuple) -> list:
    parts = list(loc)
    for index in range(len(parts) - 2):
        if str(parts[index]) == "questions" and str(parts[index + 2]) in _QUESTION_BRANCH_TAGS:
            del parts[index + 2]
            break
    if parts and str(parts[-1]) in _ENTRY_TYPE_BRANCH_TAGS:
        parts = parts[:-1]
    return parts


def _first_error_location(error: ValidationError, raw: Any) -> str | None:
    """Derive the most useful payload path from the flattened Pydantic errors.

    Union validation reports one error per branch, each tagged with the branch
    class name (for the Question union) or the branch type (for the EntryType
    unions) in its location. Every non-matching branch contributes a
    literal_error on `type`, which is discrimination noise; the branch matching
    the payload's (already known-primitive) type reports the real failure (e.g.
    `criteria`). So: strip the branch-tag segments (question tags only at their
    structural position — the segment right after `questions.<name>` — so a
    question legitimately named 'ChoiceQuestion' survives; EntryType tags only
    when terminal), then prefer candidates from the branch matching the raw
    question type — but only among candidates of the SAME failing question, so
    root-level failures and global Pydantic error order are otherwise
    preserved — and return the first candidate that is not discrimination
    noise: a path is skipped only when it ends in `type` AND its original
    error type is literal_error or missing, falling back to the first path.
    """
    candidates: list[tuple[str, str]] = []  # (stripped path, original error type)
    seen: set[str] = set()
    branch_paths: set[str] = set()
    for err in error.errors():
        parts = [str(part) for part in (err.get("loc") or ())]
        original_type = str(err.get("type", ""))
        branch_tag: str | None = None
        if len(parts) >= 3 and parts[0] == "questions" and parts[2] in _QUESTION_BRANCH_TAGS:
            branch_tag = parts[2]
            parts = parts[:2] + parts[3:]
        if parts and parts[-1] in _ENTRY_TYPE_BRANCH_TAGS:
            parts = parts[:-1]
        path = ".".join(parts)
        if not path:
            continue
        if branch_tag is not None and _branch_matches_raw_question(raw, parts[0:2], branch_tag):
            branch_paths.add(path)
        if path not in seen:
            seen.add(path)
            candidates.append((path, original_type))
    ordered = _ordered_by_per_question_branch_preference(candidates, branch_paths)
    for path, original_type in ordered:
        if path.rsplit(".", 1)[-1] != "type" or original_type not in _TYPE_NOISE_ERROR_TYPES:
            return path
    return ordered[0][0] if ordered else None


def _ordered_by_per_question_branch_preference(
    candidates: list[tuple[str, str]], branch_paths: set[str]
) -> list[tuple[str, str]]:
    """Reorder candidates so the branch preference applies per failing question.

    Candidates are grouped by their ('questions', <name>) prefix (None for
    root-level paths); groups keep their first-appearance order, and within a
    group the branch-matching candidates come first — both partitions stable.
    Root-level and earlier-question failures therefore keep their global
    Pydantic error order, while the matching branch still outranks
    discrimination noise inside its own question.
    """
    groups: dict[tuple[str, ...] | None, list[tuple[str, str]]] = {}
    for candidate in candidates:
        groups.setdefault(_question_prefix(candidate[0]), []).append(candidate)
    ordered: list[tuple[str, str]] = []
    for group in groups.values():
        ordered.extend(candidate for candidate in group if candidate[0] in branch_paths)
        ordered.extend(candidate for candidate in group if candidate[0] not in branch_paths)
    return ordered


def _question_prefix(path: str) -> tuple[str, ...] | None:
    parts = path.split(".")
    if len(parts) >= 2 and parts[0] == "questions":
        return parts[0], parts[1]
    return None


def _branch_matches_raw_question(raw: Any, question_path: list[str], branch_tag: str) -> bool:
    """Whether `branch_tag` is the Question-union branch the raw payload selected.

    The two leading location segments are ('questions', <name>); the branch
    matches only when the raw question's `type` string maps to the tag's class.
    """
    if not isinstance(raw, dict):
        return False
    questions = raw.get("questions")
    if not isinstance(questions, dict) or question_path[1] not in questions:
        return False
    question = questions[question_path[1]]
    if not isinstance(question, dict):
        return False
    question_type = question.get("type")
    return isinstance(question_type, str) and _PRIMITIVE_TO_BRANCH.get(question_type) == branch_tag

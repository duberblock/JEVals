from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

JsonObject = dict[str, Any]


def canonical_request_json(request: JsonObject) -> str:
    """Return the canonical SystemOneRequest JSON used for request_hash.

    The canonical plan requires SHA-256 over the canonicalized SystemOneRequest but
    does not further specify byte-level serialization. We use sorted keys, compact
    separators, no ASCII escaping, and UTF-8 bytes so semantically equivalent JSON
    object key ordering produces the same fingerprint.
    """

    return json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def compute_request_hash(request: JsonObject) -> str:
    digest = hashlib.sha256(canonical_request_json(request).encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


# §66 sections that can fail while the run still completes: a section exists
# in the payload only when that leg executed. The comparison itself is not a
# leg — a missing comparison is already expressed by the failed JEV section.
OPERATIONAL_SECTIONS: tuple[str, ...] = ("emulator", "jev", "independent_openai", "ai_evaluation")


class MalformedExecutionRequestError(ValueError):
    """Raised when Execution.create receives a request outside the canonical shape.

    The API's Pydantic boundary already guarantees the canonical
    SystemOneRequest contract, so this fires only on direct domain misuse —
    and loudly, because a silently-defaulted question_count=0 would be
    persisted as an authoritative column.
    """


def operational_status(status: str, payload: JsonObject) -> str:
    """Classify a persisted run for OPERATIONAL VIEWS (§66 single source).

    Returns 'failed' when the run status is failed, 'partial' when the run
    completed but ANY executed leg's section failed (the three §66 partial
    matrices: independent, judge and JEV failures), 'completed' otherwise.
    The persisted §47 `status` stays completed|failed — 'partial' is a VIEW
    classification delivered by the APIs, never persisted. Old payloads
    without sections classify by status alone (never invent a partial).
    """
    if status == "failed":
        return "failed"
    for section in OPERATIONAL_SECTIONS:
        section_payload = payload.get(section)
        if isinstance(section_payload, dict) and section_payload.get("status") == "failed":
            return "partial"
    return "completed"


@dataclass(frozen=True)
class Execution:
    execution_id: str
    created_at: datetime
    request_hash: str
    mode: str
    status: str
    question_count: int
    payload: JsonObject
    overall_fidelity: float | None = None
    aligned_questions: int | None = None
    semantic_divergence: str | None = None
    duration_ms: int | None = None

    @classmethod
    def create(
        cls,
        *,
        execution_id: str,
        created_at: datetime,
        request: JsonObject,
        mode: str,
        status: str,
        payload: JsonObject | None = None,
        overall_fidelity: float | None = None,
        aligned_questions: int | None = None,
        semantic_divergence: str | None = None,
        duration_ms: int | None = None,
    ) -> "Execution":
        # F9b: the Execution is an immutable in-memory snapshot. Deep-copy the
        # caller's request and payload up front so later caller mutations
        # (nested dicts included) can never rewrite the stored document or
        # invalidate its request_hash.
        request = copy.deepcopy(request)
        request_hash = compute_request_hash(request)
        snapshot: JsonObject = copy.deepcopy(payload or {})
        snapshot.update(
            {
                "execution_id": execution_id,
                "created_at": created_at.isoformat(),
                "request_hash": request_hash,
                "mode": mode,
                "status": status,
                "request": request,
            }
        )
        # §47 shape: provenance always carries providers/versions/timings.
        # Defaults fill per KEY so a caller-supplied provenance (e.g. §61.4
        # component timings merged in by the application layer) keeps its
        # existing values and any extra keys.
        supplied_provenance = snapshot.get("provenance")
        if not isinstance(supplied_provenance, dict):
            supplied_provenance = {}
        snapshot["provenance"] = (
            {"providers": [], "versions": {}, "timings": {}} | supplied_provenance
        )
        if duration_ms is not None:
            runtime = dict(snapshot.get("runtime") or {})
            runtime.setdefault("duration_ms", duration_ms)
            snapshot["runtime"] = runtime

        return cls(
            execution_id=execution_id,
            created_at=created_at,
            request_hash=request_hash,
            mode=mode,
            status=status,
            question_count=_question_count(request),
            overall_fidelity=overall_fidelity,
            aligned_questions=aligned_questions,
            semantic_divergence=semantic_divergence,
            duration_ms=duration_ms,
            payload=snapshot,
        )

    @classmethod
    def from_payload(
        cls,
        *,
        payload: JsonObject,
        question_count: int,
        overall_fidelity: float | None,
        aligned_questions: int | None,
        semantic_divergence: str | None,
        duration_ms: int | None,
    ) -> "Execution":
        return cls(
            execution_id=payload["execution_id"],
            created_at=datetime.fromisoformat(payload["created_at"]),
            request_hash=payload["request_hash"],
            mode=payload["mode"],
            status=payload["status"],
            question_count=question_count,
            overall_fidelity=overall_fidelity,
            aligned_questions=aligned_questions,
            semantic_divergence=semantic_divergence,
            duration_ms=duration_ms,
            payload=payload,
        )


def _question_count(request: JsonObject) -> int:
    questions = request.get("questions")
    if not isinstance(questions, dict):
        # Fail fast: a missing or non-dict questions shape is never canonical,
        # and silently persisting question_count=0 would corrupt the
        # authoritative column (F8b).
        raise MalformedExecutionRequestError(
            "Execution request 'questions' must be an object mapping question "
            f"names to definitions; got {type(questions).__name__}."
        )
    return len(questions)

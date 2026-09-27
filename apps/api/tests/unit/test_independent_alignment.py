"""Independent alignment (plan §31/§41, ruling 6): pure domain rules.

Whether the independent prediction agrees with each executed side, computed
with the SAME §26 decision rules the deterministic comparison uses — choice:
same label; score: same dominant rubric level; noul: same 0.5 category — so
the web renders "aligned"/"diverged" from the persisted booleans and never
re-derives anything.
"""

import pytest

from app.domain.executions.independent_alignment import (
    IndependentAlignmentError,
    compute_independent_alignment,
)
from app.schemas.system_one import SystemOneRequest
from app.schemas.system_one_result import SystemOneResult


def build_request() -> SystemOneRequest:
    return SystemOneRequest.model_validate(
        {
            "state": {"message": "I was charged twice on my invoice."},
            "questions": {
                "request_type": {
                    "type": "choice",
                    "criteria": {"billing": "Billing issue", "technical": "Technical issue"},
                },
                "urgency": {"type": "score", "criteria": ["low", "medium", "high"]},
                "refund_requested": {"type": "noul"},
            },
        }
    )


def build_result(
    *,
    choice: str = "billing",
    dominant: str = "1",
    noul: float = 0.8125,
    model: str = "some-model",
) -> SystemOneResult:
    probabilities = {"0": 0.125, "1": 0.625, "2": 0.25}
    if dominant == "0":
        probabilities = {"0": 0.625, "1": 0.25, "2": 0.125}
    elif dominant == "2":
        probabilities = {"0": 0.125, "1": 0.25, "2": 0.625}
    return SystemOneResult.model_validate(
        {
            "model": model,
            "answers": {
                "request_type": {
                    "type": "choice",
                    "choice": choice,
                    "confidence": 0.75,
                    "probabilities": {"billing": 0.75, "technical": 0.25},
                },
                "urgency": {
                    "type": "score",
                    "score": 1.0,
                    "confidence": 0.625,
                    "legend": {"0": "low", "1": "medium", "2": "high"},
                    "probabilities": probabilities,
                },
                "refund_requested": {"type": "noul", "noul": noul},
            },
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
    )


def test_aligned_with_both_sides_when_every_rule_agrees():
    alignment = compute_independent_alignment(
        build_request(),
        independent=build_result(),
        emulator=build_result(model="jev-emulator"),
        jev=build_result(model="jev-latest"),
    )

    assert alignment.aligned is True
    assert alignment.to_payload() == {
        "aligned": True,
        "questions": {
            "request_type": {"agrees_with_emulator": True, "agrees_with_jev": True},
            "urgency": {"agrees_with_emulator": True, "agrees_with_jev": True, "independent_dominant_level": "1"},
            "refund_requested": {"agrees_with_emulator": True, "agrees_with_jev": True},
        },
    }


def test_diverges_when_any_side_disagrees_on_any_question():
    # Independent picks technical (choice differs from both sides) while
    # score and noul agree: overall aligned is False even though 2 of 3
    # questions agree with both.
    alignment = compute_independent_alignment(
        build_request(),
        independent=build_result(choice="technical"),
        emulator=build_result(model="jev-emulator"),
        jev=build_result(model="jev-latest"),
    )

    assert alignment.aligned is False
    payload = alignment.to_payload()
    assert payload["questions"]["request_type"] == {
        "agrees_with_emulator": False,
        "agrees_with_jev": False,
    }
    assert payload["questions"]["urgency"] == {
        "agrees_with_emulator": True,
        "agrees_with_jev": True,
        "independent_dominant_level": "1",
    }


def test_alignment_tracks_each_side_independently():
    # Emulator agrees everywhere; JEV disagrees everywhere.
    alignment = compute_independent_alignment(
        build_request(),
        independent=build_result(dominant="0", noul=0.25),
        emulator=build_result(model="jev-emulator"),
        jev=build_result(dominant="2", noul=0.75, model="jev-latest"),
    )

    payload = alignment.to_payload()
    assert payload["questions"]["urgency"] == {
        "agrees_with_emulator": False,
        "agrees_with_jev": False,
        "independent_dominant_level": "0",
    }
    # Noul 0.25 (below .5) vs emulator 0.8125 (above) and jev 0.75 (above):
    # both sides disagree with the independent answer here.
    assert payload["questions"]["refund_requested"] == {
        "agrees_with_emulator": False,
        "agrees_with_jev": False,
    }
    assert alignment.aligned is False


def test_noul_exact_midpoint_is_its_own_category():
    # §27: exactly 0.5 is on NEITHER side — 0.5 agrees with 0.5 but not
    # with any strict side.
    aligned_midpoints = compute_independent_alignment(
        build_request(),
        independent=build_result(noul=0.5),
        emulator=build_result(noul=0.5, model="jev-emulator"),
    )
    assert aligned_midpoints.to_payload()["questions"]["refund_requested"] == {
        "agrees_with_emulator": True,
        "agrees_with_jev": None,
    }

    crossed = compute_independent_alignment(
        build_request(),
        independent=build_result(noul=0.5),
        emulator=build_result(noul=0.5625, model="jev-emulator"),
    )
    assert crossed.to_payload()["questions"]["refund_requested"] == {
        "agrees_with_emulator": False,
        "agrees_with_jev": None,
    }


def test_emulator_only_mode_reports_null_jev_flags():
    alignment = compute_independent_alignment(
        build_request(),
        independent=build_result(),
        emulator=build_result(model="jev-emulator"),
    )

    assert alignment.aligned is True
    for question in alignment.to_payload()["questions"].values():
        assert question["agrees_with_jev"] is None


def test_emulator_only_alignment_ignores_jev_disagreement():
    # Without a JEV side, only the emulator decides `aligned`.
    alignment = compute_independent_alignment(
        build_request(),
        independent=build_result(dominant="2"),
        emulator=build_result(model="jev-emulator"),
    )

    assert alignment.aligned is False
    payload = alignment.to_payload()
    assert payload["questions"]["urgency"]["agrees_with_emulator"] is False


def test_missing_answer_fails_loudly():
    truncated = SystemOneResult.model_validate(
        {
            "model": "gpt-4o-mini",
            "answers": {"request_type": build_result().answers["request_type"]},
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }
    )

    with pytest.raises(IndependentAlignmentError):
        compute_independent_alignment(
            build_request(), independent=truncated, emulator=build_result(model="jev-emulator")
        )


def test_primitive_mismatch_fails_loudly():
    # The mirror accepts any answer shape per question name (it does not know
    # the request); the ALIGNMENT catches the primitive mismatch loudly.
    mistyped = SystemOneResult.model_validate(
        {
            "model": "gpt-4o-mini",
            "answers": {
                "request_type": {
                    "type": "score",
                    "score": 1.0,
                    "confidence": 1.0,
                    "legend": {"0": "a", "1": "b"},
                    "probabilities": {"0": 0.5, "1": 0.5},
                }
            },
            "usage": {"input_tokens": 1, "output_tokens": 1},
        }
    )

    with pytest.raises(IndependentAlignmentError):
        compute_independent_alignment(
            build_request(), independent=mistyped, emulator=build_result(model="jev-emulator")
        )


def test_score_dominant_tie_break_matches_the_comparison_rule():
    # The tie-break (first key attaining the max in the map's own iteration
    # order) is the fidelity module's rule; equal-topped maps on both sides
    # resolve to the same key and therefore agree.
    def tied_result(model: str) -> SystemOneResult:
        return SystemOneResult.model_validate(
            {
                "model": model,
                "answers": {
                    "urgency": {
                        "type": "score",
                        "score": 1.0,
                        "confidence": 0.5,
                        "legend": {"0": "low", "1": "medium", "2": "high"},
                        "probabilities": {"0": 0.5, "1": 0.25, "2": 0.5},
                    }
                },
                "usage": {"input_tokens": 1, "output_tokens": 1},
            }
        )

    request = SystemOneRequest.model_validate(
        {"state": {}, "questions": {"urgency": {"type": "score", "criteria": ["low", "medium", "high"]}}}
    )

    alignment = compute_independent_alignment(
        request, independent=tied_result("llm"), emulator=tied_result("emu")
    )

    assert alignment.to_payload()["questions"]["urgency"]["agrees_with_emulator"] is True

def test_score_alignment_payload_carries_the_independent_dominant_level():
    # §41 display ("LLM 1.71 · High") must not re-derive the §26 argmax
    # client-side: the persisted per-question payload carries the level.
    alignment = compute_independent_alignment(
        build_request(),
        independent=build_result(dominant="2"),
        emulator=build_result(model="jev-emulator"),
        jev=build_result(model="jev-latest"),
    )
    payload = alignment.to_payload()["questions"]["urgency"]
    assert payload["independent_dominant_level"] == "2"

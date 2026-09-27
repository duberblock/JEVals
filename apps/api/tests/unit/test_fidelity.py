"""Exact-value tests for the deterministic fidelity domain (plan §24-§26).

Every fixture value below is a dyadic rational (a multiple of 1/16), so all
hand-computed expectations are EXACT in binary floating point — the asserts
pin the formulas themselves, not float tolerance.
"""

from __future__ import annotations

import pytest

from app.domain.executions.fidelity import (
    FidelityComparisonError,
    compare_system_one_results,
)
from app.schemas.system_one import SystemOneRequest
from app.schemas.system_one_result import SystemOneResult

SCORE_LEGEND = {"0": "low", "1": "medium", "2": "high"}

# Canonical mixed request: one question per primitive plus a diverging choice
# question, giving an exact overall fidelity of 0.75 (sum 3.0 / 4).
MIXED_QUESTIONS = {
    "request_type": {
        "type": "choice",
        "criteria": {"billing": "Billing issue", "technical": "Technical issue"},
    },
    "urgency": {"type": "score", "criteria": ["low", "medium", "high"]},
    "refund_requested": {"type": "noul"},
    "backup_channel": {
        "type": "choice",
        "criteria": {"email": "Email me", "phone": "Call me"},
    },
}

EMULATOR_ANSWERS = {
    "request_type": {
        "type": "choice",
        "choice": "billing",
        "confidence": 0.875,
        "probabilities": {"billing": 0.75, "technical": 0.25},
    },
    "urgency": {
        "type": "score",
        "score": 1.5,
        "confidence": 0.875,
        "legend": SCORE_LEGEND,
        "probabilities": {"0": 0.125, "1": 0.625, "2": 0.25},
    },
    "refund_requested": {"type": "noul", "noul": 0.625},
    "backup_channel": {
        "type": "choice",
        "choice": "email",
        "confidence": 0.75,
        "probabilities": {"email": 0.75, "phone": 0.25},
    },
}

JEV_ANSWERS = {
    "request_type": {
        "type": "choice",
        "choice": "billing",
        "confidence": 0.625,
        "probabilities": {"billing": 0.5, "technical": 0.5},
    },
    "urgency": {
        "type": "score",
        "score": 1.0,
        "confidence": 0.75,
        "legend": SCORE_LEGEND,
        "probabilities": {"0": 0.25, "1": 0.5, "2": 0.25},
    },
    "refund_requested": {"type": "noul", "noul": 0.75},
    "backup_channel": {
        "type": "choice",
        "choice": "phone",
        "confidence": 0.75,
        "probabilities": {"email": 0.3125, "phone": 0.6875},
    },
}


def make_request(questions: dict) -> SystemOneRequest:
    return SystemOneRequest.model_validate({"state": "s", "questions": questions})


def make_result(answers: dict, model: str = "stub") -> SystemOneResult:
    return SystemOneResult.model_validate(
        {"model": model, "answers": answers, "usage": {"input_tokens": 1, "output_tokens": 1}}
    )


def compare(questions: dict, emulator: dict, jev: dict):
    return compare_system_one_results(
        make_request(questions), make_result(emulator), make_result(jev)
    )


def by_name(comparison, name):
    return {question.name: question for question in comparison.questions}[name]


# --- Choice (§24: decisionMatch, confidenceDelta, TVD over label union) ---


def test_choice_components_are_exact_formula_values():
    comparison = compare(
        {"request_type": MIXED_QUESTIONS["request_type"]},
        {"request_type": EMULATOR_ANSWERS["request_type"]},
        {"request_type": JEV_ANSWERS["request_type"]},
    )
    question = by_name(comparison, "request_type")

    components = question.components
    assert components.decision_match is True
    assert components.confidence_delta == 0.25  # |0.875 - 0.625|
    # TVD = 0.5 x (|0.75-0.5| + |0.25-0.5|) = 0.5 x 0.5 = 0.25
    assert components.distribution_similarity == 0.75  # 1 - TVD
    # §25: Choice question fidelity = distributionSimilarity.
    assert question.fidelity == 0.75
    # §26: aligned = same selected choice.
    assert question.aligned is True
    assert question.primitive == "choice"


def test_choice_decision_mismatch_is_not_aligned():
    comparison = compare(
        {"backup_channel": MIXED_QUESTIONS["backup_channel"]},
        {"backup_channel": EMULATOR_ANSWERS["backup_channel"]},
        {"backup_channel": JEV_ANSWERS["backup_channel"]},
    )
    question = by_name(comparison, "backup_channel")

    assert question.components.decision_match is False
    assert question.aligned is False
    # TVD = 0.5 x (|0.75-0.3125| + |0.25-0.6875|) = 0.5 x 0.875 = 0.4375.
    assert question.components.distribution_similarity == 0.5625
    assert question.fidelity == 0.5625


def test_choice_tvd_takes_union_of_label_keys_missing_side_is_zero():
    comparison = compare(
        {"pick": {"type": "choice", "criteria": {"a": None, "b": None}}},
        {"pick": {"type": "choice", "choice": "a", "confidence": 0.5, "probabilities": {"a": 0.5, "b": 0.5}}},
        {"pick": {"type": "choice", "choice": "a", "confidence": 1.0, "probabilities": {"a": 1.0}}},
    )
    question = by_name(comparison, "pick")

    # 'b' is absent on the JEV side and counts as 0.0:
    # TVD = 0.5 x (|0.5-1.0| + |0.5-0.0|) = 0.5 x 1.0 = 0.5.
    assert question.components.distribution_similarity == 0.5
    assert question.fidelity == 0.5


# --- Score (§24: scoreDelta/maxScore, TVD over score keys, confidence) ---


def test_score_components_are_exact_formula_values():
    comparison = compare(
        {"urgency": MIXED_QUESTIONS["urgency"]},
        {"urgency": EMULATOR_ANSWERS["urgency"]},
        {"urgency": JEV_ANSWERS["urgency"]},
    )
    question = by_name(comparison, "urgency")

    components = question.components
    assert components.score_delta == 0.5  # |1.5 - 1.0|
    # maxScore = len(criteria) - 1 = 3 - 1 = 2, from the REQUEST question.
    assert components.max_score == 2
    # 1 - min(0.5 / 2, 1) = 0.75.
    assert components.score_similarity == 0.75
    # TVD = 0.5 x (|0.125-0.25| + |0.625-0.5| + |0.25-0.25|) = 0.5 x 0.25.
    assert components.distribution_similarity == 0.875
    assert components.confidence_delta == 0.125  # |0.875 - 0.75|
    # Dominant rubric levels per side (§26 argmax) travel in the payload so
    # the web renders "High ↔ High" rows without re-implementing the rule.
    assert components.emulator_dominant_level == "1"
    assert components.jev_dominant_level == "1"
    # §25: Score fidelity = average(scoreSimilarity, distributionSimilarity).
    assert question.fidelity == (0.75 + 0.875) / 2  # 0.8125
    # §26: aligned = same dominant rubric level (argmax probabilities).
    assert question.aligned is True
    assert question.primitive == "score"


def test_score_max_score_comes_from_the_request_criteria_array():
    comparison = compare(
        {"grade": {"type": "score", "criteria": ["a", "b", "c", "d", "e"]}},
        {"grade": {"type": "score", "score": 3.0, "confidence": 0.5, "legend": {}, "probabilities": {"0": 1.0}}},
        {"grade": {"type": "score", "score": 1.0, "confidence": 0.5, "legend": {}, "probabilities": {"0": 1.0}}},
    )
    question = by_name(comparison, "grade")

    # 5 criteria -> maxScore 4; 1 - min(2.0/4, 1) = 0.5.
    assert question.components.max_score == 4
    assert question.components.score_similarity == 0.5


def test_score_similarity_clamps_to_zero_when_delta_exceeds_max_score():
    comparison = compare(
        {"urgency": MIXED_QUESTIONS["urgency"]},
        {"urgency": {**EMULATOR_ANSWERS["urgency"], "score": 4.0}},
        {"urgency": {**JEV_ANSWERS["urgency"], "score": 1.0}},
    )
    question = by_name(comparison, "urgency")

    # delta 3.0 > maxScore 2 -> min(3.0/2, 1) = 1 -> similarity 0.
    assert question.components.score_similarity == 0.0
    assert question.fidelity == (0.0 + 0.875) / 2  # 0.4375


def test_score_alignment_is_false_when_dominant_levels_differ():
    comparison = compare(
        {"urgency": MIXED_QUESTIONS["urgency"]},
        {"urgency": {**EMULATOR_ANSWERS["urgency"], "probabilities": {"0": 0.625, "1": 0.25, "2": 0.125}}},
        {"urgency": JEV_ANSWERS["urgency"]},  # dominant "1"
    )
    question = by_name(comparison, "urgency")

    # Emulator dominant "0" vs JEV dominant "1".
    assert question.aligned is False


def test_score_alignment_tie_breaks_to_first_key_in_iteration_order():
    # PIN: a tie inside one probabilities map resolves to the FIRST key (in
    # the map's own iteration order) that attains the maximum, on each side
    # independently; aligned compares those resolved keys.
    comparison = compare(
        {"urgency": MIXED_QUESTIONS["urgency"]},
        # Tie between "0" and "1" at 0.5 -> dominant "0".
        {"urgency": {**EMULATOR_ANSWERS["urgency"], "probabilities": {"0": 0.5, "1": 0.5, "2": 0.0}}},
        # Unique maximum at "1" -> dominant "1".
        {"urgency": {**JEV_ANSWERS["urgency"], "probabilities": {"0": 0.2, "1": 0.5, "2": 0.3}}},
    )
    assert by_name(comparison, "urgency").aligned is False

    same_tie_both_sides = compare(
        {"urgency": MIXED_QUESTIONS["urgency"]},
        {"urgency": {**EMULATOR_ANSWERS["urgency"], "probabilities": {"0": 0.5, "1": 0.5, "2": 0.0}}},
        {"urgency": {**JEV_ANSWERS["urgency"], "probabilities": {"0": 0.5, "1": 0.5, "2": 0.0}}},
    )
    assert by_name(same_tie_both_sides, "urgency").aligned is True


# --- Noul (§24: probabilityDelta; §26 same side of 0.5; §27 boundary) ---


def test_noul_components_are_exact_formula_values():
    comparison = compare(
        {"refund_requested": MIXED_QUESTIONS["refund_requested"]},
        {"refund_requested": EMULATOR_ANSWERS["refund_requested"]},
        {"refund_requested": JEV_ANSWERS["refund_requested"]},
    )
    question = by_name(comparison, "refund_requested")

    assert question.components.probability_delta == 0.125  # |0.625 - 0.75|
    # §25: Noul fidelity = 1 - probabilityDelta.
    assert question.fidelity == 0.875
    # §26: both probabilities on the same side of 0.5.
    assert question.aligned is True
    assert question.primitive == "noul"


def test_noul_opposite_sides_of_half_are_not_aligned():
    comparison = compare(
        {"refund_requested": MIXED_QUESTIONS["refund_requested"]},
        {"refund_requested": {"type": "noul", "noul": 0.625}},
        {"refund_requested": {"type": "noul", "noul": 0.375}},
    )
    question = by_name(comparison, "refund_requested")

    assert question.fidelity == 0.75
    assert question.aligned is False


def test_noul_both_exactly_at_half_count_as_aligned():
    # PIN (§27): 0.5 is on NEITHER side, so it is its own third category —
    # two probabilities exactly at 0.5 sit in the same category and count
    # as aligned.
    comparison = compare(
        {"refund_requested": MIXED_QUESTIONS["refund_requested"]},
        {"refund_requested": {"type": "noul", "noul": 0.5}},
        {"refund_requested": {"type": "noul", "noul": 0.5}},
    )
    question = by_name(comparison, "refund_requested")

    assert question.components.probability_delta == 0.0
    assert question.fidelity == 1.0
    assert question.aligned is True


def test_noul_half_against_a_strict_side_is_not_aligned():
    # PIN (§27): 0.5 is NOT on either side, so exactly-0.5 versus a strictly
    # below (or strictly above) probability is NOT "same side".
    below = compare(
        {"q": {"type": "noul"}},
        {"q": {"type": "noul", "noul": 0.5}},
        {"q": {"type": "noul", "noul": 0.25}},
    )
    above = compare(
        {"q": {"type": "noul"}},
        {"q": {"type": "noul", "noul": 0.5}},
        {"q": {"type": "noul", "noul": 0.75}},
    )

    assert by_name(below, "q").aligned is False
    assert by_name(above, "q").aligned is False


# P38/FB11: the §26/§27 midpoint categories are computed by the single-sourced
# noul_midpoint_category() and carried in the NoulComponents payload so the
# web composes its verdict without re-deriving the classification
# client-side (precedent: independent_dominant_level, ADR-006 ruling 2).
# Every category combination is pinned: below/below, above/above, crossed,
# (0.5,0.5), (0.5,<0.5) and (0.5,>0.5). All values are dyadic fractions so
# every probability_delta expectation is exact in binary floating point.
@pytest.mark.parametrize(
    ("emulator_noul", "jev_noul", "aligned", "emulator_category", "jev_category", "delta"),
    [
        # below/below and above/above: same category — aligned.
        (0.25, 0.375, True, -1, -1, 0.125),
        (0.625, 0.75, True, 1, 1, 0.125),
        # crossed: strictly opposite sides of the midpoint.
        (0.375, 0.625, False, -1, 1, 0.25),
        # (0.5,0.5): 0.5 is its own third category (§27) — aligned at the
        # midpoint, direction undefined.
        (0.5, 0.5, True, 0, 0, 0.0),
        # 0.5 against a strict side: different categories — not aligned.
        (0.5, 0.25, False, 0, -1, 0.25),
        (0.5, 0.75, False, 0, 1, 0.25),
    ],
)
def test_noul_midpoint_categories_cover_every_category_combination(
    emulator_noul, jev_noul, aligned, emulator_category, jev_category, delta
):
    comparison = compare(
        {"q": {"type": "noul"}},
        {"q": {"type": "noul", "noul": emulator_noul}},
        {"q": {"type": "noul", "noul": jev_noul}},
    )
    components = by_name(comparison, "q").components

    assert components.probability_delta == delta
    assert components.emulator_midpoint_category == emulator_category
    assert components.jev_midpoint_category == jev_category
    assert by_name(comparison, "q").aligned is aligned


# --- Overall fidelity and the frozen result shape ---


def test_mixed_request_end_to_end_comparison_is_exact():
    comparison = compare(MIXED_QUESTIONS, EMULATOR_ANSWERS, JEV_ANSWERS)

    assert [q.name for q in comparison.questions] == list(MIXED_QUESTIONS)
    assert by_name(comparison, "request_type").fidelity == 0.75
    assert by_name(comparison, "urgency").fidelity == 0.8125
    assert by_name(comparison, "refund_requested").fidelity == 0.875
    assert by_name(comparison, "backup_channel").fidelity == 0.5625
    # §25: overallFidelity = mean(questionFidelity[]) = 3.0 / 4.
    assert comparison.overall_fidelity == 0.75
    assert comparison.aligned_questions == 3


def test_overall_fidelity_ignores_question_insertion_order():
    reordered = {
        "backup_channel": MIXED_QUESTIONS["backup_channel"],
        "refund_requested": MIXED_QUESTIONS["refund_requested"],
        "urgency": MIXED_QUESTIONS["urgency"],
        "request_type": MIXED_QUESTIONS["request_type"],
    }

    comparison = compare(reordered, EMULATOR_ANSWERS, JEV_ANSWERS)

    assert comparison.overall_fidelity == 0.75
    assert comparison.aligned_questions == 3
    assert {q.name: q.fidelity for q in comparison.questions} == {
        "request_type": 0.75,
        "urgency": 0.8125,
        "refund_requested": 0.875,
        "backup_channel": 0.5625,
    }


def test_comparison_is_deterministic_across_calls():
    first = compare(MIXED_QUESTIONS, EMULATOR_ANSWERS, JEV_ANSWERS)
    second = compare(MIXED_QUESTIONS, EMULATOR_ANSWERS, JEV_ANSWERS)

    assert first == second
    assert first.questions == second.questions
    assert first.overall_fidelity == second.overall_fidelity


def test_to_payload_matches_the_comparison_snapshot_shape():
    comparison = compare(MIXED_QUESTIONS, EMULATOR_ANSWERS, JEV_ANSWERS)

    payload = comparison.to_payload()

    assert payload["overall_fidelity"] == 0.75
    assert set(payload["questions"]) == set(MIXED_QUESTIONS)
    urgency = payload["questions"]["urgency"]
    assert urgency["primitive"] == "score"
    assert urgency["fidelity"] == 0.8125
    assert urgency["aligned"] is True
    assert urgency["components"] == {
        "score_delta": 0.5,
        "max_score": 2,
        "score_similarity": 0.75,
        "distribution_similarity": 0.875,
        "confidence_delta": 0.125,
        "emulator_dominant_level": "1",
        "jev_dominant_level": "1",
    }
    noul = payload["questions"]["refund_requested"]
    # P38/FB11: the §26/§27 midpoint categories travel in the payload (0.625
    # and 0.75 are both strictly above .5 — category 1 per side).
    assert noul["components"] == {
        "probability_delta": 0.125,
        "emulator_midpoint_category": 1,
        "jev_midpoint_category": 1,
    }
    choice = payload["questions"]["request_type"]
    assert choice["components"] == {
        "decision_match": True,
        "confidence_delta": 0.25,
        "distribution_similarity": 0.75,
    }


def test_no_rounding_happens_anywhere_in_the_domain():
    # Fidelity values are raw deterministic floats; display rounding belongs
    # to the web, never the domain (pin: exact float survives end to end).
    comparison = compare(
        {"q": {"type": "noul"}},
        {"q": {"type": "noul", "noul": 1.0 / 3.0}},
        {"q": {"type": "noul", "noul": 0.0}},
    )

    assert by_name(comparison, "q").fidelity == 1.0 - (1.0 / 3.0)
    assert comparison.overall_fidelity == 1.0 - (1.0 / 3.0)


# --- Loud failures for impossible-through-the-mirror shapes ---


def test_missing_answer_for_a_request_question_raises_loudly():
    with pytest.raises(FidelityComparisonError):
        compare(
            {"q": {"type": "noul"}, "missing": {"type": "noul"}},
            {"q": {"type": "noul", "noul": 0.5}},  # 'missing' never answered
            {"q": {"type": "noul", "noul": 0.5}, "missing": {"type": "noul", "noul": 0.5}},
        )


def test_answer_primitive_mismatching_the_request_raises_loudly():
    with pytest.raises(FidelityComparisonError):
        compare(
            {"q": {"type": "noul"}},
            {"q": {"type": "choice", "choice": "a", "confidence": 1.0, "probabilities": {"a": 1.0}}},
            {"q": {"type": "noul", "noul": 0.5}},
        )


# --- Score probabilities keys validated against the REQUEST rubric (F3) ---


def test_score_probability_keys_contiguous_within_the_rubric_pass():
    # "0","1","2" for a 3-level rubric (maxScore 2) is the canonical shape.
    comparison = compare(
        {"urgency": MIXED_QUESTIONS["urgency"]},
        {"urgency": EMULATOR_ANSWERS["urgency"]},
        {"urgency": JEV_ANSWERS["urgency"]},
    )
    assert by_name(comparison, "urgency").primitive == "score"

    # A single level is still a (trivially) contiguous distribution.
    single = compare(
        {"urgency": MIXED_QUESTIONS["urgency"]},
        {"urgency": {**EMULATOR_ANSWERS["urgency"], "probabilities": {"0": 1.0}}},
        {"urgency": {**JEV_ANSWERS["urgency"], "probabilities": {"1": 1.0}}},
    )
    assert by_name(single, "urgency").aligned is False  # dominant "0" vs "1"


def test_score_probability_key_outside_the_rubric_raises_loudly():
    # maxScore is 2 for a 3-level rubric: "7" is not a rubric index.
    with pytest.raises(FidelityComparisonError):
        compare(
            {"urgency": MIXED_QUESTIONS["urgency"]},
            {"urgency": {**EMULATOR_ANSWERS["urgency"], "probabilities": {"0": 0.5, "7": 0.5}}},
            {"urgency": JEV_ANSWERS["urgency"]},
        )
    # The JEV side is validated identically.
    with pytest.raises(FidelityComparisonError):
        compare(
            {"urgency": MIXED_QUESTIONS["urgency"]},
            {"urgency": EMULATOR_ANSWERS["urgency"]},
            {"urgency": {**JEV_ANSWERS["urgency"], "probabilities": {"0": 0.5, "3": 0.5}}},
        )


def test_score_probability_non_numeric_key_raises_loudly():
    with pytest.raises(FidelityComparisonError):
        compare(
            {"urgency": MIXED_QUESTIONS["urgency"]},
            {"urgency": {**EMULATOR_ANSWERS["urgency"], "probabilities": {"x": 1.0}}},
            {"urgency": JEV_ANSWERS["urgency"]},
        )


def test_score_probability_non_canonical_index_string_raises_loudly():
    # Only the stringified rubric indices pass: "1.0" and "01" are not them.
    with pytest.raises(FidelityComparisonError):
        compare(
            {"urgency": MIXED_QUESTIONS["urgency"]},
            {"urgency": {**EMULATOR_ANSWERS["urgency"], "probabilities": {"1.0": 1.0}}},
            {"urgency": JEV_ANSWERS["urgency"]},
        )
    with pytest.raises(FidelityComparisonError):
        compare(
            {"urgency": MIXED_QUESTIONS["urgency"]},
            {"urgency": {**EMULATOR_ANSWERS["urgency"], "probabilities": {"01": 1.0}}},
            {"urgency": JEV_ANSWERS["urgency"]},
        )


def test_score_probability_keys_with_a_gap_raise_loudly():
    # All keys are valid rubric indices, but "1" is skipped: a distribution
    # with a hole in the rubric is degenerate (B4) and fails loudly instead
    # of feeding the §24 TVD/argmax formulas a silent gap.
    with pytest.raises(FidelityComparisonError):
        compare(
            {"urgency": MIXED_QUESTIONS["urgency"]},
            {"urgency": {**EMULATOR_ANSWERS["urgency"], "probabilities": {"0": 0.625, "2": 0.375}}},
            {"urgency": JEV_ANSWERS["urgency"]},
        )

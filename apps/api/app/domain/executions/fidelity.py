"""Deterministic JEV fidelity comparison (plan §24-§26) — pure functions, no I/O.

This measures mathematical similarity with JEV. It does not measure truth
(plan §25). The functions below implement the plan formulas exactly; answers
are compared through the oracle-exact SystemOneResult mirror, so the §26
"probabilities unavailable" caveat is unreachable here (the mirror requires
probabilities on every choice/score answer).
"""

from __future__ import annotations

from typing import Literal, overload

from app.domain.executions.fidelity_models import (
    ChoiceComponents,
    ComparisonResult,
    NoulComponents,
    QuestionComparison,
    ScoreComponents,
)
from app.domain.requests.models import Primitive
from app.schemas.system_one import (
    ChoiceQuestion,
    ScoreQuestion,
    SystemOneRequest,
)
from app.schemas.system_one_result import (
    ChoiceResult,
    NoulResult,
    PrimitiveResult,
    ScoreResult,
    SystemOneResult,
)

# Plan §26: the Noul alignment boundary. 0.5 is the mathematical midpoint of
# a binary probability (§27) — on NEITHER side — so alignment splits the real
# line into three categories: strictly below, exactly at, and strictly above.
NOUL_BOUNDARY = 0.5


class FidelityComparisonError(Exception):
    """A result cannot be compared against the request.

    The mirror cannot produce these shapes from a well-behaved provider
    (answers exist for every question and match its primitive), so they fail
    loudly instead of being silently skipped.
    """


def compare_system_one_results(
    request: SystemOneRequest,
    emulator: SystemOneResult,
    jev: SystemOneResult,
) -> ComparisonResult:
    """Compare two SystemOneResults for the same canonical request (§24-§26)."""
    comparisons: list[QuestionComparison] = []
    for name, question in request.questions.root.items():
        # The question class and its `type` Literal tag are 1:1 coupled by the
        # mirror union, so dispatching on the class narrows both the question
        # (criteria) and the answer type the comparison receives.
        if isinstance(question, ChoiceQuestion):
            comparison = _compare_choice(
                name, _answer_for(emulator, name, question.type), _answer_for(jev, name, question.type)
            )
        elif isinstance(question, ScoreQuestion):
            comparison = _compare_score(
                name,
                question.criteria,
                _answer_for(emulator, name, question.type),
                _answer_for(jev, name, question.type),
            )
        else:
            comparison = _compare_noul(
                name, _answer_for(emulator, name, question.type), _answer_for(jev, name, question.type)
            )
        comparisons.append(comparison)
    # §25: overallFidelity = mean(questionFidelity[]). Summed in question-name
    # order so the mean never depends on the request's insertion order.
    ordered_fidelities = [
        fidelity
        for _, fidelity in sorted(
            (comparison.name, comparison.fidelity) for comparison in comparisons
        )
    ]
    overall = sum(ordered_fidelities) / len(ordered_fidelities)
    return ComparisonResult(
        questions=tuple(comparisons),
        overall_fidelity=overall,
        aligned_questions=sum(1 for comparison in comparisons if comparison.aligned),
    )


def _compare_choice(name: str, emulator: ChoiceResult, jev: ChoiceResult) -> QuestionComparison:
    # §24 Choice: decisionMatch, confidenceDelta, TVD over the UNION of label
    # keys (a label missing on one side counts as probability 0.0).
    decision_match = emulator.choice == jev.choice
    confidence_delta = abs(emulator.confidence - jev.confidence)
    distribution_similarity = _distribution_similarity(emulator.probabilities, jev.probabilities)
    return QuestionComparison(
        name=name,
        primitive="choice",
        # §25: Choice question fidelity = distributionSimilarity.
        fidelity=distribution_similarity,
        # §26: aligned = same selected choice.
        aligned=decision_match,
        components=ChoiceComponents(
            decision_match=decision_match,
            confidence_delta=confidence_delta,
            distribution_similarity=distribution_similarity,
        ),
    )


def _compare_score(
    name: str,
    criteria: list,
    emulator: ScoreResult,
    jev: ScoreResult,
) -> QuestionComparison:
    # §24 Score: maxScore comes from the REQUEST question's ordered criteria
    # array, not from either result.
    max_score = len(criteria) - 1
    # Judge ruling F3: every score probabilities key must be a valid rubric
    # index of the REQUEST question before the §24 formulas run.
    _validate_score_distribution(name, emulator.probabilities, max_score)
    _validate_score_distribution(name, jev.probabilities, max_score)
    score_delta = abs(emulator.score - jev.score)
    score_similarity = 1 - min(score_delta / max_score, 1)
    distribution_similarity = _distribution_similarity(emulator.probabilities, jev.probabilities)
    confidence_delta = abs(emulator.confidence - jev.confidence)
    emulator_dominant = dominant_rubric_level(emulator.probabilities)
    jev_dominant = dominant_rubric_level(jev.probabilities)
    return QuestionComparison(
        name=name,
        primitive="score",
        # §25: Score fidelity = average(scoreSimilarity, distributionSimilarity).
        fidelity=(score_similarity + distribution_similarity) / 2,
        # §26: aligned = same dominant rubric level (argmax probabilities).
        aligned=emulator_dominant == jev_dominant,
        components=ScoreComponents(
            score_delta=score_delta,
            max_score=max_score,
            score_similarity=score_similarity,
            distribution_similarity=distribution_similarity,
            confidence_delta=confidence_delta,
            emulator_dominant_level=emulator_dominant,
            jev_dominant_level=jev_dominant,
        ),
    )


def _compare_noul(name: str, emulator: NoulResult, jev: NoulResult) -> QuestionComparison:
    probability_delta = abs(emulator.noul - jev.noul)
    # P38/FB11: noul_midpoint_category() is the SINGLE source of the §26/§27
    # classification — the categories flow to the wire so the web composes its
    # verdict from them and never re-derives it client-side.
    emulator_category = noul_midpoint_category(emulator.noul)
    jev_category = noul_midpoint_category(jev.noul)
    return QuestionComparison(
        name=name,
        primitive="noul",
        # §25: Noul fidelity = 1 - probabilityDelta.
        fidelity=1 - probability_delta,
        # §26: aligned = both probabilities in the same category relative to
        # the §27 midpoint (strictly below / exactly at / strictly above).
        aligned=emulator_category == jev_category,
        components=NoulComponents(
            probability_delta=probability_delta,
            emulator_midpoint_category=emulator_category,
            jev_midpoint_category=jev_category,
        ),
    )


def _distribution_similarity(left: dict[str, float], right: dict[str, float]) -> float:
    # §24: TVD = 0.5 x SUM |Pemu(key) - Pjev(key)| over the UNION of keys,
    # missing side as 0.0; distributionSimilarity = 1 - TVD.
    union = left.keys() | right.keys()
    tvd = 0.5 * sum(abs(left.get(key, 0.0) - right.get(key, 0.0)) for key in union)
    return 1 - tvd


def _validate_score_distribution(name: str, probabilities: dict[str, float], max_score: int) -> None:
    """Judge ruling F3: score probabilities keys are stringified rubric
    indices of the REQUEST question (0..maxScore), with no holes.

    An out-of-range ("7"), non-numeric ("x"), or non-canonical ("1.0")
    key — or a gap between valid levels — cannot be compared meaningfully
    against the request's rubric, so it fails loudly instead of silently
    skewing the §24 TVD union and the §26 argmax dominant level.
    """
    valid_levels = {str(level) for level in range(max_score + 1)}
    for key in probabilities:
        if key not in valid_levels:
            raise FidelityComparisonError(
                f"Score probabilities for question '{name}' have key '{key}' "
                f"which is not a rubric level of the request (0..{max_score})."
            )
    levels = sorted(int(key) for key in probabilities)
    if levels != list(range(levels[0], levels[0] + len(levels))):
        raise FidelityComparisonError(
            f"Score probabilities for question '{name}' skip rubric levels "
            f"(keys must be contiguous within 0..{max_score})."
        )


def dominant_rubric_level(probabilities: dict[str, float]) -> str:
    """§26 argmax with a deterministic tie-break: the FIRST key attaining
    the maximum in the map's own iteration order. JSON object key order is
    preserved end-to-end, so this is stable for identical documents.

    Public so the independent alignment (ruling 6) applies the SAME rule —
    the tie-break stays single-sourced in the domain (ADR-004 ruling 2).
    """
    return max(probabilities, key=probabilities.__getitem__)


def noul_midpoint_category(probability: float) -> int:
    """The §26/§27 Noul category: strictly below / exactly at / strictly
    above the 0.5 mathematical midpoint of a binary probability."""
    if probability < NOUL_BOUNDARY:
        return -1
    if probability > NOUL_BOUNDARY:
        return 1
    return 0


@overload
def _answer_for(result: SystemOneResult, name: str, primitive: Literal["choice"]) -> ChoiceResult: ...


@overload
def _answer_for(result: SystemOneResult, name: str, primitive: Literal["score"]) -> ScoreResult: ...


@overload
def _answer_for(result: SystemOneResult, name: str, primitive: Literal["noul"]) -> NoulResult: ...


def _answer_for(
    result: SystemOneResult, name: str, primitive: Primitive
) -> PrimitiveResult:
    if name not in result.answers:
        raise FidelityComparisonError(
            f"Result from model '{result.model}' has no answer for question '{name}'."
        )
    answer = result.answers[name]
    expected = {"choice": ChoiceResult, "score": ScoreResult, "noul": NoulResult}[primitive]
    if not isinstance(answer, expected):
        raise FidelityComparisonError(
            f"Answer for question '{name}' has primitive '{answer.type}' "
            f"but the request declares '{primitive}'."
        )
    return answer

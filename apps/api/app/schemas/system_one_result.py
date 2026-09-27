from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field

from app.schemas.system_one import EntryType

# Degenerate provider results are rejected AT PARSE TIME (dual-review B1):
# a probability-family float is finite and within [0.0, 1.0], so an
# out-of-range/NaN/±inf value becomes EmulatorProviderError/JevProviderError
# in the clients (§66 flow) and never reaches fidelity. Scores are finite but
# deliberately UNBOUNDED — a score may fall between (or beyond) rubric levels;
# the §24 scoreSimilarity formula owns the clamping.
Probability = Annotated[float, Field(ge=0.0, le=1.0, allow_inf_nan=False)]
FiniteFloat = Annotated[float, Field(allow_inf_nan=False)]


class NoulResult(BaseModel):
    """A yes/no answer (oracle: NoulResponse)."""

    type: Literal["noul"]
    noul: Probability

    model_config = {"extra": "forbid"}


class ChoiceResult(BaseModel):
    """A selected label and its probabilities (oracle: ChoiceResponse)."""

    type: Literal["choice"]
    choice: str
    confidence: Probability
    # A distribution needs at least one label to be a distribution.
    probabilities: dict[str, Probability] = Field(min_length=1)

    model_config = {"extra": "forbid"}


class ScoreResult(BaseModel):
    """An expected score with its rubric and probabilities (oracle: ScoreResponse).

    `score` may fall between integer rubric levels. `legend` and
    `probabilities` are keyed by score; JSON object keys are strings.
    """

    type: Literal["score"]
    score: FiniteFloat
    confidence: Probability
    legend: dict[str, EntryType]
    probabilities: dict[str, Probability] = Field(min_length=1)

    model_config = {"extra": "forbid"}


# The answer type for a question (oracle: ResultFor), discriminated on `type`.
PrimitiveResult = Annotated[
    Union[NoulResult, ChoiceResult, ScoreResult],
    Field(discriminator="type"),
]


class Usage(BaseModel):
    """Token usage for a request (oracle: Usage)."""

    input_tokens: int
    output_tokens: int

    model_config = {"extra": "forbid"}


class SystemOneResult(BaseModel):
    """Answers keyed by question name, with model and usage (oracle: SystemOneResult).

    The oracle defines a closed interface here — unlike SystemOneRequest,
    which forwards extra properties — so extras are forbidden.
    """

    model: str
    answers: dict[str, PrimitiveResult]
    usage: Usage

    model_config = {"extra": "forbid"}

from __future__ import annotations

from typing import Any

from app.domain.requests.detection import validate_and_detect
from app.domain.requests.models import RequestDetection


def validate_request(raw: Any) -> RequestDetection:
    """Validate a canonical SystemOneRequest payload and detect its primitives."""
    return validate_and_detect(raw)

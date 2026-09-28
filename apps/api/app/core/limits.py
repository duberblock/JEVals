"""In-process execution admission control (rate + concurrency).

Every POST /api/v1/executions triggers up to four paid provider legs, so
the route admits runs through this module BEFORE any provider work:

* a token bucket refilled at ``per_minute / 60`` tokens per second with
  burst capacity ``per_minute`` (the rate ceiling);
* an in-flight counter (the concurrency ceiling).

Both ceilings come from Settings per call (``<= 0`` disables that
dimension), and the mutable state is module-global behind one lock —
one process, one budget. ``try_acquire_execution`` returns ``None`` when
the run is admitted (the caller MUST ``release_execution`` exactly once)
or the ``Retry-After`` seconds to surface in a 429.
"""

from __future__ import annotations

import math
import threading
import time

_lock = threading.Lock()
_in_flight = 0
# inf = "full bucket": the first acquire clamps to the caller's capacity, so
# a fresh process (or a reset) admits immediately and only future calls are
# bounded. Starting at 0.0 would reject the very first request of a boot.
_tokens = float("inf")
_last_refill = time.monotonic()

# Fixed backoff when only the CONCURRENCY ceiling rejects: the bucket may
# be full, so the honest wait is "until some run finishes", approximated
# here with a short constant the client may retry after.
CONGESTION_RETRY_AFTER_SECONDS = 5


def reset_execution_limits() -> None:
    """Test hook: clear counters and refill the bucket to capacity."""
    global _in_flight, _tokens, _last_refill
    with _lock:
        _in_flight = 0
        _tokens = float("inf")
        _last_refill = time.monotonic()


def try_acquire_execution(max_concurrent: int, per_minute: int) -> int | None:
    """Admit one execution run.

    Returns None when admitted (release_execution is then REQUIRED), or the
    Retry-After seconds for the 429 when a ceiling rejects.
    """
    global _in_flight, _tokens, _last_refill
    with _lock:
        now = time.monotonic()
        if per_minute > 0:
            capacity = float(per_minute)
            refill_per_second = per_minute / 60.0
            _tokens = min(capacity, _tokens + (now - _last_refill) * refill_per_second)
            _last_refill = now
            if _tokens < 1.0:
                return max(1, math.ceil((1.0 - _tokens) / refill_per_second))
            if max_concurrent > 0 and _in_flight >= max_concurrent:
                return CONGESTION_RETRY_AFTER_SECONDS
            _tokens -= 1.0
        elif max_concurrent > 0 and _in_flight >= max_concurrent:
            return CONGESTION_RETRY_AFTER_SECONDS
        _in_flight += 1
        return None


def release_execution() -> None:
    global _in_flight
    with _lock:
        _in_flight = max(0, _in_flight - 1)

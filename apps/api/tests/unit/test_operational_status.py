"""§66 operational view classification (J1/R2 single source).

The domain owns the completed|partial|failed VIEW classification so neither
the routes nor the web re-derive it: 'partial' covers ALL THREE §66 partial
matrices (independent failure, judge failure, JEV failure) — not only the
JEV fidelity-null signature. The persisted §47 `status` stays
completed|failed; 'partial' is never persisted, only delivered.
"""

from app.domain.executions.models import operational_status


def success_section() -> dict:
    return {"status": "success", "model": "stub"}


def failed_section(error: str = "upstream failed") -> dict:
    return {"status": "failed", "error": error}


def test_completed_full_run_with_all_sections_success_is_completed():
    payload = {
        "emulator": success_section(),
        "jev": success_section(),
        "independent_openai": success_section(),
        "ai_evaluation": success_section(),
        "comparison": {"overall_fidelity": 0.95, "questions": {}},
    }
    assert operational_status("completed", payload) == "completed"


def test_jev_failed_partial_is_partial():
    payload = {
        "emulator": success_section(),
        "jev": failed_section("The JEV returned HTTP 503."),
    }
    assert operational_status("completed", payload) == "partial"


def test_independent_failed_partial_is_partial():
    # The §66 independent matrix row: everything else succeeded, so the run
    # completed — but the executed independent leg failed.
    payload = {
        "emulator": success_section(),
        "jev": success_section(),
        "independent_openai": failed_section("The independent LLM prediction failed."),
        "comparison": {"overall_fidelity": 0.95, "questions": {}},
        "ai_evaluation": success_section(),
    }
    assert operational_status("completed", payload) == "partial"


def test_judge_failed_partial_is_partial():
    # The §66 judge matrix row: comparison available, ai_evaluation failed.
    payload = {
        "emulator": success_section(),
        "jev": success_section(),
        "comparison": {"overall_fidelity": 0.95, "questions": {}},
        "ai_evaluation": failed_section("The LLM Judge returned HTTP 503."),
    }
    assert operational_status("completed", payload) == "partial"


def test_emulator_mode_success_without_compare_sections_is_completed():
    payload = {"emulator": success_section()}
    assert operational_status("completed", payload) == "completed"


def test_failed_run_dominates_even_with_all_success_sections():
    payload = {
        "emulator": success_section(),
        "jev": success_section(),
        "ai_evaluation": success_section(),
    }
    assert operational_status("failed", payload) == "failed"


def test_payloads_without_sections_classify_by_status_only():
    # Old/partial payloads that predate the section contract never invent a
    # partial: the persisted status is the only evidence.
    assert operational_status("completed", {}) == "completed"
    assert operational_status("failed", {}) == "failed"


def test_non_dict_sections_are_ignored_never_crash():
    payload = {"emulator": "garbage", "jev": None, "ai_evaluation": ["failed"]}
    assert operational_status("completed", payload) == "completed"


def test_emulator_mode_independent_failed_partial_is_partial():
    # Matrix completion (dual-review R2 QUESTION): the §66 independent matrix
    # row in EMULATOR mode — no compare sections exist, yet the executed
    # independent leg failed, so the run is operationally partial.
    payload = {
        "emulator": success_section(),
        "independent_openai": failed_section("The independent LLM prediction failed."),
    }
    assert operational_status("completed", payload) == "partial"

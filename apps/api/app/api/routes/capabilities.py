from fastapi import APIRouter

from app.core.config import get_settings

router = APIRouter(prefix="/api/v1/capabilities", tags=["capabilities"])


@router.get("")
def get_capabilities() -> dict:
    """Honest provider availability (plan §63): reflect configuration truth.

    Never invent availability or names: emulator and JEV mirror their own
    variables; the OpenAI-compatible provider mirrors its actual execution rule (the key AND the model
    are both required by the independent and judge providers), and
    `openai.models` lists the configured model only when available;
    `default_model` appears only when a real default is configured.
    """
    settings = get_settings()
    # STEP 6: both LLM branches (independent prediction + judge) require the
    # key AND the model — availability mirrors that exact rule.
    openai_available = bool(settings.openai_api_key) and bool(settings.openai_model)
    capabilities = {
        "emulator": {"available": bool(settings.emulator_url)},
        "jev": {"available": bool(settings.typesafe_api_key)},
        "openai": {
            "available": openai_available,
            "models": [settings.openai_model] if openai_available else [],
        },
    }
    if settings.default_model:
        capabilities["default_model"] = settings.default_model
    return capabilities

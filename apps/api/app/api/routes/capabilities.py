from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import get_effective_providers
from app.core.config import get_settings

router = APIRouter(prefix="/api/v1/capabilities", tags=["capabilities"])


@router.get("")
def get_capabilities(
    providers: Annotated[dict, Depends(get_effective_providers)],
) -> dict:
    """Honest provider availability (plan §63): reflect configuration truth.

    Never invent availability or names: the effective configuration (the
    environment layer plus any UI-saved overrides) drives every entry. The
    emulator needs an endpoint, JEV needs a key, and EACH LLM leg (judge,
    independent) needs key AND model — the aggregate `openai` entry is
    available only when BOTH legs are, and lists the distinct configured
    models; `default_model` appears only when a real default is configured.
    """
    settings = get_settings()
    judge_ok = bool(providers["judge"].api_key) and bool(providers["judge"].model)
    independent_ok = bool(providers["independent"].api_key) and bool(
        providers["independent"].model
    )
    llm_available = judge_ok and independent_ok
    models = sorted(
        {
            providers[leg].model
            for leg in ("judge", "independent")
            if llm_available and providers[leg].model
        }
    )
    capabilities = {
        "emulator": {"available": bool(providers["emulator"].endpoint)},
        "jev": {"available": bool(providers["jev"].api_key)},
        "openai": {
            "available": llm_available,
            "models": models if llm_available else [],
        },
    }
    if settings.default_model:
        capabilities["default_model"] = settings.default_model
    return capabilities

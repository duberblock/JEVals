import pytest

from app.api.dependencies import reset_provider_caches
from app.core.config import reset_settings_cache


@pytest.fixture(autouse=True)
def _hermetic_settings_and_providers():
    """Keep env-sensitive singletons hermetic across tests.

    Settings and the provider factories are cached per process (fix-forward
    F10); without this reset a test's monkeypatched environment would leak
    into every later test through the caches.
    """
    reset_settings_cache()
    reset_provider_caches()
    yield
    reset_settings_cache()
    reset_provider_caches()

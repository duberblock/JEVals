import pytest

from app.api.dependencies import reset_provider_caches
from app.core.config import reset_settings_cache
from app.core.limits import reset_execution_limits


@pytest.fixture(autouse=True)
def _hermetic_settings_and_providers():
    """Keep env-sensitive singletons hermetic across tests.

    Settings and the provider factories are cached per process (fix-forward
    F10); without this reset a test's monkeypatched environment would leak
    into every later test through the caches. The execution admission
    state (in-flight counter + rate bucket) is process-global too and
    resets with them — otherwise earlier tests' runs would drain the
    budget of later ones.
    """
    reset_settings_cache()
    reset_provider_caches()
    reset_execution_limits()
    yield
    reset_settings_cache()
    reset_provider_caches()
    reset_execution_limits()

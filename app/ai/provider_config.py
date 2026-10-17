"""Runtime overrides for the single primary MAIN model provider."""
from __future__ import annotations

from ..config import settings


def apply_primary_provider_overrides(
    database_base_url: str, database_api_key: str
) -> tuple[str, str]:
    """Use explicitly configured QWEN provider values over the persisted MAIN entry.

    QWEN_BASE_URL and QWEN_API_KEY also seed model entries on a fresh database,
    but an existing database keeps its persisted entry. Checking model_fields_set
    lets operators change these environment variables without rewriting the DB,
    while preserving stored values when the environment options are omitted.
    """
    configured_fields = getattr(settings, "model_fields_set", set())

    env_base_url = str(getattr(settings, "qwen_base_url", "") or "").strip()
    env_api_key = str(getattr(settings, "qwen_api_key", "") or "").strip()

    base_url = database_base_url
    api_key = database_api_key

    if "qwen_base_url" in configured_fields and env_base_url:
        base_url = env_base_url.rstrip("/")
    if "qwen_api_key" in configured_fields and env_api_key:
        api_key = env_api_key

    return base_url, api_key

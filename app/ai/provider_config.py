"""Runtime overrides for the single primary MAIN model provider."""
from __future__ import annotations

from ..config import settings


def apply_primary_provider_overrides(
    database_provider: str,
    database_base_url: str,
    database_api_key: str,
    database_model: str,
) -> tuple[str, str, str, str]:
    """Apply explicitly configured QWEN provider fields over the persisted MAIN entry.

    Provider, URL, key and model may already be stored in SQLite. Explicit,
    non-empty environment values take precedence without rewriting the DB;
    omitted or empty values preserve the currently saved entry. The model
    entry's internal database UUID is deliberately not changed.
    """
    configured_fields = getattr(settings, "model_fields_set", set())

    env_provider = str(getattr(settings, "qwen_provider", "") or "").strip()
    env_base_url = str(getattr(settings, "qwen_base_url", "") or "").strip()
    env_api_key = str(getattr(settings, "qwen_api_key", "") or "").strip()
    env_model = str(getattr(settings, "qwen_model", "") or "").strip()

    provider = database_provider
    base_url = database_base_url
    api_key = database_api_key
    model = database_model

    if "qwen_provider" in configured_fields and env_provider:
        provider = env_provider
    if "qwen_base_url" in configured_fields and env_base_url:
        base_url = env_base_url.rstrip("/")
    if "qwen_api_key" in configured_fields and env_api_key:
        api_key = env_api_key
    if "qwen_model" in configured_fields and env_model:
        model = env_model

    return provider, base_url, api_key, model

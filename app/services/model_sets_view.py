"""Serialization helpers for model sets (never expose api_key)."""
from __future__ import annotations

from ..models import ModelSet, ModelSetEntry
from ..schemas import ModelSetEntryOut, ModelSetOut


def entry_out(e: ModelSetEntry) -> ModelSetEntryOut:
    return ModelSetEntryOut(
        id=e.id,
        position=e.position,
        provider=e.provider,
        base_url=e.base_url,
        model=e.model,
        temperature=e.temperature,
        max_tokens=e.max_tokens,
        timeout=e.timeout,
        is_active=e.is_active,
        has_api_key=bool(e.api_key),
    )


def model_set_out(ms: ModelSet) -> ModelSetOut:
    return ModelSetOut(
        id=ms.id,
        name=ms.name,
        slug=ms.slug,
        route_type=ms.route_type.value,
        is_active=ms.is_active,
        entries=[entry_out(e) for e in sorted(ms.entries, key=lambda x: x.position)],
    )

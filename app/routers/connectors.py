"""Account-scoped configuration for external service connectors."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, require_csrf
from ..models import User
from ..services.connectors import (
    CONNECTOR_CATALOG,
    delete_connection,
    execute_connector_action,
    list_connector_cards,
    save_connection,
)
from ..services.limits import get_limits, normalize_plan

router = APIRouter(prefix="/api/connectors", tags=["connectors"])


@router.get("")
async def get_connectors(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
) -> dict:
    plan = "pro" if user.is_admin else normalize_plan(user.plan)
    limits = await get_limits(db, plan)
    raw_limit = limits.get("agent_actions", 3)\n    action_limit = max(0, min(50, int(raw_limit if raw_limit is not None else 3)))\n    return await list_connector_cards(db, user, action_limit)


@router.put("/{provider}")
async def connect_provider(
    provider: str,
    data: dict,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        await save_connection(db, user, provider, str((data or {}).get("token") or ""))
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    except Exception as exc:
        # Do not leak tokens, request headers, or provider responses into client errors.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Не удалось проверить или сохранить подключение к сервису.") from exc
    return {"ok": True, "provider": provider, "connected": True}


@router.delete("/{provider}")
async def disconnect_provider(
    provider: str,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    try:
        await delete_connection(db, user, provider)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {"ok": True, "provider": provider, "connected": False}


@router.post("/{provider}/test")
async def test_provider(
    provider: str,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    defaults = {
        "github": ("list_repositories", {}),
        "youtube": ("search_videos", {"query": "AI"}),
        "spotify": ("search_tracks", {"query": "AI"}),
        "gitlab": ("search_projects", {"query": "AI"}),
        "notion": ("search_pages", {"query": "AI"}),
        "slack": ("search_messages", {"query": "AI"}),
        "google_drive": ("search_files", {"query": "AI"}),
        "linear": ("search_issues", {"query": "AI"}),
        "huggingface": ("search_models", {"query": "bert"}),
        "discord": ("list_guilds", {}),
    }
    if provider not in defaults:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Неизвестный коннектор")
    action, payload = defaults[provider]
    try:
        result = await execute_connector_action(db, user.id, provider, action, payload)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {
        "ok": bool(result.get("ok")),
        "provider": provider,
        "message": (
            "Подключение работает."
            if result.get("ok")
            else str(result.get("error") or "Сервис не подтвердил подключение.")[:300]
        ),
    }

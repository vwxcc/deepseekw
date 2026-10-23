"""Admin API: Model Sets and their model entries."""
from __future__ import annotations

import hashlib
import re
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import case, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..deps import get_current_admin, get_db, require_csrf
from ..models import ApiGatewayConfig, Chat, File, Message, ModelSet, ModelSetEntry, ReadableTextModelConfig, RouteType, StatusModelConfig, UsageEvent, User
from ..schemas import (
    AdminChatOut,
    AdminStatsOut,
    ModelSetCreate,
    ModelSetEntryIn,
    ModelSetEntryOut,
    ModelSetEntryUpdate,
    ModelSetOut,
    ModelSetUpdate,
    ShareOut,
    AuxiliaryModelConfigUpdate,
    ApiGatewayConfigUpdate,
)
from ..services.model_sets_view import entry_out, model_set_out

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_admin)],
)


def _slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    if not s:
        # non-latin names (e.g. Cyrillic) would collapse to "" -> use unique suffix
        s = "set-" + uuid.uuid4().hex[:8]
    return s


async def _get_set(db: AsyncSession, set_id: str) -> ModelSet:
    result = await db.execute(
        select(ModelSet)
        .options(selectinload(ModelSet.entries))
        .where(ModelSet.id == set_id)
    )
    ms = result.scalar_one_or_none()
    if ms is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Model Set не найден")
    return ms


def _aux_config_out(config):
    return {
        "provider": config.provider if config else "openai",
        "base_url": config.base_url if config else "",
        "model": config.model if config else "",
        "is_enabled": bool(config.is_enabled) if config else False,
        "configured": bool(config and config.is_enabled and config.base_url.strip() and config.model.strip()),
        "has_api_key": bool(config and config.api_key),
        "price_in": float(config.price_in or 0) if config else 0.0,
        "price_out": float(config.price_out or 0) if config else 0.0,
    }


async def _aux_usage_summary(db: AsyncSession, action: str) -> dict:
    """Show the independent ledger totals for one auxiliary model."""
    row = (
        await db.execute(
            select(
                func.count(UsageEvent.id),
                func.coalesce(func.sum(UsageEvent.tokens_in), 0),
                func.coalesce(func.sum(UsageEvent.tokens_out), 0),
                func.coalesce(func.sum(UsageEvent.cost_usd), 0.0),
            ).where(UsageEvent.action == action)
        )
    ).one()
    return {
        "calls": int(row[0] or 0),
        "tokens_in": int(row[1] or 0),
        "tokens_out": int(row[2] or 0),
        "cost_usd": round(float(row[3] or 0.0), 8),
    }


async def _save_aux_config(db, model_cls, data):
    base_url, model = data.base_url.strip().rstrip("/"), data.model.strip()
    if data.is_enabled and (not base_url or not model):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите Base URL и ID модели или отключите модель")
    config = await db.get(model_cls, 1)
    if config is None:
        config = model_cls(id=1)
        db.add(config)
    config.provider = data.provider.strip()[:64] or "openai"
    config.base_url, config.model = base_url[:512], model[:255]
    config.is_enabled = data.is_enabled
    config.price_in, config.price_out = data.price_in, data.price_out
    if data.api_key.strip():
        config.api_key = data.api_key.strip()[:512]
    await db.commit()
    await db.refresh(config)
    return _aux_config_out(config)


@router.get("/status-model")
async def get_status_model_config(db: AsyncSession = Depends(get_db)):
    return {
        **_aux_config_out(await db.get(StatusModelConfig, 1)),
        "temperature": 1.1,
        "usage": await _aux_usage_summary(db, "status_generation"),
    }


@router.patch("/status-model")
async def patch_status_model_config(data: AuxiliaryModelConfigUpdate, _csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db)):
    saved = await _save_aux_config(db, StatusModelConfig, data)
    return {**saved, "temperature": 1.1, "usage": await _aux_usage_summary(db, "status_generation")}


@router.get("/readable-text-model")
async def get_readable_text_model_config(db: AsyncSession = Depends(get_db)):
    return {
        **_aux_config_out(await db.get(ReadableTextModelConfig, 1)),
        "usage": await _aux_usage_summary(db, "readable_text"),
    }


@router.patch("/readable-text-model")
async def patch_readable_text_model_config(data: AuxiliaryModelConfigUpdate, _csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db)):
    saved = await _save_aux_config(db, ReadableTextModelConfig, data)
    return {**saved, "usage": await _aux_usage_summary(db, "readable_text")}


@router.get("/model-sets", response_model=list[ModelSetOut])
async def list_model_sets(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ModelSet)
        .options(selectinload(ModelSet.entries))
        .order_by(ModelSet.route_type, ModelSet.name)
    )
    return [model_set_out(ms) for ms in result.scalars().all()]


@router.post("/model-sets", response_model=ModelSetOut, status_code=status.HTTP_201_CREATED)
async def create_model_set(
    data: ModelSetCreate, _csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db)
):
    # Selectable clusters are MAIN models; historic auxiliary route rows stay untouched.
    route = RouteType.MAIN
    slug = (data.slug or _slugify(data.name)).strip()
    exists = await db.execute(select(ModelSet).where(ModelSet.slug == slug))
    if exists.scalar_one_or_none() is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Такой slug уже существует")
    ms = ModelSet(
        name=(data.name or "").strip() or "Model Set",
        description=(data.description or "").strip()[:2000],
        slug=slug,
        route_type=route,
        is_active=data.is_active,
        free_access=bool(data.free_access),
    )
    db.add(ms)
    await db.commit()
    return model_set_out(await _get_set(db, ms.id))


@router.patch("/model-sets/{set_id}", response_model=ModelSetOut)
async def update_model_set(
    set_id: str,
    data: ModelSetUpdate,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    ms = await _get_set(db, set_id)
    if data.name is not None and data.name.strip():
        ms.name = data.name.strip()
    if data.description is not None:
        ms.description = data.description.strip()[:2000]
    if data.free_access is not None:
        ms.free_access = bool(data.free_access)
    if data.is_active is not None:
        ms.is_active = data.is_active
    if data.is_default is not None:
        if data.is_default:
            has_active_entry = any(bool(entry.is_active) for entry in (ms.entries or []))
            if (
                not ms.is_active
                or ms.route_type != RouteType.MAIN
                or ms.is_router
                or not has_active_entry
            ):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Для модели по умолчанию нужен активный MAIN-кластер с активной моделью",
                )
            others = await db.execute(select(ModelSet).where(ModelSet.id != ms.id))
            for other in others.scalars().all():
                other.is_default = False
            ms.is_default = True
        else:
            ms.is_default = False
    if not ms.is_active:
        ms.is_default = False
    await db.commit()
    return model_set_out(await _get_set(db, set_id))


@router.delete("/model-sets/{set_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model_set(
    set_id: str, _csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db)
):
    ms = await _get_set(db, set_id)
    await db.delete(ms)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/model-sets/{set_id}/entries",
    response_model=ModelSetEntryOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_entry(
    set_id: str,
    data: ModelSetEntryIn,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    await _get_set(db, set_id)
    e = ModelSetEntry(
        model_set_id=set_id,
        provider=data.provider,
        base_url=data.base_url,
        api_key=data.api_key,
        model=data.model,
        position=data.position,
        temperature=data.temperature,
        max_tokens=data.max_tokens,
        context_len=data.context_len,
        price_in=data.price_in,
        price_out=data.price_out,
        price_cache=data.price_cache,
        timeout=data.timeout,
        is_active=data.is_active,
    )
    db.add(e)
    await db.commit()
    await db.refresh(e)
    return entry_out(e)


@router.patch(
    "/model-sets/{set_id}/entries/{entry_id}", response_model=ModelSetEntryOut
)
async def update_entry(
    set_id: str,
    entry_id: str,
    data: ModelSetEntryUpdate,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    e = await db.get(ModelSetEntry, entry_id)
    if e is None or e.model_set_id != set_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Модель не найдена")
    for field in (
        "provider",
        "base_url",
        "model",
        "position",
        "temperature",
        "max_tokens",
        "context_len",
        "price_in",
        "price_out",
        "price_cache",
        "timeout",
        "is_active",
    ):
        value = getattr(data, field)
        if value is not None:
            setattr(e, field, value)
    if data.api_key:  # пустая строка = оставить прежний ключ
        e.api_key = data.api_key
    await db.commit()
    await db.refresh(e)
    return entry_out(e)


@router.delete(
    "/model-sets/{set_id}/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_entry(
    set_id: str,
    entry_id: str,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    e = await db.get(ModelSetEntry, entry_id)
    if e is None or e.model_set_id != set_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Модель не найдена")
    await db.delete(e)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- OpenAI-compatible API gateway administration ----------

async def _get_api_gateway_config(db: AsyncSession) -> ApiGatewayConfig:
    config = await db.get(ApiGatewayConfig, 1)
    if config is None:
        config = ApiGatewayConfig(id=1)
        db.add(config)
        await db.commit()
        await db.refresh(config)
    return config


async def _api_gateway_payload(db: AsyncSession, config: ApiGatewayConfig) -> dict:
    model_set = None
    if (config.model_set_id or "").strip():
        model_set = (await db.execute(
            select(ModelSet).options(selectinload(ModelSet.entries)).where(ModelSet.id == config.model_set_id)
        )).scalar_one_or_none()
    if model_set is None:
        model_set = (await db.execute(
            select(ModelSet).options(selectinload(ModelSet.entries)).where(
                ModelSet.is_active.is_(True), ModelSet.is_router.is_(False),
                ModelSet.route_type == RouteType.MAIN, ModelSet.is_default.is_(True)
            ).limit(1)
        )).scalars().first()
    if model_set is None:
        model_set = (await db.execute(
            select(ModelSet).options(selectinload(ModelSet.entries)).where(
                ModelSet.is_active.is_(True), ModelSet.is_router.is_(False),
                ModelSet.route_type == RouteType.MAIN
            ).order_by(ModelSet.name).limit(1)
        )).scalars().first()
    entries = [e for e in (model_set.entries if model_set else []) if e.is_active and e.base_url.strip() and e.model.strip()]
    primary = entries[0] if entries else None
    pin = config.price_in if config.price_in is not None else (float(primary.price_in or 0) if primary else 0.0)
    pout = config.price_out if config.price_out is not None else (float(primary.price_out or 0) if primary else 0.0)
    pcache = config.price_cache if config.price_cache is not None else (float(primary.price_cache or 0) if primary else 0.0)
    totals = (await db.execute(select(
        func.count(UsageEvent.id),
        func.coalesce(func.sum(UsageEvent.tokens_in), 0),
        func.coalesce(func.sum(UsageEvent.tokens_out), 0),
        func.coalesce(func.sum(UsageEvent.tokens_cached), 0),
        func.coalesce(func.sum(UsageEvent.cost_usd), 0.0),
    ).where(UsageEvent.action == "api_v1"))).one()
    recent = (await db.execute(
        select(UsageEvent).where(UsageEvent.action == "api_v1")
        .order_by(UsageEvent.created_at.desc()).limit(40)
    )).scalars().all()
    return {
        "enabled": bool(config.enabled),
        "model_set_id": model_set.id if model_set else (config.model_set_id or ""),
        "model_set_name": model_set.name if model_set else "",
        "has_api_key": bool(config.api_key_hash),
        "api_key_prefix": config.api_key_prefix or "",
        "endpoint": "/v1",
        "public_model": "ai-ch",
        "provider_model": primary.model if primary else "",
        "prices": {"input": float(pin or 0), "output": float(pout or 0), "cache_read": float(pcache or 0),
                   "unit": "USD per 1M tokens",
                   "custom": {"input": config.price_in is not None, "output": config.price_out is not None, "cache_read": config.price_cache is not None}},
        "models": [{"id": e.id, "model": e.model, "provider": e.provider,
                    "price_in": float(e.price_in or 0), "price_out": float(e.price_out or 0),
                    "price_cache": float(e.price_cache or 0), "max_tokens": int(e.max_tokens or 0)} for e in entries],
        "usage": {"calls": int(totals[0] or 0), "tokens_in": int(totals[1] or 0),
                  "tokens_out": int(totals[2] or 0), "tokens_cached": int(totals[3] or 0),
                  "cost_usd": round(float(totals[4] or 0.0), 8)},
        "recent": [{"created_at": e.created_at.isoformat() if e.created_at else "",
                    "model": e.model or "", "tokens_in": int(e.tokens_in or 0),
                    "tokens_out": int(e.tokens_out or 0), "tokens_cached": int(e.tokens_cached or 0),
                    "cost_usd": round(float(e.cost_usd or 0), 8)} for e in recent],
    }


@router.get("/api-gateway")
async def get_api_gateway_config(db: AsyncSession = Depends(get_db)):
    return await _api_gateway_payload(db, await _get_api_gateway_config(db))


@router.patch("/api-gateway")
async def patch_api_gateway_config(data: ApiGatewayConfigUpdate, _csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db)):
    config = await _get_api_gateway_config(db)
    if "model_set_id" in data.model_fields_set:
        next_id = (data.model_set_id or "").strip()
        if next_id:
            selected = (await db.execute(
                select(ModelSet).options(selectinload(ModelSet.entries)).where(ModelSet.id == next_id)
            )).scalar_one_or_none()
            usable = bool(selected and selected.is_active and not selected.is_router and selected.route_type == RouteType.MAIN and
                          any(e.is_active and e.base_url.strip() and e.model.strip() for e in (selected.entries or [])))
            if not usable:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Выберите активный MAIN-кластер с настроенной моделью")
            config.model_set_id = selected.id
        elif data.enabled is True or config.enabled:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя очистить модель, пока API включён")
        else:
            config.model_set_id = ""
    if data.enabled is not None:
        if data.enabled and not config.model_set_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Сначала выберите модель для API")
        config.enabled = data.enabled
    for field in ("price_in", "price_out", "price_cache"):
        if field in data.model_fields_set:
            setattr(config, field, getattr(data, field))
    await db.commit()
    await db.refresh(config)
    return await _api_gateway_payload(db, config)


@router.post("/api-gateway/key")
async def regenerate_api_gateway_key(_csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db)):
    config = await _get_api_gateway_config(db)
    key = "aich_" + secrets.token_urlsafe(36)
    config.api_key_hash = hashlib.sha256(key.encode("utf-8")).hexdigest()
    config.api_key_prefix = key[:13]
    await db.commit()
    return {"api_key": key, **(await _api_gateway_payload(db, config))}




# ---------- statistics ----------

@router.get("/stats", response_model=AdminStatsOut)
async def stats(db: AsyncSession = Depends(get_db)):
    users = await db.scalar(select(func.count()).select_from(User))
    chats = await db.scalar(select(func.count()).select_from(Chat))
    messages = await db.scalar(select(func.count()).select_from(Message))
    files = await db.scalar(select(func.count()).select_from(File))
    tin = await db.scalar(select(func.coalesce(func.sum(Message.tokens_in), 0)))
    tout = await db.scalar(select(func.coalesce(func.sum(Message.tokens_out), 0)))
    cached = await db.scalar(select(func.coalesce(func.sum(Message.tokens_cached), 0)))
    up = await db.scalar(
        select(func.count()).select_from(Message).where(Message.rating > 0)
    )
    down = await db.scalar(
        select(func.count()).select_from(Message).where(Message.rating < 0)
    )

    hourly: list[dict] = []
    try:
        rows = await db.execute(
            text(
                "SELECT strftime('%Y-%m-%dT%H:00', created_at) AS h, COUNT(*) AS n, "
                "COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout "
                "FROM messages WHERE created_at >= datetime('now', '-24 hours') "
                "GROUP BY h ORDER BY h"
            )
        )
        hourly = [
            {"hour": r[0], "messages": r[1], "tokens_in": r[2], "tokens_out": r[3]}
            for r in rows.fetchall()
        ]
    except Exception:
        hourly = []

    top_models: list[dict] = []
    try:
        rows = await db.execute(
            text(
                "SELECT ms.name AS name, COUNT(*) AS n FROM messages m "
                "JOIN model_sets ms ON ms.id = m.model_set_id "
                "GROUP BY ms.name ORDER BY n DESC LIMIT 10"
            )
        )
        top_models = [{"name": r[0], "count": r[1]} for r in rows.fetchall()]
    except Exception:
        top_models = []

    return AdminStatsOut(
        users=users or 0,
        chats=chats or 0,
        messages=messages or 0,
        files=files or 0,
        tokens_in=int(tin or 0),
        tokens_out=int(tout or 0),
        tokens_cached=int(cached or 0),
        rating_up=up or 0,
        rating_down=down or 0,
        hourly=hourly,
        top_models=top_models,
    )


def _chat_filter_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Некорректный формат даты фильтра") from exc
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


@router.get("/chats", response_model=list[AdminChatOut])
async def admin_chats(
    limit: int = 10000, offset: int = 0, q: str = "", owner_q: str = "", model_q: str = "",
    sort_by: str = "updated_at", order: str = "desc",
    created_from: str | None = None, created_to: str | None = None,
    updated_from: str | None = None, updated_to: str | None = None,
    min_messages: int | None = None, max_messages: int | None = None,
    min_tokens: int | None = None, max_tokens: int | None = None,
    rating: str = "any", is_public: bool | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Search all non-deleted chats, apply filters, then sort and paginate."""
    limit = max(1, min(int(limit or 10000), 10000))
    offset = max(0, int(offset or 0))
    q, owner_q, model_q = (q or "").strip()[:300], (owner_q or "").strip()[:200], (model_q or "").strip()[:200]
    totals = select(
        Message.chat_id.label("chat_id"),
        func.count(Message.id).label("messages"),
        func.coalesce(func.sum(Message.tokens_in), 0).label("tokens_in"),
        func.coalesce(func.sum(Message.tokens_out), 0).label("tokens_out"),
        func.coalesce(func.sum(Message.tokens_cached), 0).label("tokens_cached"),
        func.coalesce(func.sum(case((Message.rating > 0, 1), else_=0)), 0).label("rating_up"),
        func.coalesce(func.sum(case((Message.rating < 0, 1), else_=0)), 0).label("rating_down"),
    ).group_by(Message.chat_id).subquery()
    query = (select(Chat, User, totals.c.messages, totals.c.tokens_in, totals.c.tokens_out,
                    totals.c.tokens_cached, totals.c.rating_up, totals.c.rating_down)
             .outerjoin(User, User.id == Chat.user_id)
             .outerjoin(totals, totals.c.chat_id == Chat.id)
             .where(Chat.deleted_at.is_(None)))
    if q:
        pattern = "%" + q.replace("%", r"\%").replace("_", r"\_") + "%"
        message_match = select(Message.id).where(Message.chat_id == Chat.id, Message.content.ilike(pattern)).exists()
        model_match = select(ModelSet.id).where(ModelSet.name.ilike(pattern))
        query = query.where(or_(Chat.title.ilike(pattern), Chat.id.ilike(pattern),
                                User.name.ilike(pattern), User.email.ilike(pattern),
                                message_match, Chat.model_set_id.in_(model_match)))
    if owner_q:
        pattern = "%" + owner_q.replace("%", r"\%").replace("_", r"\_") + "%"
        query = query.where(or_(User.name.ilike(pattern), User.email.ilike(pattern)))
    if model_q:
        pattern = "%" + model_q.replace("%", r"\%").replace("_", r"\_") + "%"
        model_match = select(ModelSet.id).where(ModelSet.name.ilike(pattern))
        query = query.where(or_(Chat.model_set_id.in_(model_match),
            select(Message.id).where(Message.chat_id == Chat.id, Message.model_set_id.in_(model_match)).exists()))
    c0,c1,u0,u1 = map(_chat_filter_time,(created_from,created_to,updated_from,updated_to))
    if c0: query=query.where(Chat.created_at >= c0)
    if c1: query=query.where(Chat.created_at <= c1)
    if u0: query=query.where(Chat.updated_at >= u0)
    if u1: query=query.where(Chat.updated_at <= u1)
    if is_public is not None: query=query.where(Chat.is_public.is_(is_public))
    result: list[AdminChatOut] = []
    for row in (await db.execute(query)).all():
        chat, owner, n, tin, tout, cached, up, down = row
        n,tin,tout,cached,up,down = (int(x or 0) for x in (n,tin,tout,cached,up,down))
        total_tokens = tin+tout
        if min_messages is not None and n < max(0,min_messages): continue
        if max_messages is not None and n > max(0,max_messages): continue
        if min_tokens is not None and total_tokens < max(0,min_tokens): continue
        if max_tokens is not None and total_tokens > max(0,max_tokens): continue
        if rating == "up" and up == 0: continue
        if rating == "down" and down == 0: continue
        result.append(AdminChatOut(
            id=chat.id, title=chat.title or "Новый чат",
            owner=((owner.name or "").strip() or owner.email) if owner else "",
            messages=n, tokens_in=tin, tokens_out=tout, tokens_cached=cached,
            rating_up=up, rating_down=down, is_public=bool(chat.is_public),
            share_token=chat.share_token, created_at=chat.created_at, updated_at=chat.updated_at))
    allowed={"title","owner","messages","tokens_in","tokens_out","tokens_cached","rating_up","rating_down","created_at","updated_at"}
    sort_by = sort_by if sort_by in allowed else "updated_at"
    result.sort(key=lambda item: (getattr(item,sort_by).casefold() if isinstance(getattr(item,sort_by),str)
                                  else (getattr(item,sort_by) if getattr(item,sort_by) is not None else "")),
                reverse=(order or "desc").lower() != "asc")
    return result[offset:offset+limit]


@router.post("/chats/{chat_id}/share", response_model=ShareOut)
async def admin_share_chat(
    chat_id: str, _csrf=Depends(require_csrf), db: AsyncSession = Depends(get_db)
):
    chat = await db.get(Chat, chat_id)
    if chat is None or chat.deleted_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Чат не найден")
    if not chat.share_token:
        chat.share_token = uuid.uuid4().hex
    chat.is_public = True
    await db.commit()
    return ShareOut(
        is_public=True, share_token=chat.share_token, url=f"/?share={chat.share_token}"
    )

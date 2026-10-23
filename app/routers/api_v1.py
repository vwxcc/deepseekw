"""OpenAI-compatible /v1 gateway with per-user credentials and token caps."""
from __future__ import annotations

import hashlib
import json
import logging
import math
from datetime import timezone
from types import SimpleNamespace
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sqlalchemy import case, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..deps import get_db
from ..models import ApiGatewayConfig, ModelSet, ModelSetEntry, RouteType, TokenTransaction, User, UserApiKey, utcnow
from ..services.usage import est, record

router = APIRouter(tags=["OpenAI-compatible API"])
log = logging.getLogger("chatstudio.api_v1")


def _client_key(request: Request) -> str:
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (request.headers.get("x-api-key") or "").strip()


async def _authenticate(request: Request, db: AsyncSession):
    config = await db.get(ApiGatewayConfig, 1)
    secret = _client_key(request)
    if not config or not config.enabled or not secret:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется активный личный API-ключ AI CH")
    key_hash = hashlib.sha256(secret.encode("utf-8")).hexdigest()
    key = (await db.execute(select(UserApiKey).where(UserApiKey.key_hash == key_hash))).scalar_one_or_none()
    if key is None or not key.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "API-ключ недействителен или отозван")
    now = utcnow()
    expiry = key.expires_at
    if expiry is not None:
        if expiry.tzinfo is not None:
            expiry = expiry.astimezone(timezone.utc).replace(tzinfo=None)
        if expiry <= now:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Срок действия API-ключа истёк")
    user = await db.get(User, key.user_id)
    if user is None or user.is_guest:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "API доступен только зарегистрированным аккаунтам")
    model_set = (await db.execute(
        select(ModelSet).options(selectinload(ModelSet.entries)).where(
            ModelSet.id == config.model_set_id, ModelSet.is_active.is_(True),
            ModelSet.is_router.is_(False), ModelSet.route_type == RouteType.MAIN,
        )
    )).scalar_one_or_none()
    if model_set is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Администратор не выбрал активную модель API")
    entry = next((item for item in sorted(model_set.entries or [], key=lambda item: item.position)
                  if item.is_active and item.model.strip() and item.base_url.strip()), None)
    if entry is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "В API-кластере нет активной модели")
    parts = urlsplit(entry.base_url.strip())
    if parts.scheme not in ("http", "https") or not parts.netloc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "У модели некорректный Base URL")
    return config, model_set, entry, user, key


def _endpoint(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Не задан Base URL модели")
    return base + "/chat/completions" if base.endswith("/v1") else base + "/v1/chat/completions"


def _priced_entry(entry: ModelSetEntry, config: ApiGatewayConfig):
    return SimpleNamespace(
        id=entry.id, model_set_id=entry.model_set_id, model=entry.model,
        price_in=float(config.price_in if config.price_in is not None else (entry.price_in or 0)),
        price_out=float(config.price_out if config.price_out is not None else (entry.price_out or 0)),
        price_cache=float(config.price_cache if config.price_cache is not None else (entry.price_cache or 0)),
    )


def _usage_counts(usage: dict | None, payload: dict, output: str = "") -> tuple[int, int, int]:
    usage = usage if isinstance(usage, dict) else {}
    tin = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    tout = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    details = usage.get("prompt_tokens_details") or usage.get("input_tokens_details") or {}
    cached = 0
    if isinstance(details, dict):
        cached = int(details.get("cached_tokens") or details.get("cache_read_input_tokens") or details.get("cache_read_tokens") or 0)
    cached = int(usage.get("cache_read_input_tokens") or usage.get("cached_tokens") or cached or 0)
    if tin <= 0:
        tin = est(json.dumps(payload.get("messages") or [], ensure_ascii=False))
    if tout <= 0 and output:
        tout = est(output)
    return max(0, tin), max(0, tout), max(0, min(cached, tin))


async def _reserve_tokens(db: AsyncSession, user: User, key: UserApiKey, payload: dict):
    """Atomically reserve wallet and key capacity before making an upstream request."""
    reserve_input = max(1, math.ceil(est(json.dumps(payload.get("messages") or [], ensure_ascii=False)) * 1.25))
    balance = max(0, int(await db.scalar(select(User.token_balance).where(User.id == user.id)) or 0))
    fresh = (await db.execute(
        select(UserApiKey.token_limit, UserApiKey.tokens_used, UserApiKey.tokens_reserved,
               UserApiKey.max_output_tokens, UserApiKey.is_active)
        .where(UserApiKey.id == key.id, UserApiKey.user_id == user.id)
    )).one_or_none()
    if fresh is None or not fresh.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "API-ключ отозван")
    token_limit, used, reserved, configured_output, _ = fresh
    key_remaining = max(0, int(token_limit) - int(used or 0) - int(reserved or 0)) if token_limit is not None else 2_147_483_647
    if balance <= reserve_input or key_remaining <= reserve_input:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Недостаточно токенов на балансе или лимит ключа исчерпан")
    requested = payload.get("max_completion_tokens", payload.get("max_tokens"))
    try:
        requested = int(requested) if requested is not None else int(configured_output or 2048)
    except (TypeError, ValueError):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "max_tokens должен быть целым числом")
    if requested < 1:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "max_tokens должен быть больше нуля")
    max_output = min(requested, max(1, int(configured_output or 2048)), balance - reserve_input, key_remaining - reserve_input)
    if max_output < 1:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Недостаточно токенов для ответа")
    reservation = reserve_input + max_output
    wallet = await db.execute(
        update(User).where(User.id == user.id, User.token_balance >= reservation)
        .values(token_balance=User.token_balance - reservation)
    )
    if wallet.rowcount != 1:
        await db.rollback()
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Баланс изменился; обновите страницу и повторите запрос")
    key_update = await db.execute(
        update(UserApiKey).where(
            UserApiKey.id == key.id, UserApiKey.user_id == user.id,
            UserApiKey.is_active.is_(True),
            or_(
                UserApiKey.token_limit.is_(None),
                UserApiKey.tokens_used + UserApiKey.tokens_reserved + reservation <= UserApiKey.token_limit,
            ),
        ).values(tokens_reserved=UserApiKey.tokens_reserved + reservation, last_used_at=utcnow())
    )
    if key_update.rowcount != 1:
        await db.rollback()
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Лимит API-ключа исчерпан или ключ отключён")
    await db.commit()
    forwarded = dict(payload)
    forwarded["model"] = "ai-ch"
    if "max_completion_tokens" in forwarded:
        forwarded["max_completion_tokens"] = max_output
    if "max_tokens" in forwarded or "max_completion_tokens" not in forwarded:
        forwarded["max_tokens"] = max_output
    return forwarded, reservation


async def _release_reservation(db: AsyncSession, user_id: str, key_id: str, reservation: int) -> None:
    try:
        await db.execute(update(User).where(User.id == user_id)
                         .values(token_balance=User.token_balance + max(0, int(reservation))))
        await db.execute(update(UserApiKey).where(UserApiKey.id == key_id, UserApiKey.user_id == user_id)
                         .values(tokens_reserved=case(
                             (UserApiKey.tokens_reserved >= reservation, UserApiKey.tokens_reserved - reservation),
                             else_=0,
                         )))
        await db.commit()
    except Exception:
        await db.rollback()
        log.exception("Could not refund API reservation")


async def _settle_usage(db: AsyncSession, config: ApiGatewayConfig, entry: ModelSetEntry,
                        user: User, key: UserApiKey, payload: dict, usage: dict | None,
                        output: str = "", reservation: int = 0) -> None:
    tin, tout, cached = _usage_counts(usage, payload, output)
    actual = max(0, tin + tout)
    if actual <= 0:
        await _release_reservation(db, user.id, key.id, reservation)
        return
    # The reservation is a hard cap: an upstream overrun cannot push the user's
    # wallet negative or silently exceed the per-key token limit.
    charged = min(actual, max(0, int(reservation)))
    await db.execute(update(User).where(User.id == user.id)
                     .values(token_balance=User.token_balance + reservation - charged))
    await db.execute(update(UserApiKey).where(UserApiKey.id == key.id, UserApiKey.user_id == user.id)
                     .values(
                         tokens_reserved=case(
                             (UserApiKey.tokens_reserved >= reservation, UserApiKey.tokens_reserved - reservation),
                             else_=0,
                         ),
                         tokens_used=UserApiKey.tokens_used + charged,
                         last_used_at=utcnow(),
                     ))
    await record(db, user_id=user.id, chat_id=None, message_id=None,
                 entry=_priced_entry(entry, config), action="api_v1",
                 tokens_in=tin, tokens_out=tout, tokens_cached=cached, api_key_id=key.id)
    await db.flush()
    balance_after = max(0, int(await db.scalar(select(User.token_balance).where(User.id == user.id)) or 0))
    db.add(TokenTransaction(
        user_id=user.id, api_key_id=key.id, amount=-charged,
        balance_after=balance_after, action="api_usage",
        reason=f"API-запрос · {tin} входных + {tout} выходных токенов",
    ))
    await db.commit()


@router.get("/v1/info")
async def public_api_info(db: AsyncSession = Depends(get_db)):
    config = await db.get(ApiGatewayConfig, 1)
    if config is None:
        return {"enabled": False, "configured": False, "public_model": "ai-ch", "base_path": "/v1",
                "message": "API пока не настроен администратором"}
    model_set = None
    if config.model_set_id:
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
    entry = next((item for item in sorted(model_set.entries or [], key=lambda item: item.position)
                  if item.is_active and item.model.strip() and item.base_url.strip()), None) if model_set else None
    configured = bool(model_set and model_set.is_active and entry)
    return {
        "enabled": bool(config.enabled and configured), "configured": configured,
        "public_model": "ai-ch", "base_path": "/v1", "model_set_name": model_set.name if model_set else "",
        "prices": {
            "input": float(config.price_in if config.price_in is not None else (entry.price_in if entry else 0) or 0),
            "output": float(config.price_out if config.price_out is not None else (entry.price_out if entry else 0) or 0),
            "cache_read": float(config.price_cache if config.price_cache is not None else (entry.price_cache if entry else 0) or 0),
            "unit": "USD per 1M tokens",
        },
        "endpoints": ["/v1/models", "/v1/chat/completions"],
        "features": ["chat_completions", "streaming_sse", "per_user_keys", "token_limits"],
        "message": "API готов к подключениям" if config.enabled and configured else "API пока не включён администратором",
    }


@router.get("/v1/models")
async def list_models(request: Request, db: AsyncSession = Depends(get_db)):
    _, selected, _, _, _ = await _authenticate(request, db)
    data = [{"id": "ai-ch", "object": "model", "created": 0, "owned_by": "ai-ch"}]
    if selected.slug != "ai-ch":
        data.append({"id": selected.slug, "object": "model", "created": 0, "owned_by": "ai-ch"})
    return {"object": "list", "data": data}


@router.post("/v1/chat/completions")
async def chat_completions(request: Request, payload: dict = Body(...), db: AsyncSession = Depends(get_db)):
    config, _, entry, user, key = await _authenticate(request, db)
    try:
        if len(json.dumps(payload, ensure_ascii=False).encode("utf-8")) > 5 * 1024 * 1024:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Тело запроса больше 5 МБ")
    except (TypeError, ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Некорректный JSON-запрос") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("messages"), list) or not payload["messages"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Поле messages должно быть непустым массивом")
    forwarded, reservation = await _reserve_tokens(db, user, key, payload)
    stream = bool(forwarded.get("stream"))
    timeout = min(900.0, max(15.0, float(entry.timeout or 300)))
    headers = {"Accept": "text/event-stream" if stream else "application/json"}
    if entry.api_key:
        headers["Authorization"] = "Bearer " + entry.api_key
    client = httpx.AsyncClient(timeout=httpx.Timeout(timeout))
    url = _endpoint(entry.base_url)

    if not stream:
        try:
            response = await client.post(url, json=forwarded, headers=headers)
            media = response.headers.get("content-type", "application/json").split(";")[0]
            if response.status_code >= 400:
                await _release_reservation(db, user.id, key.id, reservation)
                return Response(content=response.content, status_code=response.status_code, media_type=media)
            try:
                data = response.json()
            except ValueError:
                await _settle_usage(db, config, entry, user, key, forwarded, None, response.text, reservation)
                return Response(content=response.content, status_code=response.status_code, media_type=media)
            output = []
            for choice in data.get("choices") or [] if isinstance(data, dict) else []:
                message = choice.get("message") if isinstance(choice, dict) else {}
                if isinstance(message, dict):
                    value = message.get("content") or message.get("reasoning") or ""
                    output.append(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))
            usage = data.get("usage") if isinstance(data, dict) else None
            await _settle_usage(db, config, entry, user, key, forwarded, usage, "".join(output), reservation)
            return JSONResponse(content=data, status_code=response.status_code)
        except HTTPException:
            await _release_reservation(db, user.id, key.id, reservation)
            raise
        except httpx.TimeoutException as exc:
            await _release_reservation(db, user.id, key.id, reservation)
            raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, "Модель не ответила вовремя") from exc
        except httpx.HTTPError as exc:
            await _release_reservation(db, user.id, key.id, reservation)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Не удалось соединиться с провайдером модели") from exc
        except Exception:
            await _release_reservation(db, user.id, key.id, reservation)
            raise
        finally:
            await client.aclose()

    manager = client.stream("POST", url, json=forwarded, headers=headers)
    try:
        upstream = await manager.__aenter__()
    except httpx.TimeoutException as exc:
        await client.aclose()
        await _release_reservation(db, user.id, key.id, reservation)
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, "Модель не ответила вовремя") from exc
    except httpx.HTTPError as exc:
        await client.aclose()
        await _release_reservation(db, user.id, key.id, reservation)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Не удалось соединиться с провайдером модели") from exc
    if upstream.status_code >= 400:
        body = await upstream.aread()
        await manager.__aexit__(None, None, None)
        await client.aclose()
        await _release_reservation(db, user.id, key.id, reservation)
        return Response(content=body, status_code=upstream.status_code,
                        media_type=upstream.headers.get("content-type", "application/json").split(";")[0])

    async def proxy_stream():
        buffer = b""
        usage: dict = {}
        parts: list[str] = []

        def consume(line: bytes):
            nonlocal usage
            line = line.strip()
            if not line.startswith(b"data:"):
                return
            raw = line[5:].strip()
            if not raw or raw == b"[DONE]":
                return
            try:
                event = json.loads(raw.decode("utf-8", errors="replace"))
            except (ValueError, UnicodeDecodeError):
                return
            if not isinstance(event, dict):
                return
            if isinstance(event.get("usage"), dict):
                usage = event["usage"]
            for choice in event.get("choices") or []:
                delta = choice.get("delta") if isinstance(choice, dict) else None
                if isinstance(delta, dict):
                    value = delta.get("content") or delta.get("reasoning") or ""
                    parts.append(value if isinstance(value, str) else
                                 (json.dumps(value, ensure_ascii=False) if value else ""))

        try:
            async for chunk in upstream.aiter_bytes():
                buffer += chunk
                yield chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    consume(line)
            if buffer:
                consume(buffer)
        finally:
            try:
                await _settle_usage(db, config, entry, user, key, forwarded, usage, "".join(parts), reservation)
            except Exception:
                log.exception("Could not settle API token usage; attempting to refund reservation")
                try:
                    await db.rollback()
                except Exception:
                    pass
                await _release_reservation(db, user.id, key.id, reservation)
            try:
                await manager.__aexit__(None, None, None)
            finally:
                await client.aclose()

    return StreamingResponse(
        proxy_stream(), status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type", "text/event-stream").split(";")[0],
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

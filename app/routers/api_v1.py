"""OpenAI-compatible /v1 gateway using an admin-selected model cluster."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
from types import SimpleNamespace
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..deps import get_db
from ..models import ApiGatewayConfig, ModelSet, ModelSetEntry, RouteType
from ..services.usage import est, record

router = APIRouter(tags=["OpenAI-compatible API"])
log = logging.getLogger("chatstudio.api_v1")


def _client_key(request: Request) -> str:
    auth = (request.headers.get("authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (request.headers.get("x-api-key") or "").strip()


async def _authenticate(request: Request, db: AsyncSession) -> tuple[ApiGatewayConfig, ModelSet, ModelSetEntry]:
    config = await db.get(ApiGatewayConfig, 1)
    key = _client_key(request)
    if not config or not config.api_key_hash or not key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется действующий API-ключ")
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(digest, config.api_key_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный API-ключ")
    if not config.enabled:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "API отключён администратором")
    model_set = (await db.execute(
        select(ModelSet).options(selectinload(ModelSet.entries)).where(
            ModelSet.id == config.model_set_id, ModelSet.is_active.is_(True),
            ModelSet.is_router.is_(False), ModelSet.route_type == RouteType.MAIN)
    )).scalar_one_or_none()
    if model_set is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "В админке не выбрана активная модель API")
    entry = next((e for e in sorted(model_set.entries or [], key=lambda value:value.position)
                  if e.is_active and e.model.strip() and e.base_url.strip()), None)
    if entry is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "В выбранном кластере нет настроенной активной модели")
    parts = urlsplit(entry.base_url.strip())
    if parts.scheme not in ("http","https") or not parts.netloc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "У модели некорректный Base URL")
    return config, model_set, entry


def _endpoint(base_url: str) -> str:
    base=(base_url or "").strip().rstrip("/")
    if not base: raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,"Не задан Base URL модели")
    return base+"/chat/completions" if base.endswith("/v1") else base+"/v1/chat/completions"


def _priced_entry(entry: ModelSetEntry, config: ApiGatewayConfig):
    return SimpleNamespace(
        id=entry.id, model_set_id=entry.model_set_id, model=entry.model,
        price_in=float(config.price_in if config.price_in is not None else (entry.price_in or 0)),
        price_out=float(config.price_out if config.price_out is not None else (entry.price_out or 0)),
        price_cache=float(config.price_cache if config.price_cache is not None else (entry.price_cache or 0)))


def _usage_counts(usage: dict | None, payload: dict, output: str = "") -> tuple[int,int,int]:
    usage=usage if isinstance(usage,dict) else {}
    tin=int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    tout=int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    details=usage.get("prompt_tokens_details") or usage.get("input_tokens_details") or {}
    cached=0
    if isinstance(details,dict):
        cached=int(details.get("cached_tokens") or details.get("cache_read_input_tokens") or details.get("cache_read_tokens") or 0)
    cached=int(usage.get("cache_read_input_tokens") or usage.get("cached_tokens") or cached or 0)
    if tin<=0: tin=est(json.dumps(payload.get("messages") or [],ensure_ascii=False))
    if tout<=0 and output: tout=est(output)
    return max(0,tin),max(0,tout),max(0,min(cached,tin))


async def _record_usage(db, config, entry, payload, usage, output=""):
    tin,tout,cached=_usage_counts(usage,payload,output)
    if tin+tout<=0: return
    await record(db,user_id=None,chat_id=None,message_id=None,entry=_priced_entry(entry,config),
                 action="api_v1",tokens_in=tin,tokens_out=tout,tokens_cached=cached)
    await db.commit()


@router.get("/v1/models")
async def list_models(request: Request, db: AsyncSession = Depends(get_db)):
    _, selected, _ = await _authenticate(request,db)
    data=[{"id":"ai-ch","object":"model","created":0,"owned_by":"ai-ch"}]
    if selected.slug != "ai-ch": data.append({"id":selected.slug,"object":"model","created":0,"owned_by":"ai-ch"})
    return {"object":"list","data":data}


@router.post("/v1/chat/completions")
async def chat_completions(request: Request, payload: dict = Body(...), db: AsyncSession = Depends(get_db)):
    config, _, entry = await _authenticate(request,db)
    try:
        if len(json.dumps(payload,ensure_ascii=False).encode("utf-8")) > 5*1024*1024:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,"Тело запроса больше 5 МБ")
    except (TypeError,ValueError) as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,"Некорректный JSON-запрос") from exc
    if not isinstance(payload,dict) or not isinstance(payload.get("messages"),list) or not payload["messages"]:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,"Поле messages должно быть непустым массивом")
    forwarded=dict(payload)
    forwarded["model"]=entry.model
    stream=bool(forwarded.get("stream"))
    timeout=min(900.0,max(15.0,float(entry.timeout or 300)))
    headers={"Accept":"text/event-stream" if stream else "application/json"}
    if entry.api_key: headers["Authorization"]="Bearer "+entry.api_key
    client=httpx.AsyncClient(timeout=httpx.Timeout(timeout))
    url=_endpoint(entry.base_url)
    if not stream:
        try:
            response=await client.post(url,json=forwarded,headers=headers)
            media=(response.headers.get("content-type","application/json").split(";")[0])
            if response.status_code>=400:
                return Response(content=response.content,status_code=response.status_code,media_type=media)
            try: data=response.json()
            except ValueError: return Response(content=response.content,status_code=response.status_code,media_type=media)
            usage=data.get("usage") if isinstance(data,dict) else None
            output=[]
            for choice in (data.get("choices") or []) if isinstance(data,dict) else []:
                msg=choice.get("message") if isinstance(choice,dict) else {}
                if isinstance(msg,dict):
                    value=msg.get("content") or msg.get("reasoning") or ""
                    output.append(value if isinstance(value,str) else json.dumps(value,ensure_ascii=False))
            await _record_usage(db,config,entry,forwarded,usage,"".join(output))
            return JSONResponse(content=data,status_code=response.status_code)
        except HTTPException: raise
        except httpx.TimeoutException as exc:
            raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT,"Модель не ответила вовремя") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY,"Не удалось соединиться с провайдером модели") from exc
        finally:
            await client.aclose()

    manager=client.stream("POST",url,json=forwarded,headers=headers)
    try: upstream=await manager.__aenter__()
    except httpx.TimeoutException as exc:
        await client.aclose(); raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT,"Модель не ответила вовремя") from exc
    except httpx.HTTPError as exc:
        await client.aclose(); raise HTTPException(status.HTTP_502_BAD_GATEWAY,"Не удалось соединиться с провайдером модели") from exc
    if upstream.status_code>=400:
        body=await upstream.aread()
        await manager.__aexit__(None,None,None); await client.aclose()
        return Response(content=body,status_code=upstream.status_code,
                        media_type=upstream.headers.get("content-type","application/json").split(";")[0])

    async def proxy_stream():
        buffer=b""; usage={}; parts=[]
        def consume(line: bytes):
            nonlocal usage
            line=line.strip()
            if not line.startswith(b"data:"): return
            raw=line[5:].strip()
            if not raw or raw==b"[DONE]": return
            try: event=json.loads(raw.decode("utf-8",errors="replace"))
            except (ValueError,UnicodeDecodeError): return
            if not isinstance(event,dict): return
            if isinstance(event.get("usage"),dict): usage=event["usage"]
            for choice in event.get("choices") or []:
                delta=choice.get("delta") if isinstance(choice,dict) else None
                if isinstance(delta,dict):
                    value=delta.get("content") or delta.get("reasoning") or ""
                    parts.append(value if isinstance(value,str) else (json.dumps(value,ensure_ascii=False) if value else ""))
        try:
            async for chunk in upstream.aiter_bytes():
                buffer+=chunk
                yield chunk
                while b"\n" in buffer:
                    line,buffer=buffer.split(b"\n",1); consume(line)
            if buffer: consume(buffer)
        finally:
            try: await _record_usage(db,config,entry,forwarded,usage,"".join(parts))
            except Exception:
                log.exception("Could not record usage for /v1 streaming response")
                try: await db.rollback()
                except Exception: pass
            try: await manager.__aexit__(None,None,None)
            finally: await client.aclose()

    return StreamingResponse(proxy_stream(),status_code=upstream.status_code,
        media_type=upstream.headers.get("content-type","text/event-stream").split(";")[0],
        headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})

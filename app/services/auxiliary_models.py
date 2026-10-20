"""Auxiliary model calls for live statuses and speech-text normalization."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from types import SimpleNamespace
from typing import Any

import httpx

from ..database import SessionLocal
from ..models import StatusModelConfig
from .usage import est, record

log = logging.getLogger("chatstudio.auxiliary_models")

_EMOJI_RE = re.compile(r"[\U0001F000-\U0001FAFF\u2300-\u23FF\u2600-\u27BF\uFE0E\uFE0F\u200D\u20E3]")


def _safe_status(item: Any) -> str:
    """Return plain status text; the website renders its own monochrome icon."""
    if isinstance(item, dict):
        value = str(item.get("text") or item.get("status") or "").strip()
    else:
        value = str(item or "").strip()
    value = _EMOJI_RE.sub(" ", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value[:180] if value else ""


def _status_key(value: str) -> str:
    return re.sub(r"\W+", " ", value.casefold(), flags=re.UNICODE).strip()


def _unique_statuses(values: list[Any], limit: int, excluded: set[str] | None = None) -> list[str]:
    seen = set(excluded or ())
    result: list[str] = []
    for item in values:
        value = _safe_status(item)
        key = _status_key(value)
        if not value or not key or key in seen:
            continue
        seen.add(key)
        result.append(value)
        if len(result) >= limit:
            break
    return result





def _content_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(str(part.get("text") or "") for part in value
                        if isinstance(part, dict) and part.get("text"))
    return ""


async def record_auxiliary_usage(
    *, user_id: str | None, chat_id: str | None, message_id: str | None,
    model: str, price_in: float, price_out: float, action: str,
    prompt_text: str, response_text: str, usage: dict | None = None,
) -> None:
    """Save auxiliary-model usage at admin-configured per-million-token rates."""
    if not user_id:
        return
    usage = usage if isinstance(usage, dict) else {}
    raw_in = usage.get("prompt_tokens", usage.get("input_tokens"))
    raw_out = usage.get("completion_tokens", usage.get("output_tokens"))
    try:
        tokens_in = max(1, int(raw_in)) if raw_in is not None and int(raw_in) > 0 else est(prompt_text)
    except (TypeError, ValueError):
        tokens_in = est(prompt_text)
    try:
        tokens_out = max(0, int(raw_out)) if raw_out is not None else est(response_text)
    except (TypeError, ValueError):
        tokens_out = est(response_text)
    entry = SimpleNamespace(
        id=None, model_set_id=None, model=str(model or "auxiliary-model"),
        price_in=max(0.0, float(price_in or 0.0)),
        price_out=max(0.0, float(price_out or 0.0)), price_cache=0.0,
    )
    async with SessionLocal() as db:
        await record(
            db, user_id=user_id, chat_id=chat_id, message_id=message_id,
            entry=entry, action=action, tokens_in=tokens_in, tokens_out=tokens_out,
        )
        await db.commit()


async def generate_statuses(job) -> list[str]:
    """Generate progress statuses concurrently with the primary model."""
    async with SessionLocal() as db:
        cfg = await db.get(StatusModelConfig, 1)
        if not cfg or not cfg.is_enabled:
            return []
        base_url = str(cfg.base_url or "").strip().rstrip("/")
        api_key = str(cfg.api_key or "").strip()
        model = str(cfg.model or "").strip()
        price_in, price_out = float(cfg.price_in or 0.0), float(cfg.price_out or 0.0)
    if not base_url or not model:
        return []
    if any(ord(ch) < 33 or ord(ch) > 126 for ch in api_key):
        log.warning("Status model API key contains invalid header characters")
        return []
    endpoint = base_url if base_url.endswith("/chat/completions") else base_url + "/chat/completions"
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    # Keep the status-model context bounded: only the current user request, up to 10k chars.
    user_text = str(getattr(job, "user_text", "") or "").strip()[:10000]
    system_prompt = (
        "Создавай короткие, разные статусы прогресса на русском по запросу пользователя. "
        "Верни только JSON: statuses и reserve, в каждом элементе только text. "
        "Сгенерируй 20 основных и 12 запасных статусов по 2–8 слов; каждый должен соответствовать "
        "теме запроса, продолжать логичную последовательность и не повторять смысл других. "
        "Не используй общие фразы не по теме, скрытые рассуждения, эмодзи или другие значки. "
        "Не утверждай, что действие, поиск или проверка уже выполнены. Иконки добавляет интерфейс AI CH."
    )
    prompt_text = system_prompt + "\nЗапрос пользователя:\n" + user_text
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Запрос пользователя:\n" + user_text},
        ],
        "temperature": 0.85,
        "max_tokens": 1900,
    }
    raw_text, usage = "", None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(18, connect=6)) as client:
            response = await client.post(endpoint, headers=headers, json=payload)
        response.raise_for_status()
        result = response.json()
        usage = result.get("usage") if isinstance(result, dict) else None
        raw_text = _content_text(result["choices"][0]["message"]["content"])
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        log.debug("Auxiliary status generation unavailable: %s", type(exc).__name__)
        return []

    raw_json = raw_text.strip()
    fence = chr(96) * 3
    if raw_json.startswith(fence):
        raw_json = raw_json.removeprefix(fence + "json").removeprefix(fence).removesuffix(fence).strip()
    try:
        parsed = json.loads(raw_json)
    except (ValueError, TypeError):
        parsed = None
    if isinstance(parsed, dict):
        main = parsed.get("statuses", parsed.get("main", []))
        reserve = parsed.get("reserve", parsed.get("backup", []))
    elif isinstance(parsed, list):
        main, reserve = parsed[:20], parsed[20:32]
    else:
        main, reserve = [line.strip(" -•\t") for line in raw_text.splitlines() if line.strip()], []
    if not isinstance(main, list):
        main = []
    if not isinstance(reserve, list):
        reserve = []
    clean_main = _unique_statuses(main, 20)
    main_keys = {_status_key(value) for value in clean_main}
    clean_reserve = _unique_statuses(reserve, 12, excluded=main_keys)
    # Never append generic canned statuses: every visible preview item must come
    # from this request's configured status model.
    statuses = clean_main + clean_reserve
    try:
        await record_auxiliary_usage(
            user_id=getattr(job, "user_id", None),
            chat_id=getattr(job, "chat_id", None),
            message_id=getattr(job, "message_id", None),
            model=model, price_in=price_in, price_out=price_out,
            action="status_generation", prompt_text=prompt_text,
            response_text=raw_text, usage=usage,
        )
    except Exception:
        log.exception("Could not account for status model usage")
    return statuses

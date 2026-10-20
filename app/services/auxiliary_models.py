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

_MAIN_FALLBACK = [
    "🔎 Изучаю формулировку запроса", "🧭 Выбираю способ решения",
    "📚 Сопоставляю важные сведения", "🧩 Разбираю задачу на части",
    "🧠 Проверяю возможные варианты", "✍️ Готовлю связное объяснение",
    "🔢 Уточняю числа и обозначения", "🧪 Проверяю промежуточный результат",
    "🧷 Связываю детали в единое решение", "📐 Проверяю логику рассуждения",
    "🔍 Уточняю важные детали", "🗂️ Упорядочиваю сведения",
    "🛠️ Подбираю точные формулировки", "📖 Сверяю выводы с условием",
    "🧮 Проверяю вычисления", "🧭 Сверяю ход решения с целью",
    "📝 Структурирую объяснение", "🔬 Проверяю тонкие моменты",
    "✅ Перепроверяю основные выводы", "📋 Собираю итоговый ответ",
    "🧠 Проверяю, не упущено ли что-то важное", "🔎 Уточняю последнюю деталь",
    "📎 Проверяю согласованность частей", "✍️ Довожу объяснение до ясного вида",
    "🧩 Сверяю детали между собой", "📊 Проверяю итоговые данные",
    "🛡️ Проверяю ответ на противоречия", "📚 Уточняю контекст",
    "🧾 Подготавливаю краткие выводы", "🔧 Исправляю неясные места",
    "🧠 Проверяю последовательность ответа", "🔍 Провожу финальную проверку",
    "📌 Выделяю самое важное", "🧮 Сверяю результат",
    "📄 Привожу ответ в порядок", "✅ Заканчиваю проверку",
    "🗒️ Проверяю полноту объяснения", "🧭 Сверяю вывод с вопросом",
    "✨ Готовлю окончательную формулировку", "📦 Собираю результат",
]
_RESERVE_FALLBACK = [
    "⏳ Продолжаю проверять детали", "🔎 Проверяю ещё один возможный нюанс",
    "🧠 Уточняю ход рассуждения", "📐 Пересматриваю ключевой шаг",
    "🧮 Сверяю вычисления повторно", "📚 Проверяю контекст и определения",
    "🧩 Уточняю связь между частями", "🛠️ Проверяю понятность объяснения",
    "📝 Уточняю формулировки", "🔍 Сверяю результат с условием",
    "📊 Проверяю согласованность данных", "🧪 Перепроверяю спорный момент",
    "🧭 Проверяю выбранный подход", "📖 Уточняю значение терминов",
    "🔢 Пересчитываю ключевые значения", "🛡️ Проверяю ответ на ошибки",
    "✍️ Делаю объяснение последовательнее", "🗂️ Уточняю порядок изложения",
    "✅ Проверяю полноту результата", "📋 Готовлю окончательную проверку",
]


def fallback_statuses() -> list[str]:
    """Return a complete local sequence while the configured status model starts."""
    return list(_MAIN_FALLBACK) + list(_RESERVE_FALLBACK)


def _safe_status(item: Any) -> str:
    if isinstance(item, dict):
        emoji = str(item.get("emoji") or "").strip()
        text = str(item.get("text") or item.get("status") or "").strip()
        value = f"{emoji} {text}".strip()
    else:
        value = str(item or "").strip()
    value = re.sub(r"\s+", " ", value).strip()
    if not value:
        return ""
    if not re.match(r"^[\U0001F000-\U0001FAFF\u2600-\u27BF]", value):
        lower = value.lower()
        emoji = "🔍" if any(w in lower for w in ("поиск", "источник", "интернет")) else (
            "🧮" if any(w in lower for w in ("вычис", "числ", "математ")) else (
                "✅" if any(w in lower for w in ("провер", "готов", "заверш")) else "🧠"
            )
        )
        value = f"{emoji} {value}"
    return value[:180]


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
    user_text = str(getattr(job, "user_text", "") or "").strip()[:2200]
    system_prompt = (
        "Ты создаёшь короткие видимые статусы прогресса для интерфейса ИИ. "
        "Не показывай скрытые рассуждения и не утверждай, что реально выполнил неизвестное действие. "
        "Статусы правдоподобные, разнообразные, на русском, по 2–7 слов и с подходящим эмодзи. "
        "Верни строго JSON без Markdown с массивами statuses и reserve, элемент каждого массива "
        "имеет поля emoji и text. Сгенерируй ровно 40 основных статусов в естественном порядке "
        "и ровно 20 запасных статусов в reserve для долгого ожидания. Запасные идут после основных. "
        "Без нумерации и пояснений."
    )
    prompt_text = system_prompt + "\nЗапрос пользователя:\n" + user_text
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Запрос пользователя:\n" + user_text},
        ],
        "temperature": 1.1,
        "max_tokens": 2600,
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
        main, reserve = parsed[:40], parsed[40:60]
    else:
        main, reserve = [line.strip(" -•\t") for line in raw_text.splitlines() if line.strip()], []
    if not isinstance(main, list):
        main = []
    if not isinstance(reserve, list):
        reserve = []
    clean_main = [value for value in (_safe_status(item) for item in main) if value][:40]
    clean_reserve = [value for value in (_safe_status(item) for item in reserve) if value][:20]
    for item in _MAIN_FALLBACK:
        if len(clean_main) >= 40:
            break
        if item not in clean_main:
            clean_main.append(item)
    for item in _RESERVE_FALLBACK:
        if len(clean_reserve) >= 20:
            break
        if item not in clean_main and item not in clean_reserve:
            clean_reserve.append(item)
    statuses = clean_main[:40] + clean_reserve[:20]
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

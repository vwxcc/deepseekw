"""Background generation and exact-title lookup for admin-managed prepared answers."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from ..ai import prompts
from ..ai.providers import complete_chat_with_usage
from ..config import settings
from ..database import SessionLocal
from ..models import (
    ModelSet, ModelSetEntry, ReadyAnswer, ReadyAnswerSeed, ReadyAnswerSettings,
    ReadyAnswerTask, ReadyAnswerTitle, RouteType, UsageEvent, utcnow,
)

log = logging.getLogger("chatstudio.ready_answers")

SEED_QUESTIONS = [
    "Объясни, что такое рекурсия в Python, на простом примере.",
    "Чем список отличается от кортежа в Python?",
    "Что такое сложность алгоритма O(n) и O(log n)?",
    "Как работает бинарный поиск и когда его можно применять?",
    "Объясни, что такое IP-адрес и маска подсети.",
    "Как решать квадратные уравнения?",
    "Что такое производная и как её находить?",
    "Как найти наибольшее значение функции на отрезке?",
    "Объясни проценты: последовательное повышение и снижение цены.",
    "Как устроена клетка и чем отличаются ДНК и РНК?",
    "Что такое фотосинтез и зачем он нужен?",
    "Объясни закон сохранения энергии на примерах.",
    "Что такое сила тока, напряжение и сопротивление?",
    "Как работает закон Ома?",
    "Чем атом отличается от молекулы?",
    "Что такое кислоты, основания и pH?",
    "Почему времена года меняются?",
    "Что такое инфляция и почему меняются цены?",
    "Как составить план сочинения ЕГЭ по русскому языку?",
    "Как находить главную мысль текста?",
    "Что такое метафора, эпитет и сравнение?",
    "Как работает SQL JOIN и чем отличаются виды JOIN?",
    "Как защитить веб-приложение от SQL-инъекций?",
    "Что такое HTTP API и чем GET отличается от POST?",
    "Как написать простого Telegram-бота на Python?",
    "Как работает Git: commit, branch и merge?",
    "Как эффективно учить большой объём материала?",
    "Что такое критическое мышление и как проверять источники?",
    "Объясни закон спроса и предложения.",
    "Как составить личный бюджет и рассчитать сложный процент?",
]


@dataclass(frozen=True)
class ClaimedTask:
    id: str
    query: str
    created_by_id: str | None


_STOP = asyncio.Event()
_SUPERVISOR: asyncio.Task | None = None
_WORKERS: dict[asyncio.Task, asyncio.Event] = {}
_SEED_LOCK = asyncio.Lock()


async def find_ready_answer_exact(query: str) -> ReadyAnswer | None:
    """Case-sensitive, whole-string match. Only surrounding whitespace is stripped."""
    title = (query or "").strip()
    if not title:
        return None
    try:
        async with SessionLocal() as db:
            result = await db.execute(
                select(ReadyAnswer)
                .join(ReadyAnswerTitle, ReadyAnswerTitle.answer_id == ReadyAnswer.id)
                .where(ReadyAnswerTitle.title == title)
                .order_by(ReadyAnswer.created_at.desc(), ReadyAnswer.id)
                .limit(1)
            )
            return result.scalars().first()
    except Exception:
        # A cache lookup must never prevent a normal AI response if the cache is unavailable.
        log.exception("Exact prepared-answer lookup failed")
        return None


async def _ensure_defaults_and_seeds() -> None:
    async with SessionLocal() as db:
        if await db.get(ReadyAnswerSettings, 1) is None:
            db.add(ReadyAnswerSettings(id=1, auto_enabled=False, parallelism=2, titles_per_answer=30))
        existing = int(await db.scalar(select(func.count()).select_from(ReadyAnswerSeed)) or 0)
        if existing == 0:
            db.add_all([
                ReadyAnswerSeed(question=question, position=index, consumed=False)
                for index, question in enumerate(SEED_QUESTIONS, start=1)
            ])
        # Recover jobs that were active when the previous process was killed/redeployed.
        stale_tasks = list((await db.execute(
            select(ReadyAnswerTask).where(ReadyAnswerTask.status == "generating")
        )).scalars().all())
        for task in stale_tasks:
            task.status = "queued"
            task.error = "Возвращено в очередь после перезапуска приложения."
            task.updated_at = utcnow()
        await db.commit()


async def _settings_snapshot() -> dict[str, Any]:
    async with SessionLocal() as db:
        row = await db.get(ReadyAnswerSettings, 1)
        if row is None:
            row = ReadyAnswerSettings(id=1, auto_enabled=False, parallelism=2, titles_per_answer=30)
            db.add(row)
            await db.commit()
            await db.refresh(row)
        return {
            "auto_enabled": bool(row.auto_enabled),
            "parallelism": max(1, min(20, int(row.parallelism or 2))),
            "titles_per_answer": max(10, min(100, int(row.titles_per_answer or 30))),
        }


async def _enqueue_next_seed() -> bool:
    async with _SEED_LOCK:
        async with SessionLocal() as db:
            settings_row = await db.get(ReadyAnswerSettings, 1)
            if settings_row is None or not settings_row.auto_enabled:
                return False
            seed = (
                await db.execute(
                    select(ReadyAnswerSeed)
                    .where(ReadyAnswerSeed.consumed.is_(False))
                    .order_by(ReadyAnswerSeed.position, ReadyAnswerSeed.id)
                    .limit(1)
                )
            ).scalars().first()
            if seed is None:
                return False
            seed.consumed = True
            seed.updated_at = utcnow()
            db.add(ReadyAnswerTask(
                query=seed.question, status="queued", priority=0, position=seed.position, source="prepared",
            ))
            await db.commit()
            return True


async def _claim_task() -> ClaimedTask | None:
    async with SessionLocal() as db:
        row = (
            await db.execute(
                select(ReadyAnswerTask.id, ReadyAnswerTask.query, ReadyAnswerTask.created_by_id)
                .where(ReadyAnswerTask.status == "queued")
                .order_by(ReadyAnswerTask.priority.desc(), ReadyAnswerTask.created_at, ReadyAnswerTask.position, ReadyAnswerTask.id)
                .limit(1)
            )
        ).first()
        if row is None:
            return None
        claimed = await db.execute(
            update(ReadyAnswerTask)
            .where(ReadyAnswerTask.id == row.id, ReadyAnswerTask.status == "queued")
            .values(status="generating", updated_at=utcnow(), error=None)
        )
        await db.commit()
        if claimed.rowcount != 1:
            return None
        return ClaimedTask(id=row.id, query=row.query, created_by_id=row.created_by_id)


async def _get_generation_model() -> dict[str, Any]:
    async with SessionLocal() as db:
        row = (
            await db.execute(
                select(ModelSetEntry, ModelSet)
                .join(ModelSet, ModelSet.id == ModelSetEntry.model_set_id)
                .where(
                    ModelSet.route_type == RouteType.MAIN,
                    ModelSet.is_active.is_(True),
                    ModelSet.is_router.is_(False),
                    ModelSetEntry.is_active.is_(True),
                )
                .order_by(ModelSet.is_default.desc(), ModelSet.name, ModelSetEntry.position)
                .limit(1)
            )
        ).first()
        if row is None:
            raise RuntimeError("Нет активной основной модели. Настройте Model Sets в админке.")
        entry, model_set = row
        if not (entry.base_url or "").strip() or not (entry.model or "").strip():
            raise RuntimeError("У выбранной модели не заполнены Base URL или ID модели.")
        return {
            "entry_id": entry.id, "model_set_id": model_set.id,
            "base_url": entry.base_url, "api_key": entry.api_key, "model": entry.model,
            "temperature": float(entry.temperature or 0.2),
            "max_tokens": max(3000, min(16000, int(entry.max_tokens or 12000))),
            "timeout": max(30, min(300, int(entry.timeout or 300))),
            "price_in": max(0.0, float(entry.price_in or 0)),
            "price_out": max(0.0, float(entry.price_out or 0)),
        }


def _parse_generation(raw: str, query: str, target: int) -> tuple[str, list[str]]:
    text = (raw or "").strip()
    fence = chr(96) * 3
    text = re.sub(r"^\s*" + re.escape(fence) + r"(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*" + re.escape(fence) + r"\s*$", "", text)
    first, last = text.find("{"), text.rfind("}")
    if first < 0 or last <= first:
        raise ValueError("Модель вернула не JSON. Задачу можно повторить из админки.")
    try:
        payload = json.loads(text[first:last + 1])
    except json.JSONDecodeError as exc:
        raise ValueError("Модель вернула некорректный JSON. Задачу можно повторить из админки.") from exc
    if not isinstance(payload, dict):
        raise ValueError("В ответе модели нет JSON-объекта.")
    answer = str(payload.get("answer") or "").strip()
    raw_titles = payload.get("titles")
    if not answer:
        raise ValueError("Модель вернула пустой готовый ответ.")
    if not isinstance(raw_titles, list):
        raise ValueError("Модель не вернула список заголовков.")
    titles: list[str] = []
    seen: set[str] = set()
    for item in raw_titles:
        if not isinstance(item, str):
            continue
        title = item.strip()
        if not title or len(title) > 2000 or title in seen:
            continue
        seen.add(title)
        titles.append(title)
    # Always preserve the user's exact original query as the first title, even
    # when the model returned it late in a long generated list.
    titles = [query] + [title for title in titles if title != query]
    titles = titles[:target]
    if len(titles) < 10:
        raise ValueError(f"Модель вернула только {len(titles)} уникальных заголовков; требуется не менее 10.")
    return answer, titles


async def _generate(task: ClaimedTask) -> None:
    # If another task has already prepared this exact query, reuse that answer and avoid a duplicate paid call.
    existing = await find_ready_answer_exact(task.query)
    if existing is not None:
        async with SessionLocal() as db:
            current = await db.get(ReadyAnswerTask, task.id)
            if current is not None:
                current.status = "completed"
                current.ready_answer_id = existing.id
                current.error = None
                current.updated_at = utcnow()
                await db.commit()
        return

    config = await _get_generation_model()
    target = (await _settings_snapshot())["titles_per_answer"]
    generation_rules = (
        "\n\n[СПЕЦИАЛЬНЫЙ РЕЖИМ: СОЗДАНИЕ ГОТОВОГО ОТВЕТА ДЛЯ БАЗЫ AI CH]\n"
        "Ответь на пользовательский вопрос так же качественно, полно и по правилам выше, как в обычном чате. "
        "Дополнительно подготовь заголовки-синонимы/варианты формулировки того же самого вопроса, чтобы система "
        "могла найти этот ответ по точному совпадению всей строки. Заголовки не должны менять смысл вопроса и "
        "не должны быть ответами или общими словами. Первым заголовком включи исходный запрос дословно. "
        f"Сгенерируй {target} уникальных заголовков, но никогда не больше 100. "
        "Не создавай заголовки для других вопросов и не выдумывай дополнительные факты.\n"
        "Верни только один корректный JSON-объект без Markdown-ограждений и текста вокруг, строго такой формы: "
        '{"answer":"полный ответ в Markdown","titles":["исходный запрос","вариант 2","..."]}. '
        "В answer должен быть только ответ пользователю, без упоминания базы, очереди, заголовков или этого режима. "
        "Не включай в JSON поля, кроме answer и titles."
    )
    raw, usage = await complete_chat_with_usage(
        messages=[
            {"role": "system", "content": prompts.MAIN_SYSTEM + generation_rules},
            {"role": "user", "content": task.query},
        ],
        base_url=config["base_url"],
        api_key=config["api_key"],
        model=config["model"],
        temperature=0.25,
        max_tokens=config["max_tokens"],
        timeout=config["timeout"],
        disable_thinking=settings.ai_disable_thinking,
        effort="recommended",
        allow_reasoning_fallback=True,
        error_env_prefix="READY_ANSWER",
    )
    answer, titles = _parse_generation(raw, task.query, target)

    async with SessionLocal() as db:
        current = await db.get(ReadyAnswerTask, task.id)
        if current is None:
            return
        # If another parallel worker finished this exact request while this model
        # call was running, reuse its answer instead of racing to insert a duplicate.
        already_saved = (
            await db.execute(
                select(ReadyAnswer)
                .join(ReadyAnswerTitle, ReadyAnswerTitle.answer_id == ReadyAnswer.id)
                .where(ReadyAnswerTitle.title == task.query)
                .limit(1)
            )
        ).scalars().first()
        if already_saved is not None:
            current.ready_answer_id = already_saved.id
            current.status = "completed"
            current.error = None
            current.updated_at = utcnow()
            await db.commit()
            return
        existing_titles = set((await db.execute(
            select(ReadyAnswerTitle.title).where(ReadyAnswerTitle.title.in_(titles))
        )).scalars().all())
        new_titles = [title for title in titles if title not in existing_titles]
        if len(new_titles) < 10:
            raise ValueError(
                "Менее 10 свободных заголовков: сгенерированные формулировки уже заняты другой записью. "
                "Нажмите «Повторить», чтобы сгенерировать новые варианты."
            )
        ready = ReadyAnswer(source_query=task.query, answer=answer)
        db.add(ready)
        await db.flush()
        for title in new_titles:
            db.add(ReadyAnswerTitle(answer_id=ready.id, title=title))
        current.ready_answer_id = ready.id
        current.status = "completed"
        current.error = None
        current.updated_at = utcnow()
        tin = int((usage or {}).get("prompt_tokens") or 0)
        tout = int((usage or {}).get("completion_tokens") or 0)
        if tin + tout:
            cost = (tin * config["price_in"] + tout * config["price_out"]) / 1_000_000
            db.add(UsageEvent(
                user_id=None, chat_id=None, message_id=None,
                model_set_id=config["model_set_id"], entry_id=config["entry_id"],
                model=config["model"], action="ready_answer_generation",
                tokens_in=tin, tokens_out=tout, tokens_cached=0, cost_usd=cost,
            ))
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            async with SessionLocal() as retry_db:
                retry_task = await retry_db.get(ReadyAnswerTask, task.id)
                if retry_task is not None:
                    retry_task.status = "failed"
                    retry_task.error = "Конфликт одинаковых заголовков при параллельной записи. Нажмите «Повторить»."
                    retry_task.updated_at = utcnow()
                    await retry_db.commit()
            raise


async def _mark_task_failed(task_id: str, error: str) -> None:
    async with SessionLocal() as db:
        task = await db.get(ReadyAnswerTask, task_id)
        if task is not None:
            task.status = "failed"
            task.error = (error or "Не удалось создать ответ")[:1500]
            task.updated_at = utcnow()
            await db.commit()


async def _worker_loop(retire: asyncio.Event) -> None:
    while not _STOP.is_set() and not retire.is_set():
        task = await _claim_task()
        if task is None:
            # Manual tasks always run. The toggle controls only automatic filling from
            # the prepared 30-question pool, avoiding surprise paid calls by default.
            if await _enqueue_next_seed():
                continue
            try:
                await asyncio.wait_for(_STOP.wait(), timeout=0.8)
            except asyncio.TimeoutError:
                pass
            continue
        try:
            await _generate(task)
        except asyncio.CancelledError:
            await _mark_task_failed(task.id, "Генерация прервана при остановке приложения. Нажмите «Повторить».")
            raise
        except Exception as exc:
            log.exception("Ready-answer generation failed for task %s", task.id)
            await _mark_task_failed(task.id, str(exc))


async def _supervise_workers() -> None:
    while not _STOP.is_set():
        try:
            desired = (await _settings_snapshot())["parallelism"]
            live = [task for task in _WORKERS if not task.done()]
            for task in list(_WORKERS):
                if task.done():
                    _WORKERS.pop(task, None)
            if len(live) < desired:
                for _ in range(desired - len(live)):
                    retire = asyncio.Event()
                    task = asyncio.create_task(_worker_loop(retire), name="ready-answer-worker")
                    _WORKERS[task] = retire
            elif len(live) > desired:
                for task in live[desired:]:
                    event = _WORKERS.get(task)
                    if event is not None:
                        event.set()
            try:
                await asyncio.wait_for(_STOP.wait(), timeout=1.0)
            except asyncio.TimeoutError:
                pass
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Ready-answer worker supervisor failed")
            await asyncio.sleep(2)


async def start_ready_answer_workers() -> None:
    global _SUPERVISOR, _STOP
    if _SUPERVISOR is not None and not _SUPERVISOR.done():
        return
    _STOP = asyncio.Event()
    await _ensure_defaults_and_seeds()
    _SUPERVISOR = asyncio.create_task(_supervise_workers(), name="ready-answer-supervisor")


async def stop_ready_answer_workers() -> None:
    global _SUPERVISOR
    _STOP.set()
    for retire in list(_WORKERS.values()):
        retire.set()
    if _SUPERVISOR is not None:
        _SUPERVISOR.cancel()
        try:
            await _SUPERVISOR
        except BaseException:
            pass
        _SUPERVISOR = None
    workers = list(_WORKERS)
    for task in workers:
        task.cancel()
    if workers:
        await asyncio.gather(*workers, return_exceptions=True)
    _WORKERS.clear()

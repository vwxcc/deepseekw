"""Admin API for the ready-answer database, generation queue, and auto-generation settings."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_admin, get_db, require_csrf
from ..models import (
    ReadyAnswer, ReadyAnswerSeed, ReadyAnswerSettings, ReadyAnswerTask,
    ReadyAnswerTitle, User, utcnow,
)

router = APIRouter(
    prefix="/api/admin/ready-answers",
    tags=["admin-ready-answers"],
    dependencies=[Depends(get_current_admin)],
)


class QueueRequests(BaseModel):
    queries: list[str] = Field(min_length=1, max_length=500)
    priority_first: bool = False


class SettingsPatch(BaseModel):
    auto_enabled: bool | None = None
    lookup_enabled: bool | None = None
    parallelism: int | None = Field(default=None, ge=1, le=20)
    titles_per_answer: int | None = Field(default=None, ge=10, le=500)


class PreparedQuestions(BaseModel):
    """Questions to store in the prepared pool, not immediately enqueue."""
    queries: list[str] = Field(min_length=1, max_length=500)


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


async def _settings(db: AsyncSession) -> ReadyAnswerSettings:
    row = await db.get(ReadyAnswerSettings, 1)
    if row is None:
        row = ReadyAnswerSettings(id=1, auto_enabled=False, lookup_enabled=True, parallelism=2, titles_per_answer=30)
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


async def _result_rows(db: AsyncSession, q: str, limit: int) -> list[dict[str, Any]]:
    q = (q or "").strip().casefold()
    # An empty search shows only the newest saved answer; a real search stays bounded.
    limit = min(limit, 10) if q else 1
    if q:
        statement = (
            select(ReadyAnswerTitle.answer_id, ReadyAnswerTitle.title, ReadyAnswer, ReadyAnswer.created_at)
            .join(ReadyAnswer, ReadyAnswer.id == ReadyAnswerTitle.answer_id)
            .where(ReadyAnswerTitle.title.ilike(f"%{q}%"))
            .order_by(ReadyAnswer.created_at.desc(), ReadyAnswerTitle.title)
            .limit(limit)
        )
        rows = (await db.execute(statement)).all()
        grouped: dict[str, dict[str, Any]] = {}
        for answer_id, title, answer, created_at in rows:
            entry = grouped.setdefault(answer_id, {
                "id": answer_id, "source_query": answer.source_query, "answer": answer.answer,
                "created_at": _dt(created_at), "match_titles": [], "titles": [],
            })
            entry["match_titles"].append(title)
        ids = list(grouped)
    else:
        answers = list((await db.execute(
            select(ReadyAnswer).order_by(ReadyAnswer.created_at.desc()).limit(limit)
        )).scalars().all())
        grouped = {
            answer.id: {
                "id": answer.id, "source_query": answer.source_query, "answer": answer.answer,
                "created_at": _dt(answer.created_at), "match_titles": [], "titles": [],
            }
            for answer in answers
        }
        ids = [answer.id for answer in answers]
    if not ids:
        return []
    title_rows = (await db.execute(
        select(ReadyAnswerTitle.answer_id, ReadyAnswerTitle.title)
        .where(ReadyAnswerTitle.answer_id.in_(ids))
        .order_by(ReadyAnswerTitle.answer_id, ReadyAnswerTitle.title)
    )).all()
    for answer_id, title in title_rows:
        if answer_id in grouped:
            grouped[answer_id]["titles"].append(title)
    return list(grouped.values())


@router.get("")
async def overview(
    q: str = Query(default="", max_length=500),
    limit: int = Query(default=30, ge=1, le=100),
    seed_limit: int = Query(default=100, ge=1, le=500),
    seed_offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """Show exact-match title database, queue, prepared questions, and current settings."""
    cfg = await _settings(db)
    # Keep the live queue visible but cap the completed/failed history at three rows.
    active_tasks = list((await db.execute(
        select(ReadyAnswerTask)
        .where(ReadyAnswerTask.status.in_(["queued", "generating"]))
        .order_by(ReadyAnswerTask.priority.desc(), ReadyAnswerTask.created_at.desc())
        .limit(50)
    )).scalars().all())
    history_tasks = list((await db.execute(
        select(ReadyAnswerTask)
        .where(ReadyAnswerTask.status.in_(["completed", "failed"]))
        .order_by(ReadyAnswerTask.updated_at.desc(), ReadyAnswerTask.created_at.desc())
        .limit(3)
    )).scalars().all())
    tasks = active_tasks + history_tasks
    tasks.sort(key=lambda task: task.updated_at or task.created_at, reverse=True)
    seed_rows = list((await db.execute(
        select(ReadyAnswerSeed)
        .order_by(ReadyAnswerSeed.position.asc(), ReadyAnswerSeed.created_at.asc())
        .offset(seed_offset)
        .limit(seed_limit)
    )).scalars().all())
    count = lambda model, *where: db.scalar(
        select(func.count()).select_from(model).where(*where)
    )
    answers_count = int(await count(ReadyAnswer) or 0)
    titles_count = int(await count(ReadyAnswerTitle) or 0)
    prepared_total = int(await count(ReadyAnswerSeed) or 0)
    prepared_remaining = int(await count(
        ReadyAnswerSeed, ReadyAnswerSeed.consumed.is_(False)
    ) or 0)
    queue_stats = {}
    for state in ("queued", "generating", "completed", "failed"):
        queue_stats[state] = int(await count(ReadyAnswerTask, ReadyAnswerTask.status == state) or 0)
    return {
        "settings": {
            "auto_enabled": bool(cfg.auto_enabled),
            "lookup_enabled": bool(cfg.lookup_enabled),
            "parallelism": max(1, min(20, int(cfg.parallelism or 2))),
            "titles_per_answer": max(10, min(500, int(cfg.titles_per_answer or 30))),
        },
        "stats": {
            "answers": answers_count, "titles": titles_count,
            **queue_stats,
            "prepared_questions": prepared_total,
            "prepared_remaining": prepared_remaining,
        },
        "results": await _result_rows(db, q, limit),
        "tasks": [{
            "id": task.id, "query": task.query, "status": task.status,
            "source": task.source, "priority": task.priority, "error": task.error,
            "answer_id": task.ready_answer_id,
            "created_at": _dt(task.created_at), "updated_at": _dt(task.updated_at),
        } for task in tasks],
        "seed_questions": [{
            "question": seed.question, "position": seed.position, "consumed": bool(seed.consumed),
        } for seed in seed_rows],
        "seed_total": prepared_total,
        "seed_limit": seed_limit,
        "seed_offset": seed_offset,
    }


@router.patch("/settings")
async def patch_settings(
    data: SettingsPatch,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    cfg = await _settings(db)
    if data.auto_enabled is not None:
        cfg.auto_enabled = data.auto_enabled
    if data.lookup_enabled is not None:
        cfg.lookup_enabled = data.lookup_enabled
    if data.parallelism is not None:
        cfg.parallelism = max(1, min(20, data.parallelism))
    if data.titles_per_answer is not None:
        cfg.titles_per_answer = max(10, min(500, data.titles_per_answer))
    cfg.updated_at = utcnow()
    await db.commit()
    await db.refresh(cfg)
    return {
        "auto_enabled": bool(cfg.auto_enabled),
        "lookup_enabled": bool(cfg.lookup_enabled),
        "parallelism": int(cfg.parallelism),
        "titles_per_answer": int(cfg.titles_per_answer),
    }


@router.post("/prepared-questions", status_code=status.HTTP_201_CREATED)
async def add_prepared_questions(
    data: PreparedQuestions,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    """Append questions to the prepared pool; do not run them through the live queue."""
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in data.queries:
        if not isinstance(value, str):
            continue
        query = value.strip()
        if not query or len(query) > 2000 or query in seen:
            continue
        seen.add(query)
        cleaned.append(query)
    if not cleaned:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Добавьте хотя бы один непустой запрос длиной до 2000 символов.",
        )

    existing_prepared = {
        question.casefold() for question in (await db.execute(
            select(ReadyAnswerSeed.question).where(ReadyAnswerSeed.consumed.is_(False))
        )).scalars().all()
    }
    existing_queued = {
        query.casefold() for query in (await db.execute(
            select(ReadyAnswerTask.query).where(
                ReadyAnswerTask.status.in_(("queued", "generating")),
            )
        )).scalars().all()
    }
    normalized_queries = {query.casefold() for query in cleaned}
    existing_titles = set((await db.execute(
        select(ReadyAnswerTitle.normalized_title).where(
            ReadyAnswerTitle.normalized_title.in_(normalized_queries)
        )
    )).scalars().all())
    cleaned = [
        query for query in cleaned
        if query.casefold() not in existing_prepared
        and query.casefold() not in existing_queued
        and query.casefold() not in existing_titles
    ]
    skipped = len(seen) - len(cleaned)
    if not cleaned:
        return {
            "added": 0,
            "skipped": skipped,
            "message": "Все запросы уже подготовлены, находятся в очереди или имеют готовый ответ.",
        }

    last_position = int(await db.scalar(select(func.max(ReadyAnswerSeed.position)) ) or 0)
    now = utcnow()
    db.add_all([
        ReadyAnswerSeed(
            question=query,
            position=last_position + index,
            consumed=False,
            created_at=now,
            updated_at=now,
        )
        for index, query in enumerate(cleaned, start=1)
    ])
    await db.commit()
    return {
        "added": len(cleaned),
        "skipped": skipped,
        "message": "Запросы добавлены в подготовленный список; генерация не запускалась.",
    }


@router.post("/queue", status_code=status.HTTP_201_CREATED)
async def queue_requests(
    data: QueueRequests,
    admin: User = Depends(get_current_admin),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    cleaned: list[str] = []
    seen: set[str] = set()
    for value in data.queries:
        if not isinstance(value, str):
            continue
        query = value.strip()
        if not query or len(query) > 2000 or query in seen:
            continue
        seen.add(query)
        cleaned.append(query)
    if not cleaned:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Добавьте хотя бы один непустой запрос длиной до 2000 символов.")
    if len(cleaned) > 500:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "За один раз можно добавить не более 500 запросов.")
    existing_queries = {
        query.casefold() for query in (await db.execute(
            select(ReadyAnswerTask.query).where(
                ReadyAnswerTask.status.in_(("queued", "generating")),
            )
        )).scalars().all()
    }
    normalized_queries = {query.casefold() for query in cleaned}
    existing_titles = set((await db.execute(
        select(ReadyAnswerTitle.normalized_title).where(
            ReadyAnswerTitle.normalized_title.in_(normalized_queries)
        )
    )).scalars().all())
    cleaned = [
        query for query in cleaned
        if query.casefold() not in existing_queries and query.casefold() not in existing_titles
    ]
    if not cleaned:
        return {
            "added": 0, "skipped": len(seen),
            "message": "Все запросы уже подготовлены или находятся в очереди.",
        }
    if data.priority_first:
        max_priority = int(await db.scalar(
            select(func.max(ReadyAnswerTask.priority)).where(ReadyAnswerTask.status == "queued")
        ) or 0)
        priority = max_priority + 1
    else:
        priority = 0
    db.add_all([
        ReadyAnswerTask(
            query=query, status="queued", priority=priority, position=index,
            source="manual", created_by_id=admin.id,
            created_at=utcnow(), updated_at=utcnow(),
        )
        for index, query in enumerate(cleaned)
    ])
    await db.commit()
    return {"added": len(cleaned), "skipped": len(seen) - len(cleaned)}


@router.post("/tasks/{task_id}/retry")
async def retry_task(
    task_id: str,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(ReadyAnswerTask, task_id)
    if task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Задача не найдена.")
    if task.status != "failed":
        raise HTTPException(status.HTTP_409_CONFLICT, "Повторить можно только завершившуюся ошибкой задачу.")
    task.status = "queued"
    task.error = None
    task.priority = max(task.priority or 0, 100)
    task.updated_at = utcnow()
    await db.commit()
    return {"ok": True, "id": task.id, "status": task.status}


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: str,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    task = await db.get(ReadyAnswerTask, task_id)
    if task is None:
        return None
    if task.status == "generating":
        raise HTTPException(status.HTTP_409_CONFLICT, "Нельзя удалить выполняющуюся задачу.")
    await db.delete(task)
    await db.commit()
    return None


@router.delete("/answers/{answer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_answer(
    answer_id: str,
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    answer = await db.get(ReadyAnswer, answer_id)
    if answer is None:
        return None
    # Explicitly clear referencing task IDs and delete titles first. This also
    # handles older SQLite databases whose foreign-key actions predate the current schema.
    await db.execute(
        update(ReadyAnswerTask)
        .where(ReadyAnswerTask.ready_answer_id == answer_id)
        .values(ready_answer_id=None)
    )
    await db.execute(
        delete(ReadyAnswerTitle).where(ReadyAnswerTitle.answer_id == answer_id)
    )
    await db.execute(delete(ReadyAnswer).where(ReadyAnswer.id == answer_id))
    await db.commit()
    return None

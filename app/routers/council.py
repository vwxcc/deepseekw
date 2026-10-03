"""Council of models (beta).

The question is sent to several model sets in parallel. Each answer is stored in
its own chat; all of them share a ``bundle_id`` and are linked to one extra
"merge" chat whose answer synthesises the variants.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import prompts
from ..ai.router import Job, router as ai_router
from ..deps import get_current_user, get_db, require_csrf
from ..models import (
    Chat,
    Message,
    MessageStatus,
    ModelSet,
    Role,
    RouteType,
    User,
)
from ..schemas import CouncilIn, CouncilModelOut, CouncilOut

router = APIRouter(prefix="/api/council", tags=["council"])

MAX_MODELS = 4


@router.get("/models", response_model=list[CouncilModelOut])
async def council_models(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Council members: distinct roles (works even with a single provider model)."""
    return [
        CouncilModelOut(id=key, name=name, hint=hint)
        for key, (name, hint) in prompts.COUNCIL_PERSONAS.items()
    ]


@router.get("/sets", response_model=list[CouncilModelOut])
async def council_sets(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(ModelSet)
        .where(ModelSet.route_type == RouteType.MAIN)
        .order_by(ModelSet.name)
    )
    return [CouncilModelOut(id=s.id, name=s.name) for s in result.scalars().all()]


@router.post("", response_model=CouncilOut, status_code=status.HTTP_201_CREATED)
async def create_council(
    data: CouncilIn,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    question = (data.question or "").strip()
    if not question:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Пустой вопрос")

    keys: list[str] = []
    for raw in data.personas or []:
        if raw in prompts.COUNCIL_PERSONAS and raw not in keys:
            keys.append(raw)
    keys = keys[:MAX_MODELS]
    if len(keys) < 1:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Выберите хотя бы одного участника совета"
        )

    bundle = uuid.uuid4().hex
    short = question.replace("\n", " ")[:38]

    chat_ids: list[str] = []
    variants: list[str] = []
    jobs: list[Job] = []

    for key in keys:
        name, hint = prompts.COUNCIL_PERSONAS[key]
        chat = Chat(
            user_id=user.id, title=f"{name}: {short}", mode="chat", bundle_id=bundle
        )
        db.add(chat)
        await db.flush()
        um = Message(
            chat_id=chat.id, user_id=user.id, role=Role.user, content=question,
            parent_message_id=None, status=MessageStatus.completed,
        )
        db.add(um)
        am = Message(
            chat_id=chat.id, user_id=None, role=Role.assistant, content="",
            parent_message_id=um.id, status=MessageStatus.queued,
        )
        db.add(am)
        await db.flush()
        chat_ids.append(chat.id)
        variants.append(am.id)
        jobs.append(
            Job(
                kind="message",
                route_type=RouteType.MAIN,
                chat_id=chat.id,
                history=prompts.with_system(
                    [{"role": "user", "content": question}],
                    prompts.MAIN_SYSTEM + f"\n\nТвоя роль в совете — {name}. {hint}",
                ),
                message_id=am.id,
                user_id=user.id,
            )
        )

    merge = Chat(
        user_id=user.id, title=f"Совет: {short}", mode="council", bundle_id=bundle
    )
    db.add(merge)
    await db.flush()
    mum = Message(
        chat_id=merge.id, user_id=user.id, role=Role.user, content=question,
        parent_message_id=None, status=MessageStatus.completed,
    )
    db.add(mum)
    mam = Message(
        chat_id=merge.id, user_id=None, role=Role.assistant, content="",
        parent_message_id=mum.id, status=MessageStatus.queued,
    )
    db.add(mam)
    await db.commit()
    await db.refresh(merge)
    await db.refresh(mam)

    for job in jobs:
        await ai_router.enqueue(job)
    await ai_router.enqueue(
        Job(
            kind="merge",
            route_type=RouteType.MAIN,
            chat_id=merge.id,
            history=prompts.with_system(
                [{"role": "user", "content": question}], prompts.MAIN_SYSTEM
            ),
            message_id=mam.id,
            user_id=user.id,
            user_text=question,
            depends_on=variants,
        )
    )

    return CouncilOut(bundle_id=bundle, merge_chat_id=merge.id, chat_ids=chat_ids)

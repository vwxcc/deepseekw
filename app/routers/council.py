"""Council of models (beta).

One chat, several members: each persona answers in parallel as a *sibling*
message, so the branch navigator (‹ 3/4 ›) lets you flip between the models and
the final merged answer. Everything lives in a single chat.
"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..ai import prompts
from ..ai.router import Job, router as ai_router
from ..deps import get_current_user, get_db, require_csrf
from ..models import Chat, Message, MessageStatus, ModelSet, Role, RouteType, User
from ..schemas import CouncilIn, CouncilModelOut, CouncilOut

router = APIRouter(prefix="/api/council", tags=["council"])

MAX_MEMBERS = 4


@router.get("/models", response_model=list[CouncilModelOut])
async def council_models(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    """Council members: distinct roles, so it works even with one provider model."""
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
    if not keys:
        keys = ["pragmatic", "analyst", "critic"]
    keys = keys[:MAX_MEMBERS]

    short = question.replace("\n", " ")[:44]
    bundle = uuid.uuid4().hex

    chat = Chat(
        user_id=user.id, title=f"Совет: {short}", mode="council", bundle_id=bundle
    )
    db.add(chat)
    await db.flush()

    user_msg = Message(
        chat_id=chat.id,
        user_id=user.id,
        role=Role.user,
        content=question,
        parent_message_id=None,
        status=MessageStatus.completed,
    )
    db.add(user_msg)
    await db.flush()

    variants: list[str] = []
    jobs: list[Job] = []
    for key in keys:
        name, hint = prompts.COUNCIL_PERSONAS[key]
        member = Message(
            chat_id=chat.id,
            user_id=None,
            role=Role.assistant,
            content="",
            parent_message_id=user_msg.id,
            status=MessageStatus.queued,
        )
        db.add(member)
        await db.flush()
        variants.append(member.id)
        jobs.append(
            Job(
                kind="message",
                route_type=RouteType.MAIN,
                chat_id=chat.id,
                history=prompts.with_system(
                    [{"role": "user", "content": question}],
                    prompts.MAIN_SYSTEM + f"\n\nТвоя роль в совете — {name}. {hint}",
                ),
                message_id=member.id,
                user_id=user.id,
                user_text=question,
            )
        )

    merged = Message(
        chat_id=chat.id,
        user_id=None,
        role=Role.assistant,
        content="",
        parent_message_id=user_msg.id,
        status=MessageStatus.queued,
    )
    db.add(merged)
    await db.commit()
    await db.refresh(chat)
    await db.refresh(merged)

    for job in jobs:
        await ai_router.enqueue(job)
    await ai_router.enqueue(
        Job(
            kind="merge",
            route_type=RouteType.MAIN,
            chat_id=chat.id,
            history=prompts.with_system(
                [{"role": "user", "content": question}], prompts.MAIN_SYSTEM
            ),
            message_id=merged.id,
            user_id=user.id,
            user_text=question,
            depends_on=variants,
        )
    )

    return CouncilOut(bundle_id=bundle, merge_chat_id=chat.id, chat_ids=[chat.id])

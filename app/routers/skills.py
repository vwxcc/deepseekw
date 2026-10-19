"""Private skill library: system skill names and each user's own editable skills."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, require_csrf
from ..models import User, UserSkill
from ..schemas import UserSkillIn, UserSkillOut

router = APIRouter(prefix="/api/skills", tags=["skills"])

# System skill contents intentionally never leave the server. The client receives
# only stable identifiers and display names.
SYSTEM_SKILLS = [
    {"id": "drawing", "title": "Рисование и SVG"},
    {"id": "blueprints", "title": "Чертежи и технические схемы"},
    {"id": "essays", "title": "Сочинения и эссе"},
    {"id": "humanize-text", "title": "Естественный стиль текста"},
    {"id": "file-generation", "title": "Создание файлов"},
    {"id": "code-execution", "title": "Код и вычисления"},
    {"id": "document-design", "title": "Оформление документов"},
    {"id": "web-development", "title": "HTML и веб-разработка"},
]


@router.get("")
async def list_skills(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    result = await db.execute(
        select(UserSkill)
        .where(UserSkill.user_id == user.id)
        .order_by(UserSkill.updated_at.desc(), UserSkill.created_at.desc())
    )
    return {
        "system": [{"id": item["id"], "title": item["title"]} for item in SYSTEM_SKILLS],
        "custom": [
            UserSkillOut.model_validate(item).model_dump(mode="json")
            for item in result.scalars().all()
        ],
    }


@router.post("", response_model=UserSkillOut, status_code=status.HTTP_201_CREATED)
async def create_skill(
    data: UserSkillIn,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    title = (data.title or "").strip()
    content = (data.content or "").strip()
    if not title or not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите название и инструкции навыка")
    count_result = await db.execute(
        select(UserSkill.id).where(UserSkill.user_id == user.id)
    )
    if len(count_result.all()) >= 30:
        raise HTTPException(status.HTTP_409_CONFLICT, "Можно создать не более 30 пользовательских навыков")
    item = UserSkill(user_id=user.id, title=title, content=content)
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return UserSkillOut.model_validate(item)


@router.patch("/{skill_id}", response_model=UserSkillOut)
async def update_skill(
    skill_id: str,
    data: UserSkillIn,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(UserSkill, skill_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Навык не найден")
    title = (data.title or "").strip()
    content = (data.content or "").strip()
    if not title or not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите название и инструкции навыка")
    item.title = title
    item.content = content
    await db.commit()
    await db.refresh(item)
    return UserSkillOut.model_validate(item)


@router.delete("/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill(
    skill_id: str,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    item = await db.get(UserSkill, skill_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Навык не найден")
    await db.delete(item)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

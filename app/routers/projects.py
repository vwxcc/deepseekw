"""Per-user projects and chat assignment."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..deps import get_current_user, get_db, require_csrf
from ..models import Chat, Project, User
from ..schemas import ProjectIn, ProjectOut

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("")
async def list_projects(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[dict]:
    result = await db.execute(
        select(Project, func.count(Chat.id))
        .outerjoin(Chat, (Chat.project_id == Project.id) & (Chat.deleted_at.is_(None)))
        .where(Project.user_id == user.id)
        .group_by(Project.id)
        .order_by(Project.updated_at.desc(), Project.created_at.desc())
    )
    return [
        {
            **ProjectOut.model_validate(project).model_dump(mode="json"),
            "chat_count": int(count or 0),
        }
        for project, count in result.all()
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectIn,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите название проекта")
    result = await db.execute(select(Project.id).where(Project.user_id == user.id))
    if len(result.all()) >= 50:
        raise HTTPException(status.HTTP_409_CONFLICT, "Можно создать не более 50 проектов")
    project = Project(user_id=user.id, title=title, description=(data.description or "").strip())
    db.add(project)
    await db.commit()
    await db.refresh(project)
    return {**ProjectOut.model_validate(project).model_dump(mode="json"), "chat_count": 0}


@router.patch("/{project_id}")
async def update_project(
    project_id: str,
    data: ProjectIn,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    project = await db.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Проект не найден")
    title = (data.title or "").strip()
    if not title:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите название проекта")
    project.title = title
    project.description = (data.description or "").strip()
    await db.commit()
    await db.refresh(project)
    count = await db.scalar(
        select(func.count(Chat.id)).where(
            Chat.project_id == project.id, Chat.deleted_at.is_(None)
        )
    )
    return {**ProjectOut.model_validate(project).model_dump(mode="json"), "chat_count": int(count or 0)}


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    project = await db.get(Project, project_id)
    if project is None or project.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Проект не найден")
    await db.execute(update(Chat).where(Chat.project_id == project.id).values(project_id=None))
    await db.delete(project)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

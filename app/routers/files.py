"""File library endpoints: upload, list, download, delete."""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import (
    APIRouter,
    Depends,
    File as FileParam,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..deps import get_current_user, get_db, require_csrf
from ..models import File, User
from ..schemas import FileOut
from ..services.files import detect_kind, extract_text, sha256_bytes

router = APIRouter(prefix="/api/files", tags=["files"])

MAX_EXTRACTED = 500_000


def _user_dir(user_id: str) -> Path:
    d = settings.upload_path / user_id
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.get("", response_model=list[FileOut])
async def list_files(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(File).where(File.user_id == user.id).order_by(File.created_at.desc())
    )
    return [FileOut.model_validate(f) for f in result.scalars().all()]


@router.post("", response_model=list[FileOut], status_code=status.HTTP_201_CREATED)
async def upload_files(
    files: list[UploadFile] = FileParam(...),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Файлы не переданы")
    if len(files) > settings.max_files_per_request:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Слишком много файлов (максимум {settings.max_files_per_request})",
        )

    saved: list[File] = []
    total = 0
    for uf in files:
        data = await uf.read()
        if len(data) > settings.max_file_size:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"Файл «{uf.filename}» превышает лимит {settings.max_file_size} байт",
            )
        total += len(data)
        if total > settings.max_total_file_size:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                "Превышен общий лимит размера загрузки",
            )

        fid = str(uuid.uuid4())
        name = Path(uf.filename or "file").name
        ext = Path(name).suffix
        dest = _user_dir(user.id) / f"{fid}{ext}"
        dest.write_bytes(data)

        kind = detect_kind(name, uf.content_type or "")
        text = extract_text(kind, name, data)
        rec = File(
            id=fid,
            user_id=user.id,
            storage_path=str(dest),
            original_name=name,
            mime_type=uf.content_type or "",
            size=len(data),
            sha256=sha256_bytes(data),
            extracted_text=(text[:MAX_EXTRACTED] if text else None),
            kind=kind,
        )
        db.add(rec)
        saved.append(rec)

    await db.commit()
    for rec in saved:
        await db.refresh(rec)
    return [FileOut.model_validate(f) for f in saved]


@router.get("/{file_id}/download")
async def download_file(
    file_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(File, file_id)
    if rec is None or rec.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    p = Path(rec.storage_path)
    if not p.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл отсутствует на диске")
    return FileResponse(
        p, filename=rec.original_name, media_type=rec.mime_type or "application/octet-stream"
    )


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_file(
    file_id: str,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(File, file_id)
    if rec is None or rec.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    try:
        Path(rec.storage_path).unlink(missing_ok=True)
    except Exception:
        pass
    await db.delete(rec)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

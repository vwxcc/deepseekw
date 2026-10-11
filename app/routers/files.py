"""File library endpoints: upload, list, download, delete."""
from __future__ import annotations

import re
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
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..deps import get_current_user, get_db, require_csrf
from ..models import File, User
from ..schemas import FileOut
from ..security_middleware import (
    _ALLOWED_EXTENSIONS,
    _FORBIDDEN_MIME_TYPES,
    _MIME_TO_EXT,
)
from ..services.files import detect_kind, extract_text, sha256_bytes
from ..services.limits import allow, effective_plan, get_limits
from ..services.storage import user_usage

router = APIRouter(prefix="/api/files", tags=["files"])
MAX_EXTRACTED = 500_000

# Magic bytes для валидации MIME
_MAGIC_BYTES = {
    b"%PDF": "application/pdf",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
    b"PK\x03\x04": "application/zip",
    b"BM": "image/bmp",
    b"\x1f\x8b": "application/gzip",
}

# Regex для защиты от path traversal
_FILENAME_SAFE_REGEX = re.compile(r'^[a-zA-Z0-9_\-\.]+$')


# ============================================================
# File validation helpers
# ============================================================

def _detect_mime_from_magic(data: bytes) -> str:
    """Определяет MIME-тип из magic bytes."""
    for magic, mime in _MAGIC_BYTES.items():
        if data.startswith(magic):
            return mime
    return ""


def _validate_filename(filename: str) -> tuple[str, str]:
    """Валидирует имя файла. Возвращает (safe_name, extension)."""
    # Убираем path traversal
    safe_name = Path(filename).name
    
    # Проверяем на безопасные символы
    if not _FILENAME_SAFE_REGEX.match(safe_name):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Недопустимые символы в имени файла: {safe_name}"
        )
    
    # Получаем расширение
    ext = Path(safe_name).suffix.lower()
    
    if not ext:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Файл должен иметь расширение"
        )
    
    if ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Расширение {ext} запрещено"
        )
    
    return safe_name, ext


def _validate_file_content(data: bytes, mime: str | None, ext: str) -> str:
    """Валидирует содержимое файла. Возвращает финальный MIME."""
    if not mime:
        # Определяем из magic bytes
        magic_mime = _detect_mime_from_magic(data[:_MAGIC_CHECK_SIZE])
        if magic_mime:
            mime = magic_mime
        else:
            # Не смогли определить — проверяем по расширению
            allowed_for_ext = _MIME_TO_EXT.get(ext, [])
            if not allowed_for_ext:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "Неизвестный тип файла"
                )
            mime = allowed_for_ext[0]
    else:
        # Проверяем, что MIME соответствует расширению
        allowed_for_ext = _MIME_TO_EXT.get(ext, [])
        if allowed_for_ext and mime not in allowed_for_ext:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"MIME-тип '{mime}' не соответствует расширению '{ext}'"
            )
    
    # Блокируем вредоносные MIME
    if mime in _FORBIDDEN_MIME_TYPES:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Файлы этого типа запрещены"
        )
    
    return mime


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

    # 1) read + validate everything BEFORE touching the disk
    payloads: list[tuple[str, str, str, bytes]] = []
    for uf in files:
        data = await uf.read()
        if len(data) > settings.max_file_size:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"Файл превышает лимит {settings.max_file_size} байт",
            )
        
        # Validate filename
        raw_name = uf.filename or "file"
        safe_name, ext = _validate_filename(raw_name)
        
        # Validate MIME type and content
        final_mime = _validate_file_content(data, uf.content_type, ext)
        
        total += len(data)
        if total > settings.max_total_file_size:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                "Превышен общий лимит размера загрузки",
            )
        payloads.append((safe_name, ext, final_mime, data))

    # per-plan storage quota
    limits = await get_limits(db, await effective_plan(db, user))
    used = await user_usage(db, user.id)
    count = (
        await db.scalar(
            select(func.count()).select_from(File).where(File.user_id == user.id)
        )
        or 0
    )
    allowed, message = allow(limits, "files_count", count, len(payloads))
    if not allowed:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, message)
    allowed, message = allow(limits, "user_storage", used, total)
    if not allowed:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"{message}. Занято {used / (1024 ** 3):.2f} ГБ.",
        )
    per_file = int(limits["file_size"]) if limits.get("file_size") is not None else settings.max_total_file_size
    for name, _ext, _mime, data in payloads:
        if len(data) > per_file:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"Файл больше лимита тарифа ({per_file // (1024 * 1024)} МБ)",
            )

    # 2) only now write to disk and persist
    for name, ext, mime, data in payloads:
        fid = str(uuid.uuid4())
        dest = _user_dir(user.id) / f"{fid}{ext}"
        dest.write_bytes(data)

        kind = detect_kind(name, mime)
        text = extract_text(kind, name, data)
        rec = File(
            id=fid,
            user_id=user.id,
            storage_path=str(dest),
            original_name=name,
            mime_type=mime,
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
    inline: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rec = await db.get(File, file_id)
    if rec is None or rec.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл не найден")
    p = Path(rec.storage_path)
    if not p.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Файл отсутствует на диске")
    media = rec.mime_type or "application/octet-stream"
    if inline:
        # no filename -> no Content-Disposition: attachment, so <img> renders it
        return FileResponse(p, media_type=media)
    return FileResponse(p, filename=rec.original_name, media_type=media)


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

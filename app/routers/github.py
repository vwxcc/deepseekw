"""GitHub credentials for the Code agent + git operations on a project folder."""
from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import settings
from ..deps import get_current_user, get_db, get_owned_chat, require_csrf
from ..models import Chat, User

log = logging.getLogger("chatstudio.github")

router = APIRouter(prefix="/api/github", tags=["github"])


def _project_dir(chat_id: str) -> Path:
    return settings.sandbox_path / "projects" / chat_id


async def _git(cwd: Path, *args: str, timeout: int = 90) -> dict:
    proc = await asyncio.create_subprocess_exec(
        "git",
        *args,
        cwd=str(cwd),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return {"ok": False, "out": "", "err": "Таймаут git"}
    return {
        "ok": proc.returncode == 0,
        "out": (out or b"").decode("utf-8", "replace")[:4000],
        "err": (err or b"").decode("utf-8", "replace")[:4000],
    }


@router.get("/me")
async def my_github(user: User = Depends(get_current_user)) -> dict:
    return {
        "login": user.github_user or "",
        "connected": bool(user.github_user and user.github_token),
    }


@router.post("/me")
async def save_github(
    data: dict,
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    login = str((data or {}).get("login") or "").strip()
    token = str((data or {}).get("token") or "").strip()
    if not login or not token:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нужны логин и токен")
    user.github_user = login[:120]
    user.github_token = token[:255]
    await db.commit()
    return {"ok": True, "login": user.github_user}


@router.delete("/me")
async def forget_github(
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    db: AsyncSession = Depends(get_db),
) -> dict:
    user.github_user = None
    user.github_token = None
    await db.commit()
    return {"ok": True}


@router.get("/chats/{chat_id}/status")
async def git_status(
    chat: Chat = Depends(get_owned_chat), user: User = Depends(get_current_user)
) -> dict:
    path = _project_dir(chat.id)
    if not (path / ".git").is_dir():
        return {"initialized": False, "branch": "", "changes": "", "remote": ""}
    branch = await _git(path, "rev-parse", "--abbrev-ref", "HEAD")
    changes = await _git(path, "status", "--porcelain")
    remote = await _git(path, "remote", "get-url", "origin")
    return {
        "initialized": True,
        "branch": branch["out"].strip(),
        "changes": changes["out"].strip()[:2000],
        "remote": remote["out"].strip(),
    }


@router.post("/chats/{chat_id}/git")
async def git_action(
    chat: Chat = Depends(get_owned_chat),
    user: User = Depends(get_current_user),
    _csrf=Depends(require_csrf),
    data: dict | None = None,
) -> dict:
    """Actions: init | commit | push | sync. Push uses the stored token."""
    body = data or {}
    action = str(body.get("action") or "status").lower()
    message = str(body.get("message") or "Update from ChatStudio").strip()[:200]
    repo = str(body.get("repo") or "").strip()

    path = _project_dir(chat.id)
    if not path.is_dir():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "У проекта ещё нет файлов")

    log.info("git %s in %s", action, path)

    if action == "init":
        await _git(path, "init")
        await _git(path, "checkout", "-B", "main")
        await _git(path, "config", "user.email", "agent@chatstudio.local")
        await _git(path, "config", "user.name", "ChatStudio Agent")
        if repo:
            await _git(path, "remote", "remove", "origin")
            await _git(path, "remote", "add", "origin", _remote_url(repo, user))
        return {"ok": True, "log": "Репозиторий инициализирован", "status": await git_status(chat, user)}

    if not (path / ".git").is_dir():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Сначала выполните init")

    if action == "commit":
        await _git(path, "add", "-A")
        res = await _git(path, "commit", "-m", message)
        return {"ok": res["ok"], "log": (res["out"] + res["err"])[:2000]}

    if action in ("push", "sync"):
        if repo:
            await _git(path, "remote", "remove", "origin")
            await _git(path, "remote", "add", "origin", _remote_url(repo, user))
        if action == "sync":
            await _git(path, "add", "-A")
            await _git(path, "commit", "-m", message)
        res = await _git(path, "push", "-u", "origin", "HEAD", timeout=180)
        return {
            "ok": res["ok"],
            "log": (res["out"] + res["err"])[:3000] or "Готово",
        }

    return {"ok": True, "status": await git_status(chat, user)}


def _remote_url(repo: str, user: User) -> str:
    """https://<login>:<token>@github.com/<owner>/<repo>.git"""
    repo = repo.strip()
    if repo.startswith("http"):
        base = repo
    else:
        base = f"https://github.com/{repo.strip('/')}"
        if not base.endswith(".git"):
            base += ".git"
    if user.github_token and user.github_user and base.startswith("https://github.com/"):
        rest = base[len("https://github.com/"):]
        return f"https://{user.github_user}:{user.github_token}@github.com/{rest}"
    return base

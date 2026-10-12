"""Sandbox client: bounded execution queue in front of the isolated runner.

Execution happens in a separate container (see ``sandbox/server.py``) that has
no internet access, a read-only root filesystem, a non-root user and hard
CPU/memory limits. This module only *schedules* work and *reads* the results
back through a directory that is mounted into both containers.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

import httpx

from ..config import settings

log = logging.getLogger("chatstudio.sandbox")

MAX_OUTPUT_CHARS = 12000
MAX_FILES = 12
MAX_FILE_BYTES = 30 * 1024 * 1024
SKIP_DIRS = {"__pycache__", ".cache", ".config", ".local", ".ipython", ".mpl"}


def _snip(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    half = limit // 2
    return text[:half] + "\n… (сокращено) …\n" + text[-half:]


class Sandbox:
    """Serialises access to the runner and keeps simple queue statistics."""

    def __init__(self) -> None:
        self._sem: asyncio.Semaphore | None = None
        self._lock = asyncio.Lock()
        self.waiting = 0
        self.running = 0
        self.finished = 0
        self.failed = 0

    async def _semaphore(self) -> asyncio.Semaphore:
        if self._sem is None:
            async with self._lock:
                if self._sem is None:
                    self._sem = asyncio.Semaphore(max(1, settings.sandbox_concurrency))
        return self._sem

    @property
    def stats(self) -> dict:
        return {
            "waiting": self.waiting,
            "running": self.running,
            "finished": self.finished,
            "failed": self.failed,
            "concurrency": settings.sandbox_concurrency,
            "queue_limit": settings.sandbox_queue_limit,
            "isolated": bool(settings.sandbox_url),
        }

    async def run(
        self, code: str, timeout: int | None = None, project: str | None = None
    ) -> dict:
        code = (code or "").strip()
        timeout = int(timeout or settings.agent_timeout)
        if not code:
            return self._fail("Пустой код")
        if not settings.sandbox_url:
            return await self._run_local(code, timeout)

        sem = await self._semaphore()
        if self.waiting >= settings.sandbox_queue_limit:
            self.failed += 1
            return self._fail(
                "Очередь выполнения переполнена — подождите немного и повторите."
            )

        self.waiting += 1
        try:
            async with sem:
                self.waiting -= 1
                self.running += 1
                try:
                    data = await self._call(code, timeout, project)
                finally:
                    self.running -= 1
        except Exception as e:  # pragma: no cover - defensive
            self.failed += 1
            return self._fail(f"Песочница недоступна: {e}")

        self.finished += 1
        return data

    async def _call(self, code: str, timeout: int, project: str | None) -> dict:
        url = settings.sandbox_url.rstrip("/") + "/run"
        payload: dict = {"code": code, "timeout": timeout}
        if project:
            payload["project"] = project
        try:
            async with httpx.AsyncClient(timeout=timeout + 25) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except Exception as e:
            self.failed += 1
            log.warning("Sandbox request failed: %s", e)
            return self._fail(f"Песочница недоступна: {e}")

        rel_dir = str(data.get("dir") or data.get("run_id") or "")
        base = (settings.sandbox_path / rel_dir) if rel_dir else None
        files: list[dict] = []
        if base is not None:
            for item in data.get("files") or []:
                abs_path = base / str(item.get("path") or item.get("name") or "")
                files.append({**item, "abs": str(abs_path)})
        data["files"] = files
        data["workdir"] = str(base) if base else None
        return data

    @staticmethod
    def _fail(message: str) -> dict:
        return {
            "ok": False,
            "stdout": "",
            "stderr": message,
            "files": [],
            "timed_out": False,
            "workdir": None,
        }

    # --- local fallback (only when SANDBOX_URL is empty) ---

    async def _run_local(self, code: str, timeout: int) -> dict:
        root = settings.sandbox_path / "local"
        root.mkdir(parents=True, exist_ok=True)
        workdir = root / uuid.uuid4().hex
        workdir.mkdir(parents=True, exist_ok=True)
        (workdir / "main.py").write_text(code, encoding="utf-8")
        env = {
            **os.environ,
            "PYTHONUNBUFFERED": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "MPLBACKEND": "Agg",
            "HOME": str(workdir),
        }

        def _limits() -> None:
            try:
                import resource

                resource.setrlimit(resource.RLIMIT_CPU, (max(1, timeout), max(1, timeout) + 5))
                resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE_BYTES, MAX_FILE_BYTES))
            except Exception:
                pass

        timed_out = False
        rc = 0
        out = err = ""
        try:
            proc = await asyncio.create_subprocess_exec(
                sys.executable, "-u", "main.py",
                cwd=str(workdir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
                preexec_fn=_limits,
            )
            try:
                out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            except asyncio.TimeoutError:
                timed_out = True
                proc.kill()
                out_b, err_b = await proc.communicate()
            rc = proc.returncode or 0
            out = (out_b or b"").decode("utf-8", "replace")
            err = (err_b or b"").decode("utf-8", "replace")
        except Exception as e:
            return self._fail(f"Не удалось запустить код: {e}")

        files: list[dict] = []
        for path in sorted(workdir.rglob("*")):
            if not path.is_file() or path.name == "main.py":
                continue
            rel = path.relative_to(workdir)
            if any(part in SKIP_DIRS for part in rel.parts[:-1]):
                continue
            size = path.stat().st_size
            if size == 0 or size > MAX_FILE_BYTES:
                continue
            files.append({"path": str(rel), "name": path.name, "size": size, "abs": str(path)})
            if len(files) >= MAX_FILES:
                break

        return {
            "ok": not timed_out and rc == 0,
            "stdout": _snip(out),
            "stderr": _snip(err + (f"\nПревышен лимит времени ({timeout} с)." if timed_out else "")),
            "files": files,
            "timed_out": timed_out,
            "workdir": str(workdir),
        }


sandbox = Sandbox()


async def run_python(code: str, timeout: int | None = None, project: str | None = None) -> dict:
    return await sandbox.run(code, timeout, project)


def cleanup(workdir: str | None) -> None:
    """Local fallback cleans up; the isolated runner prunes itself."""
    if not workdir or settings.sandbox_url:
        return
    try:
        shutil.rmtree(workdir, ignore_errors=True)
    except Exception:  # pragma: no cover
        pass

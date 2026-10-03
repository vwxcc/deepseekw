"""Sandboxed Python execution — the "run" agent skill.

Code runs in an isolated working directory with CPU/memory/file-size limits and
a hard timeout. Everything the script prints comes back to the model, and every
file it creates is handed back to the chat as an attachment.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import uuid
from pathlib import Path

log = logging.getLogger("chatstudio.sandbox")

RUN_ROOT = Path(os.environ.get("SANDBOX_DIR", "/tmp/chatstudio-runs"))
MAX_OUTPUT_CHARS = 12000
MAX_FILES = 12
MAX_FILE_BYTES = 30 * 1024 * 1024
DEFAULT_TIMEOUT = 40

SKIP_DIRS = {"__pycache__", ".cache", ".config", ".local", ".ipython", "node_modules"}

PRELUDE = (
    "import os, sys, json, math, random, datetime, csv, re, io\n"
    "import matplotlib\n"
    "matplotlib.use('Agg')\n"
)


def _limit_resources() -> None:  # runs in the forked child
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (30, 30))
        resource.setrlimit(resource.RLIMIT_AS, (3 * 1024**3, 3 * 1024**3))
        resource.setrlimit(resource.RLIMIT_FSIZE, (80 * 1024**2, 80 * 1024**2))
        resource.setrlimit(resource.RLIMIT_NPROC, (256, 256))
        resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))
    except Exception:  # pragma: no cover - platform dependent
        pass


def _snip(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    half = limit // 2
    return text[:half] + "\n… (сокращено) …\n" + text[-half:]


def _collect_files(workdir: Path) -> list[dict]:
    out: list[dict] = []
    for path in sorted(workdir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(workdir)
        if path.name in {"main.py"} or any(part in SKIP_DIRS for part in rel.parts[:-1]):
            continue
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size == 0 or size > MAX_FILE_BYTES:
            continue
        out.append({"path": str(rel), "name": path.name, "size": size, "abs": str(path)})
        if len(out) >= MAX_FILES:
            break
    return out


async def run_python(code: str, timeout: int = DEFAULT_TIMEOUT) -> dict:
    """Execute ``code`` and return {ok, stdout, stderr, files, timed_out}."""
    code = (code or "").strip()
    if not code:
        return {"ok": False, "stdout": "", "stderr": "Пустой код", "files": [], "timed_out": False}

    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    workdir = RUN_ROOT / uuid.uuid4().hex
    workdir.mkdir(parents=True, exist_ok=True)
    script = workdir / "main.py"
    script.write_text(code, encoding="utf-8")

    env = {
        **os.environ,
        "PYTHONUNBUFFERED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "MPLBACKEND": "Agg",
        "HOME": str(workdir),
        "TMPDIR": str(workdir),
    }
    timed_out = False
    stdout = stderr = ""
    try:
        proc = await asyncio.create_subprocess_exec(
            "python3",
            "-u",
            "main.py",
            cwd=str(workdir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
            preexec_fn=_limit_resources,
        )
        try:
            out_b, err_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            timed_out = True
            try:
                proc.kill()
            except ProcessLookupError:
                pass
            out_b, err_b = await proc.communicate()
        stdout = _snip((out_b or b"").decode("utf-8", "replace"))
        stderr = _snip((err_b or b"").decode("utf-8", "replace"))
    except Exception as e:  # pragma: no cover
        log.warning("Sandbox failed: %s", e)
        stderr = f"Не удалось запустить код: {e}"
        return {"ok": False, "stdout": "", "stderr": stderr, "files": [], "timed_out": False,
                "workdir": str(workdir)}

    files = _collect_files(workdir)
    if timed_out:
        stderr = (stderr + f"\nПревышен лимит времени ({timeout} с) — процесс остановлен.").strip()
    return {
        "ok": not timed_out and proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": stdout,
        "stderr": stderr,
        "files": files,
        "timed_out": timed_out,
        "workdir": str(workdir),
    }


def cleanup(workdir: str | None) -> None:
    if not workdir:
        return
    try:
        shutil.rmtree(workdir, ignore_errors=True)
    except Exception:  # pragma: no cover
        pass

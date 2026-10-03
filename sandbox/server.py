"""Isolated code execution service — runs inside its own locked-down container.

Container flags used by the deploy script:
    --network cs-sandbox   (internal network: containers only, no internet)
    --read-only            (immutable root filesystem)
    --tmpfs /tmp           (writable scratch)
    --user 65534:65534     (nobody)
    --memory 1g --cpus 1.5 --pids-limit 256
    -v <host>/data/sandbox:/work   (shared only with the app, for reading results)

API:
    GET  /health          -> {"ok": true, "runs": N}
    POST /run  {code, timeout} -> {ok, stdout, stderr, timed_out, returncode, files: [...]}
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WORK = os.environ.get("SANDBOX_WORK", "/work")
PROJECTS = os.path.join(WORK, "projects")
MAX_OUTPUT = int(os.environ.get("SANDBOX_MAX_OUTPUT", "12000"))
MAX_FILES = int(os.environ.get("SANDBOX_MAX_FILES", "24"))
MAX_FILE_BYTES = int(os.environ.get("SANDBOX_MAX_FILE_BYTES", str(30 * 1024 * 1024)))
KEEP_RUNS = int(os.environ.get("SANDBOX_KEEP_RUNS", "40"))
DEFAULT_TIMEOUT = 40
PROJECT_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
SKIP_DIRS = {"__pycache__", ".cache", ".config", ".local", ".ipython", ".mpl", ".fontconfig"}

PRELUDE = (
    "import os, sys, json, math, random, datetime, csv, re, io\n"
    "try:\n"
    "    import matplotlib\n"
    "    matplotlib.use('Agg')\n"
    "except Exception:\n"
    "    pass\n"
)


def _snip(text: str, limit: int = MAX_OUTPUT) -> str:
    text = text or ""
    if len(text) <= limit:
        return text
    half = limit // 2
    return text[:half] + "\n… (сокращено) …\n" + text[-half:]


def _collect(workdir: str, since: float | None = None) -> list[dict]:
    out: list[dict] = []
    for root, dirs, names in os.walk(workdir):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in sorted(names):
            if name == "main.py":
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, workdir)
            try:
                st = os.stat(path)
            except OSError:
                continue
            if st.st_size == 0 or st.st_size > MAX_FILE_BYTES:
                continue
            if since is not None and st.st_mtime + 0.5 < since:
                continue
            out.append({"path": rel, "name": name, "size": st.st_size})
            if len(out) >= MAX_FILES:
                return out
    return out


def _prune() -> None:
    try:
        entries = []
        for d in os.listdir(WORK):
            if d == "projects":
                continue
            full = os.path.join(WORK, d)
            if os.path.isdir(full):
                entries.append(full)
    except OSError:
        return
    entries.sort(key=lambda p: os.path.getmtime(p) if os.path.exists(p) else 0)
    for path in entries[:-KEEP_RUNS]:
        shutil.rmtree(path, ignore_errors=True)


def _limits(timeout: int):
    def _apply() -> None:
        try:
            import resource

            cpu = max(1, timeout)
            resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu + 5))
            resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_FILE_BYTES, MAX_FILE_BYTES))
            resource.setrlimit(resource.RLIMIT_NOFILE, (512, 512))
            resource.setrlimit(resource.RLIMIT_NPROC, (256, 256))
        except Exception:
            pass

    return _apply


def execute(code: str, timeout: int, project: str | None = None) -> dict:
    started = time.time()
    persistent = bool(project and PROJECT_RE.match(project))
    if persistent:
        run_id = uuid.uuid4().hex
        workdir = os.path.join(PROJECTS, project)  # type: ignore[arg-type]
        rel_dir = os.path.join("projects", project)  # type: ignore[arg-type]
    else:
        run_id = uuid.uuid4().hex
        workdir = os.path.join(WORK, run_id)
        rel_dir = run_id
    try:
        os.makedirs(workdir, exist_ok=True)
        os.chmod(workdir, 0o777)
    except OSError as e:
        return {
            "ok": False, "run_id": run_id, "dir": rel_dir, "stdout": "",
            "stderr": f"Нет доступа к рабочей папке: {e}",
            "timed_out": False, "returncode": -1, "files": [],
        }

    with open(os.path.join(workdir, "main.py"), "w", encoding="utf-8") as f:
        f.write(code)

    mpl_dir = "/tmp/mpl"
    os.makedirs(mpl_dir, exist_ok=True)
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/local/sbin:/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONUNBUFFERED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "MPLBACKEND": "Agg",
        "MPLCONFIGDIR": mpl_dir,
        "HOME": "/tmp",
        "TMPDIR": "/tmp",
    }

    timed_out = False
    returncode = 0
    stdout = ""
    stderr = ""
    try:
        proc = subprocess.run(
            [sys.executable, "-u", "main.py"],
            cwd=workdir,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            preexec_fn=_limits(timeout),
        )
        returncode = proc.returncode
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
    except subprocess.TimeoutExpired as e:
        timed_out = True
        returncode = -1

        def _as_text(v):
            if v is None:
                return ""
            return v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v)

        stdout = _as_text(e.stdout)
        stderr = _as_text(e.stderr) + f"\nПревышен лимит времени ({timeout} с) — процесс остановлен."
    except Exception as e:  # pragma: no cover
        returncode = -1
        stderr = f"Ошибка запуска: {type(e).__name__}: {e}"

    # in a persistent project only report what this run touched
    files = _collect(workdir, since=started if persistent else None)
    for item in files:
        try:
            os.chmod(os.path.join(workdir, item["path"]), 0o666)
        except OSError:
            pass

    _prune()
    return {
        "ok": (not timed_out) and returncode == 0,
        "run_id": run_id,
        "dir": rel_dir,
        "project": project if persistent else None,
        "stdout": _snip(stdout),
        "stderr": _snip(stderr),
        "timed_out": timed_out,
        "returncode": returncode,
        "files": files,
        "seconds": round(time.time() - started, 2),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "ChatStudioSandbox/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # keep the container log quiet-ish
        sys.stderr.write("[sandbox] " + (fmt % args) + "\n")

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path.startswith("/health"):
            self._json(200, {"ok": True})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if not self.path.startswith("/run"):
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            data = json.loads(raw or b"{}")
        except Exception as e:
            self._json(400, {"error": f"bad request: {e}"})
            return

        code = str(data.get("code") or "")
        if not code.strip():
            self._json(400, {"error": "empty code"})
            return
        try:
            timeout = int(data.get("timeout") or DEFAULT_TIMEOUT)
        except (TypeError, ValueError):
            timeout = DEFAULT_TIMEOUT
        timeout = max(5, min(timeout, 120))
        project = data.get("project")
        project = str(project) if project else None
        self._json(200, execute(code, timeout, project))


def main() -> None:
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(PROJECTS, exist_ok=True)
    os.makedirs("/tmp/mpl", exist_ok=True)
    try:
        os.chmod(PROJECTS, 0o777)
    except OSError:
        pass
    port = int(os.environ.get("SANDBOX_PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    sys.stderr.write(f"[sandbox] listening on :{port}, work={WORK}\n")
    server.serve_forever()


if __name__ == "__main__":
    main()

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

import base64
import hashlib
import hmac
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

WORK = os.environ.get("SANDBOX_WORK", "/work")
PROJECTS = os.path.join(WORK, "projects")
MAX_OUTPUT = int(os.environ.get("SANDBOX_MAX_OUTPUT", "12000"))
MAX_FILES = int(os.environ.get("SANDBOX_MAX_FILES", "24"))
MAX_FILE_BYTES = int(os.environ.get("SANDBOX_MAX_FILE_BYTES", str(30 * 1024 * 1024)))
MAX_INLINE_FILE_BYTES = int(os.environ.get("SANDBOX_MAX_INLINE_FILE_BYTES", str(4 * 1024 * 1024)))
MAX_INLINE_TOTAL_BYTES = int(os.environ.get("SANDBOX_MAX_INLINE_TOTAL_BYTES", str(8 * 1024 * 1024)))
MAX_CONCURRENT_RUNS = max(1, min(int(os.environ.get("SANDBOX_CONCURRENCY", "2")), 4))
RUN_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_RUNS)
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
            # Never serve a symlink target outside the generated workspace.
            if os.path.islink(path):
                continue
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


def _attach_inline_contents(workdir: str, files: list[dict]) -> None:
    """Attach small file contents so separate Render services need no shared disk."""
    total = 0
    for item in files:
        name = str(item.get("path") or "")
        if not name:
            item["transfer_error"] = "Некорректное имя файла"
            continue
        full = os.path.realpath(os.path.join(workdir, name))
        base = os.path.realpath(workdir)
        if os.path.commonpath([base, full]) != base or os.path.islink(os.path.join(workdir, name)):
            item["transfer_error"] = "Путь файла выходит за пределы рабочей папки"
            continue
        try:
            size = os.path.getsize(full)
            if size > MAX_INLINE_FILE_BYTES or total + size > MAX_INLINE_TOTAL_BYTES:
                item["transfer_error"] = "Файл больше лимита передачи через API"
                continue
            with open(full, "rb") as fh:
                payload = fh.read(MAX_INLINE_FILE_BYTES + 1)
            if len(payload) > MAX_INLINE_FILE_BYTES:
                item["transfer_error"] = "Файл больше лимита передачи через API"
                continue
            item["content_base64"] = base64.b64encode(payload).decode("ascii")
            total += len(payload)
        except OSError:
            item["transfer_error"] = "Не удалось прочитать созданный файл"


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
            resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))
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

    main_path = os.path.join(workdir, "main.py")
    try:
        # A previous run may have produced a symlink with this name. Never
        # follow it while writing the next script as the privileged runner.
        if os.path.islink(main_path):
            os.unlink(main_path)
        elif os.path.isdir(main_path):
            raise OSError("main.py path is a directory")
        elif os.path.exists(main_path):
            os.unlink(main_path)
        with open(main_path, "x", encoding="utf-8") as script_file:
            script_file.write(code)

        # The cache is disposable. Replace any previous file/symlink/directory
        # so no child-controlled path is chowned by the service process.
        mpl_dir = os.path.join(workdir, ".mpl")
        if os.path.islink(mpl_dir) or os.path.isfile(mpl_dir):
            os.unlink(mpl_dir)
        elif os.path.isdir(mpl_dir):
            shutil.rmtree(mpl_dir)
        os.makedirs(mpl_dir, mode=0o700, exist_ok=False)
    except OSError as e:
        return {
            "ok": False, "run_id": run_id, "dir": rel_dir, "stdout": "",
            "stderr": f"Не удалось подготовить рабочую папку: {type(e).__name__}",
            "timed_out": False, "returncode": -1, "files": [],
        }
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/local/sbin:/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONUNBUFFERED": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONPATH": "/srv",
        "MPLBACKEND": "Agg",
        "MPLCONFIGDIR": mpl_dir,
        "HOME": workdir,
        "TMPDIR": workdir,
        # Avoid multi-threaded BLAS oversubscribing a small free-tier container.
        "OPENBLAS_NUM_THREADS": "1",
        "OMP_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1",
    }

    # Use a stable UID for a persistent project and a distinct UID per one-off
    # run. This prevents one generated process from reading another project's
    # workdir even though both jobs share the same runner container.
    principal = "project:" + project if persistent else "run:" + run_id
    uid = 10000 + int(hashlib.sha256(principal.encode("utf-8")).hexdigest()[:12], 16) % 50000
    gid = uid

    try:
        os.chown(workdir, uid, gid)
        os.chmod(workdir, 0o700)
        for root, dirs, names in os.walk(workdir, topdown=True, followlinks=False):
            dirs[:] = [name for name in dirs if not os.path.islink(os.path.join(root, name))]
            for name in names:
                full = os.path.join(root, name)
                if os.path.islink(full):
                    continue
                os.chown(full, uid, gid)
                os.chmod(full, 0o600)
            for name in dirs:
                full = os.path.join(root, name)
                os.chown(full, uid, gid)
                os.chmod(full, 0o700)
                # For chmod recursion, os.walk will visit children below.
            os.chown(root, uid, gid)
            os.chmod(root, 0o700)
        # The private cache was created before ownership was changed and was
        # already included in the workspace ownership walk.
    except OSError as e:
        return {
            "ok": False, "run_id": run_id, "dir": rel_dir, "stdout": "",
            "stderr": f"Не удалось изолировать рабочую папку: {type(e).__name__}",
            "timed_out": False, "returncode": -1, "files": [],
        }

    run_options = {
        "cwd": workdir,
        "env": env,
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "text": True,
        "preexec_fn": _limits(timeout),
        "user": uid,
        "group": gid,
        "start_new_session": True,
    }
    # The service API key is never passed in the child environment. A separate
    # process group lets a timeout stop grandchildren as well as the main script.

    timed_out = False
    returncode = 0
    stdout = ""
    stderr = ""

    def _as_text(value) -> str:
        if value is None:
            return ""
        return value.decode("utf-8", "replace") if isinstance(value, bytes) else str(value)

    try:
        proc = subprocess.Popen([sys.executable, "-u", "main.py"], **run_options)
        try:
            out_text, err_text = proc.communicate(timeout=timeout)
            returncode = proc.returncode or 0
            stdout = out_text or ""
            stderr = err_text or ""
        except subprocess.TimeoutExpired as e:
            timed_out = True
            returncode = -1
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                proc.kill()
            out_text, err_text = proc.communicate()
            stdout = _as_text(out_text or e.output)
            stderr = _as_text(err_text or e.stderr) + (
                f"\nПревышен лимит времени ({timeout} с) — процесс и его дочерние процессы остановлены."
            )
    except Exception as e:  # pragma: no cover
        returncode = -1
        stderr = f"Ошибка запуска: {type(e).__name__}: {e}"

    # in a persistent project only report what this run touched
    files = _collect(workdir, since=started if persistent else None)
    _attach_inline_contents(workdir, files)
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

    def _authorized(self) -> bool:
        expected = os.environ.get("SANDBOX_API_KEY", "").strip()
        required = os.environ.get("SANDBOX_REQUIRE_AUTH", "0").strip().lower() in {
            "1", "true", "yes",
        }
        if not expected:
            return not required
        received = self.headers.get("Authorization", "")
        if not received.startswith("Bearer "):
            return False
        return hmac.compare_digest(received[7:].strip(), expected)

    def _json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path == "/health":
            self._json(200, {"ok": True})
            return
        if path.startswith("/project/"):
            if not self._authorized():
                self._json(401, {"error": "unauthorized"})
                return
            project = path[len("/project/"):]
            if not PROJECT_RE.fullmatch(project):
                self._json(400, {"error": "invalid project"})
                return
            workdir = os.path.join(PROJECTS, project)
            files = _collect(workdir) if os.path.isdir(workdir) else []
            self._json(200, {"ok": True, "project": project, "files": files})
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/run":
            self._json(404, {"error": "not found"})
            return
        if not self._authorized():
            self._json(401, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            if length < 0 or length > 256 * 1024:
                self._json(413, {"error": "code payload too large"})
                return
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
        if project and not PROJECT_RE.fullmatch(project):
            self._json(400, {"error": "invalid project"})
            return
        if not RUN_SLOTS.acquire(blocking=False):
            self._json(429, {"error": "sandbox busy; retry shortly"})
            return
        try:
            self._json(200, execute(code, timeout, project))
        except Exception as e:  # keep an unexpected runner error from killing the handler
            sys.stderr.write(f"[sandbox] execution handler failed: {type(e).__name__}\\n")
            self._json(500, {"error": "sandbox execution failed"})
        finally:
            RUN_SLOTS.release()


def main() -> None:
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(PROJECTS, exist_ok=True)
    os.makedirs("/tmp/mpl", exist_ok=True)
    # Only the runner process (root inside this service) can list or change
    # workspace directories. Child code gets execute/traverse access only.
    for path, mode in ((WORK, 0o711), (PROJECTS, 0o711)):
        try:
            os.chmod(path, mode)
        except OSError:
            pass
    port = int(os.environ.get("SANDBOX_PORT") or os.environ.get("PORT") or "8000")
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    sys.stderr.write(f"[sandbox] listening on :{port}, work={WORK}\n")
    server.serve_forever()


if __name__ == "__main__":
    main()

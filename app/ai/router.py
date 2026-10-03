"""AI Router: bounded worker pool with ModelSet fallback, streaming and cancel."""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import delete, select

from ..config import settings
from ..database import SessionLocal
from ..models import (
    Attachment,
    Chat,
    File,
    Memory,
    Message,
    MessageStatus,
    ModelSet,
    RouteType,
    Suggestion,
)
from ..services.files import detect_kind, sha256_bytes
from ..services.sandbox import cleanup, run_python
from . import model_sets as ms
from . import prompts
from .prompts import (
    extract_memories,
    extract_run_blocks,
    strip_run_blocks,
    strip_sandbox_paths,
)
from .providers import ProviderError, complete_chat, stream_chat

log = logging.getLogger("chatstudio.ai")


def _tool_feedback(run: dict) -> str:
    """What the model sees after its code has run."""
    parts = ["Результат выполнения твоего кода:"]
    if run.get("stdout"):
        parts.append("stdout:\n" + run["stdout"])
    if run.get("stderr"):
        parts.append("stderr:\n" + run["stderr"])
    if not run.get("stdout") and not run.get("stderr"):
        parts.append("(вывод пустой)")
    if run.get("timed_out"):
        parts.append("Код был остановлен по таймауту — сделай его быстрее.")
    if run.get("files"):
        parts.append(
            "Созданные файлы (уже отправлены пользователю в чат): "
            + ", ".join(f["name"] for f in run["files"])
        )
    parts.append(
        "Код завершился успешно."
        if run.get("ok")
        else "Код завершился с ошибкой — исправь и запусти снова."
    )
    parts.append("Если задача решена, дай финальный ответ пользователю без блока run.")
    return "\n".join(parts)


@dataclass
class EntryConfig:
    provider: str
    base_url: str
    api_key: str
    model: str
    temperature: float
    max_tokens: int
    timeout: int


@dataclass
class Job:
    kind: str  # "message" | "title" | "suggestions"
    route_type: RouteType
    chat_id: str
    history: list[dict] = field(default_factory=list)
    message_id: str | None = None
    user_text: str = ""
    model_set_id: str | None = None
    effort: str | None = None
    user_id: str | None = None
    mode: str = "chat"
    project: str | None = None
    depends_on: list[str] = field(default_factory=list)
    max_steps: int | None = None
    output: asyncio.Queue = field(default_factory=asyncio.Queue)
    cancel: asyncio.Event = field(default_factory=asyncio.Event)


def _clean_title(text: str) -> str:
    t = (text or "").strip().strip('"').strip("'").strip()
    t = t.splitlines()[0].strip() if t else ""
    low = t.lower()
    # guard against reasoning leakage from thinking-capable models
    if "thinking process" in low or low.startswith("here's") or low.startswith("here is"):
        return ""
    while t.endswith("."):
        t = t[:-1].strip()
    if len(t) > 80:
        return ""
    return t[:120]


def _parse_suggestions(text: str) -> list[str]:
    out: list[str] = []
    for line in (text or "").splitlines():
        t = line.strip().lstrip("-•*—").strip()
        t = re.sub(r"^\d+[.)]\s*", "", t).strip().strip('"').strip("'").strip()
        # keep only question-like, multi-word suggestions
        if len(t) > 8 and " " in t:
            out.append(t[:200])
    return out[:3]


class AIRouter:
    def __init__(self, concurrency: int) -> None:
        self.concurrency = max(1, concurrency)
        self.queue: asyncio.Queue[Job] = asyncio.Queue()
        self.workers: list[asyncio.Task] = []
        self.active: dict[str, Job] = {}

    async def start(self) -> None:
        for i in range(self.concurrency):
            self.workers.append(
                asyncio.create_task(self._worker(), name=f"ai-worker-{i}")
            )
        log.info(
            "AI Router: запущено %d воркеров (GLOBAL_AI_CONCURRENCY=%d)",
            self.concurrency,
            self.concurrency,
        )

    async def stop(self) -> None:
        for w in self.workers:
            w.cancel()
        for w in self.workers:
            try:
                await w
            except BaseException:
                pass
        self.workers.clear()

    async def enqueue(self, job: Job) -> None:
        if job.message_id and job.kind == "message":
            self.active[job.message_id] = job
        await self.queue.put(job)

    def cancel(self, message_id: str) -> bool:
        job = self.active.get(message_id)
        if job is None:
            return False
        job.cancel.set()
        return True

    # --- internals ---------------------------------------------------------

    async def _resolve_entries(
        self, route_type: RouteType, model_set_id: str | None = None
    ) -> tuple[str, str, list[EntryConfig]]:
        async with SessionLocal() as db:
            mset = None
            if model_set_id:
                candidate = await db.get(ModelSet, model_set_id)
                if candidate is not None and candidate.is_active:
                    mset = candidate
            if mset is None:
                mset = await ms.get_model_set(db, route_type)
            if mset is None:
                raise ProviderError(
                    f"Нет активного Model Set для маршрута {route_type.value}"
                )
            entries = await ms.get_active_entries(db, mset.id)
            if not entries:
                raise ProviderError(
                    f"Model Set «{mset.name}» не содержит активных моделей"
                )
            configs = [
                EntryConfig(
                    provider=e.provider,
                    base_url=e.base_url,
                    api_key=e.api_key,
                    model=e.model,
                    temperature=e.temperature,
                    max_tokens=e.max_tokens,
                    timeout=e.timeout,
                )
                for e in entries
            ]
            return mset.id, mset.name, configs

    async def _set_status(
        self,
        message_id: str | None,
        status: MessageStatus,
        model_set_id: str | None = None,
        model_name: str | None = None,
    ) -> None:
        if not message_id:
            return
        async with SessionLocal() as db:
            msg = await db.get(Message, message_id)
            if msg is None:
                return
            msg.status = status
            if model_set_id:
                msg.model_set_id = model_set_id
            if model_name and msg.chat_id:
                chat = await db.get(Chat, msg.chat_id)
                if chat is not None and chat.model_name != model_name:
                    chat.model_name = model_name
            await db.commit()

    async def _finish(
        self,
        message_id: str | None,
        status: MessageStatus,
        content: str | None = None,
        error: str | None = None,
        usage: dict | None = None,
        tool_runs: list[dict] | None = None,
    ) -> None:
        if not message_id:
            return
        async with SessionLocal() as db:
            msg = await db.get(Message, message_id)
            if msg is not None:
                if content is not None:
                    msg.content = content
                msg.status = status
                msg.error = error
                if tool_runs:
                    msg.tool_runs = json.dumps(tool_runs, ensure_ascii=False)
                if usage:
                    msg.tokens_in = int(usage.get("prompt_tokens") or 0)
                    msg.tokens_out = int(usage.get("completion_tokens") or 0)
                    details = usage.get("prompt_tokens_details") or {}
                    msg.tokens_cached = int(details.get("cached_tokens") or 0)
                await db.commit()

    async def _worker(self) -> None:
        while True:
            job = await self.queue.get()
            try:
                if job.kind == "title":
                    await self._run_title(job)
                elif job.kind == "suggestions":
                    await self._run_suggestions(job)
                elif job.kind == "merge":
                    await self._run_merge(job)
                else:
                    await self._run_message(job)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # pragma: no cover - defensive
                log.exception("AI worker error: %s", e)
                if job.kind == "message":
                    await job.output.put(("error", f"{type(e).__name__}: {e}"))
            finally:
                if job.message_id:
                    self.active.pop(job.message_id, None)
                self.queue.task_done()

    async def _stream_once(self, job: Job, entry, messages: list[dict]):
        """One model turn. Returns (full, thinking, usage) or None when cancelled."""
        full = ""
        thinking = ""
        usage: dict | None = None
        async for kind, piece in stream_chat(
            messages=messages,
            base_url=entry.base_url,
            api_key=entry.api_key,
            model=entry.model,
            temperature=entry.temperature,
            max_tokens=entry.max_tokens,
            timeout=entry.timeout,
            disable_thinking=settings.ai_disable_thinking,
            effort=job.effort,
        ):
            if kind == "usage":
                try:
                    usage = json.loads(piece)
                except Exception:
                    usage = None
                continue
            if job.cancel.is_set():
                await self._finish(
                    job.message_id,
                    MessageStatus.cancelled,
                    content=(full or thinking),
                    error="Остановлено пользователем",
                    usage=usage,
                )
                await job.output.put(("cancelled", full or thinking))
                return None
            if kind == "thinking":
                thinking += piece
                await job.output.put(("thinking", piece))
            else:
                full += piece
                await job.output.put(("delta", piece))
        return full, thinking, usage

    async def _attach_run_files(self, job: Job, result: dict) -> list[dict]:
        """Persist files produced by sandboxed code and attach them to the message."""
        items = result.get("files") or []
        if not items or not job.chat_id or not job.message_id:
            return []
        out: list[dict] = []
        async with SessionLocal() as db:
            chat = await db.get(Chat, job.chat_id)
            if chat is None:
                return []
            base = settings.upload_path / chat.user_id
            base.mkdir(parents=True, exist_ok=True)
            for item in items:
                try:
                    data = Path(item["abs"]).read_bytes()
                except OSError:
                    continue
                fid = str(uuid.uuid4())
                ext = Path(item["name"]).suffix
                dest = base / f"{fid}{ext}"
                try:
                    dest.write_bytes(data)
                except OSError:
                    continue
                kind = detect_kind(item["name"], "")
                db.add(
                    File(
                        id=fid,
                        user_id=chat.user_id,
                        storage_path=str(dest),
                        original_name=item["name"],
                        mime_type="",
                        size=len(data),
                        sha256=sha256_bytes(data),
                        extracted_text=None,
                        kind=kind,
                    )
                )
                db.add(Attachment(message_id=job.message_id, file_id=fid))
                out.append(
                    {
                        "id": fid,
                        "file_id": fid,
                        "name": item["name"],
                        "kind": kind,
                        "size": len(data),
                    }
                )
            await db.commit()
        return out

    async def _run_merge(self, job: Job) -> None:
        """Council: wait for every variant, then synthesise one answer."""
        deadline = time.time() + 300
        while time.time() < deadline:
            pending = False
            async with SessionLocal() as db:
                for mid in job.depends_on:
                    m = await db.get(Message, mid)
                    if m is None or m.status in (
                        MessageStatus.queued,
                        MessageStatus.processing,
                    ):
                        pending = True
                        break
            if not pending:
                break
            if job.cancel.is_set():
                await self._finish(
                    job.message_id, MessageStatus.cancelled, error="Остановлено"
                )
                await job.output.put(("cancelled", ""))
                return
            await asyncio.sleep(1.5)

        parts: list[str] = []
        question = job.user_text
        async with SessionLocal() as db:
            for i, mid in enumerate(job.depends_on, 1):
                m = await db.get(Message, mid)
                if m is not None and (m.content or "").strip():
                    parts.append(f"### Вариант {i}\n{m.content.strip()[:6000]}")
            if not question:
                res = await db.execute(
                    select(Message)
                    .where(Message.chat_id == job.chat_id, Message.role == Role.user)
                    .order_by(Message.created_at)
                    .limit(1)
                )
                first = res.scalars().first()
                question = first.content if first else ""

        if not parts:
            await self._finish(
                job.message_id, MessageStatus.failed, error="Варианты не получены"
            )
            await job.output.put(("error", "Варианты не получены"))
            return

        job.history = prompts.with_system(
            [
                {
                    "role": "user",
                    "content": prompts.COUNCIL_MERGE_TEMPLATE.format(
                        question=question, variants="\n\n".join(parts)
                    ),
                }
            ],
            prompts.MAIN_SYSTEM,
        )
        await job.output.put(
            ("step", json.dumps({"n": 0, "variants": len(parts)}))
        )
        await self._run_message(job)

    async def _is_router_set(self, mset_id: str | None) -> bool:
        if not mset_id:
            return False
        async with SessionLocal() as db:
            obj = await db.get(ModelSet, mset_id)
            return bool(obj and getattr(obj, "is_router", False))

    async def _route(self, job: Job, entry) -> tuple[str | None, str]:
        """Ask the routing model which concrete cluster fits this request."""
        async with SessionLocal() as db:
            rows = (
                await db.execute(
                    select(ModelSet).where(
                        ModelSet.route_type == RouteType.MAIN,
                        ModelSet.is_active.is_(True),
                    )
                )
            ).scalars().all()
        candidates = [s for s in rows if not getattr(s, "is_router", False)]
        if not candidates:
            return None, ""
        listing = "\n".join(f"{s.id} — {s.name}" for s in candidates)
        try:
            answer = await complete_chat(
                messages=[
                    {"role": "system", "content": prompts.ROUTER_SYSTEM},
                    {
                        "role": "user",
                        "content": (
                            f"Запрос пользователя:\n{job.user_text or '(пусто)'}\n\n"
                            f"Доступные кластеры:\n{listing}"
                        ),
                    },
                ],
                base_url=entry.base_url,
                api_key=entry.api_key,
                model=entry.model,
                temperature=0.0,
                max_tokens=200,
                timeout=min(entry.timeout, 90),
                disable_thinking=True,
            )
        except ProviderError as e:
            log.warning("Router failed: %s", e)
            return candidates[0].id, candidates[0].name
        text = (answer or "").strip()
        for s in candidates:
            if s.id in text or (s.name and s.name.lower() in text.lower()):
                return s.id, s.name
        return candidates[0].id, candidates[0].name

    async def _run_message(self, job: Job) -> None:
        try:
            mset_id, mset_name, entries = await self._resolve_entries(
                job.route_type, job.model_set_id
            )
        except ProviderError as e:
            await self._finish(job.message_id, MessageStatus.failed, error=str(e))
            await job.output.put(("error", str(e)))
            return

        # Auto (Routing): let the router cluster pick a concrete model set first
        if await self._is_router_set(mset_id):
            chosen_id, chosen_name = await self._route(job, entries[0])
            if chosen_id:
                await job.output.put(
                    ("route", json.dumps({"id": chosen_id, "name": chosen_name}))
                )
                job.model_set_id = chosen_id
                mset_id, mset_name, entries = await self._resolve_entries(
                    RouteType.MAIN, chosen_id
                )

        await self._set_status(
            job.message_id, MessageStatus.processing, mset_id, mset_name
        )

        agent_on = bool(settings.agent_enabled)
        code_mode = job.mode == "code"
        plan_steps = job.max_steps
        base_steps = plan_steps or (
            settings.code_agent_max_steps if code_mode else settings.agent_max_steps
        )
        steps_limit = base_steps
        max_steps = max(1, steps_limit) if agent_on else 1
        run_timeout = settings.code_agent_timeout if code_mode else settings.agent_timeout
        last_error = "Генерация не удалась"
        for entry in entries:
            if job.cancel.is_set():
                await self._finish(
                    job.message_id, MessageStatus.cancelled, error="Остановлено пользователем"
                )
                await job.output.put(("cancelled", ""))
                return
            try:
                messages = list(job.history)
                answer = ""
                thinking = ""
                usage: dict | None = None
                all_runs: list[dict] = []
                for step in range(max_steps):
                    got = await self._stream_once(job, entry, messages)
                    if got is None:
                        return
                    full, thinking, usage = got
                    runs = extract_run_blocks(full) if agent_on else []
                    if not runs:
                        answer = full if full.strip() else thinking
                        break
                    for code in runs:
                        await job.output.put(
                            ("tool_start", json.dumps({"code": code}, ensure_ascii=False))
                        )
                        result = await run_python(
                            code, timeout=run_timeout, project=job.project
                        )
                        attached = await self._attach_run_files(job, result)
                        run = {
                            "code": code,
                            "ok": bool(result.get("ok")),
                            "stdout": result.get("stdout", ""),
                            "stderr": result.get("stderr", ""),
                            "timed_out": bool(result.get("timed_out")),
                            "files": attached,
                        }
                        await job.output.put(("tool", json.dumps(run, ensure_ascii=False)))
                        all_runs.append(run)
                        messages = [
                            *messages,
                            {"role": "assistant", "content": full},
                            {"role": "user", "content": _tool_feedback(run)},
                        ]
                        cleanup(result.get("workdir"))
                    answer = strip_run_blocks(full)
                    if step + 1 < max_steps:
                        await job.output.put(("step", json.dumps({"n": step + 1})))

                if extract_run_blocks(answer):
                    answer = strip_run_blocks(answer)
                answer = strip_sandbox_paths(answer)
                if not answer.strip():
                    raise ProviderError("Пустой ответ модели")

                # pull [[memory: ...]] commands out of the visible answer
                answer, memories = extract_memories(answer)
                if memories and job.user_id:
                    async with SessionLocal() as db:
                        for kind, value in memories:
                            db.add(
                                Memory(
                                    user_id=job.user_id,
                                    content=value[:2000],
                                    kind=kind,
                                    message_id=job.message_id,
                                )
                            )
                        await db.commit()
                    await job.output.put(
                        ("memory", json.dumps([v for _, v in memories], ensure_ascii=False))
                    )

                await self._finish(
                    job.message_id,
                    MessageStatus.completed,
                    content=answer,
                    error=None,
                    usage=usage,
                    tool_runs=all_runs or None,
                )
                await job.output.put(("done", answer))
                await self.enqueue(
                    Job(
                        kind="suggestions",
                        route_type=RouteType.SUGGESTIONS,
                        chat_id=job.chat_id,
                        message_id=job.message_id,
                        history=[*messages, {"role": "assistant", "content": answer}],
                    )
                )
                return
            except ProviderError as e:
                last_error = str(e)
                log.warning("Model entry %s failed: %s", entry.model, e)
            except asyncio.CancelledError:
                await self._finish(
                    job.message_id, MessageStatus.cancelled, error="Остановлено"
                )
                await job.output.put(("cancelled", ""))
                return
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                log.warning("Model entry %s error: %s", entry.model, e)

        await self._finish(job.message_id, MessageStatus.failed, error=last_error)
        await job.output.put(("error", last_error))

    async def _run_title(self, job: Job) -> None:
        try:
            _, _, entries = await self._resolve_entries(RouteType.TITLE)
        except ProviderError as e:
            log.warning("Title generation skipped: %s", e)
            return

        messages = [
            {"role": "system", "content": prompts.TITLE_SYSTEM},
            {"role": "user", "content": job.user_text[:2000]},
        ]
        for entry in entries:
            try:
                raw = await complete_chat(
                    messages=messages,
                    base_url=entry.base_url,
                    api_key=entry.api_key,
                    model=entry.model,
                    temperature=0.3,
                    max_tokens=96,
                    timeout=min(entry.timeout, 60),
                    disable_thinking=True,
                )
                title = _clean_title(raw)
                if title:
                    async with SessionLocal() as db:
                        chat = await db.get(Chat, job.chat_id)
                        if chat is not None:
                            chat.title = title
                            await db.commit()
                    return
            except Exception as e:
                log.warning("Title entry %s failed: %s", entry.model, e)


    async def _run_suggestions(self, job: Job) -> None:
        if not job.message_id:
            return
        try:
            _, _, entries = await self._resolve_entries(RouteType.SUGGESTIONS)
        except ProviderError as e:
            log.warning("Suggestions skipped: %s", e)
            return

        dialogue = [m for m in job.history if m.get("role") != "system"]
        messages = [
            {"role": "system", "content": prompts.SUGGESTIONS_SYSTEM},
            *dialogue[-8:],
        ]
        for entry in entries:
            try:
                raw = await complete_chat(
                    messages=messages,
                    base_url=entry.base_url,
                    api_key=entry.api_key,
                    model=entry.model,
                    temperature=0.6,
                    max_tokens=220,
                    timeout=min(entry.timeout, 60),
                    disable_thinking=True,
                )
                items = _parse_suggestions(raw)
                if items:
                    async with SessionLocal() as db:
                        await db.execute(
                            delete(Suggestion).where(
                                Suggestion.message_id == job.message_id
                            )
                        )
                        for i, text in enumerate(items):
                            db.add(
                                Suggestion(
                                    message_id=job.message_id,
                                    chat_id=job.chat_id,
                                    position=i,
                                    text=text,
                                )
                            )
                        await db.commit()
                    return
            except Exception as e:
                log.warning("Suggestions entry %s failed: %s", entry.model, e)


router = AIRouter(settings.global_ai_concurrency)

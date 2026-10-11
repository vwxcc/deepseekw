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
    extract_ask,
    extract_memories,
    extract_run_blocks,
    strip_cot,
    strip_run_blocks,
    strip_sandbox_paths,
)
from .providers import ProviderError, complete_chat, stream_chat

log = logging.getLogger("chatstudio.ai")


def _tool_feedback(run: dict) -> str:
    """What the model sees after its code has run — very explicit."""
    parts = []
    ok = run.get("ok", False)
    timed_out = run.get("timed_out", False)
    stderr = run.get("stderr", "")
    stdout = run.get("stdout", "")
    files = run.get("files", [])

    parts.append("=" * 60)
    parts.append("РЕЗУЛЬТАТ ВЫПОЛНЕНИЯ ТВОЕГО КОДА:")
    parts.append("=" * 60)

    if ok and not timed_out:
        parts.append("✅ Код выполнен успешно.")
        if stdout:
            parts.append("")
            parts.append("Вывод (stdout):")
            parts.append(stdout)
        if files:
            parts.append("")
            parts.append("Созданные файлы (уже отправлены пользователю в чат):")
            for f in files:
                parts.append(f"  • {f['name']} ({f.get('size', 0)} байт)")
        parts.append("")
        parts.append("→ Если задача решена, дай ФИНАЛЬНЫЙ ответ пользователю без блока run.")
        parts.append("→ Не нужно запускать ещё один run, если результат уже хороший.")
        parts.append("→ Если хочешь проверить или улучшить — можешь написать новый run.")
    else:
        parts.append("❌ Код завершился с ОШИБКОЙ.")
        if stderr:
            parts.append("")
            parts.append("Ошибка (stderr):")
            parts.append(stderr)
        if timed_out:
            parts.append("")
            parts.append("⚠️ Код был остановлен по таймауту — сделай его быстрее или упрости.")
        parts.append("")
        if files:
            parts.append("Файлы созданы (но код не завершён успешно):")
            for f in files:
                parts.append(f"  • {f['name']}")
        parts.append("")
        parts.append("→ ИСПРАВЬ ОШИБКУ и напиши НОВЫЙ run-блок с исправленным кодом.")
        parts.append("→ Посмотри на stderr и исправь конкретную проблему.")
        parts.append("→ Можно переписать файл целиком или изменить только часть.")
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
    retried: bool = False
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


def _agent_history_budget() -> tuple[int, int]:
    """Return (max_steps_kept, max_chars_per_step) for agent message trimming."""
    return (4, 2400)  # keep last 4 step pairs, each ≤ 2.4K chars


def _compress_step_messages(
    old_assistant_content: str, old_feedback_content: str, step_number: int
) -> tuple[str, str]:
    """Compress one completed agent step to a short summary."""
    # Summarize the assistant's last answer (not the code, but the result)
    summary_parts = []
    # Take first meaningful paragraph (skip code blocks)
    for line in old_assistant_content.split("\n"):
        stripped = line.strip()
        if stripped.startswith("```"):
            continue
        if stripped:
            summary_parts.append(stripped)
            if len(summary_parts) >= 2:
                break
    brief = "\n".join(summary_parts)[:600]
    if not brief:
        brief = f"Шаг {step_number}: ответ получен (обрезан для экономии контекста)"
    # Compress feedback too
    fb_lines = old_feedback_content.split("\n")
    fb_summary = "ok" if "успешно" in old_feedback_content.lower() else "error"
    for line in fb_lines[:2]:
        ls = line.strip()
        if ls and not ls.startswith("=") and not ls.startswith("→"):
            fb_summary += " | " + ls[:80]
            break
    return brief, fb_summary


def _trim_agent_history(
    messages: list[dict],
    max_steps_kept: int = 4,
    max_chars_per_step: int = 2400,
) -> list[dict]:
    """Keep agent history under budget by compressing old steps.

    The messages list looks like:
      [system, user_msg, assistant(full+code), user(feedback),
       assistant(full+code), user(feedback), ...]

    We keep the system + original user request + last N step-pairs.
    Older step-pairs are replaced with 1-2 line summaries.
    """
    if not messages:
        return messages

    # Find the system message index (should be index 0)
    # Everything after the first user message that isn't system/assistant/feedback is
    # part of the conversation context.
    # For agent jobs, the structure is predictable:
    #   msg[0] = system
    #   msg[1] = user (original request)
    #   msg[2..n] = alternating assistant, user(feedback) pairs

    if len(messages) <= 2 + 2 * max_steps_kept:
        # Small enough, just truncate oversized content
        return _truncate_agent_content(messages, max_chars_per_step)

    # We have more steps than we can keep — compress old ones
    system_msg = messages[0]
    original_user = messages[1] if len(messages) > 1 else None

    # Collect all step pairs (assistant + feedback)
    all_pairs = []
    i = 2
    while i + 1 < len(messages):
        assistant_msg = messages[i]
        feedback_msg = messages[i + 1]
        if (
            assistant_msg.get("role") == "assistant"
            and feedback_msg.get("role") == "user"
        ):
            all_pairs.append((i // 2, assistant_msg, feedback_msg))
            i += 2
        else:
            # Non-step message (e.g., original user message in a different format)
            all_pairs.append((i // 2, assistant_msg, None))
            i += 1

    if not all_pairs:
        return _truncate_agent_content(messages, max_chars_per_step)

    # Keep last N pairs intact, compress the rest
    n_total = len(all_pairs)
    n_keep = min(max_steps_kept, n_total)
    n_compress = n_total - n_keep

    compressed = []
    if n_compress > 0:
        # Summarize all old steps into a single compact block
        summaries = []
        for idx in range(n_compress):
            _, old_assistant, old_feedback = all_pairs[idx]
            if old_assistant and old_feedback:
                brief, fb = _compress_step_messages(
                    old_assistant.get("content", ""),
                    old_feedback.get("content", ""),
                    idx + 1,
                )
                summaries.append(
                    f"Шаг {idx + 1}: {fb} — «{brief[:100]}»"
                )
        if summaries:
            compressed.append(
                {
                    "role": "user",
                    "content": (
                        "[Резюме предыдущих шагов]\n"
                        + "\n".join(summaries[:20])  # max 20 summaries
                        + "\n[Продолжаю с места, где остановился.]"
                    ),
                }
            )

    # Keep last N pairs
    kept_pairs = all_pairs[n_compress:]

    result = [system_msg]
    if original_user:
        result.append(original_user)
    result.extend(compressed)
    for _, assistant, feedback in kept_pairs:
        result.append(assistant)
        if feedback:
            result.append(feedback)

    return result


def _truncate_agent_content(
    messages: list[dict], max_chars_per_step: int = 2400
) -> list[dict]:
    """Truncate oversized content in messages (when no compression needed)."""
    import copy

    result = []
    for msg in messages:
        content = msg.get("content", "")
        if isinstance(content, str) and len(content) > max_chars_per_step:
            content = content[:max_chars_per_step] + "\n\n[… контент обрезан, подробности ниже]"
        result.append({**msg, "content": content})
    return result


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
        thinking: str | None = None,
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
                if thinking:
                    msg.thinking = thinking[:50000]
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
                    thinking=thinking or None,
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

    async def _route(self, job: Job, entry) -> tuple[str | None, str, str]:
        """Ask the routing model to compress the request and pick a cluster.

        Considers conversation history for better routing decisions.
        Returns ``(set_id, set_name, brief)``.
        """
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
            return None, "", ""
        listing = "\n".join(f"{s.id} — {s.name}" for s in candidates)

        # Build context: last 3 exchanges in the conversation (if available)
        context_parts = []
        if job.history:
            # Skip system message, take last user+assistant pairs
            history_msgs = [m for m in job.history if m.get("role") != "system"]
            last_turns = history_msgs[-6:]  # last 3 exchanges (user + assistant)
            for m in last_turns:
                role = m.get("role", "unknown")
                content = m.get("content", "")
                if isinstance(content, list):
                    # multimodal content
                    text_parts = []
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            text_parts.append(part.get("text", ""))
                    content = " ".join(text_parts)
                context_parts.append(f"{role}: {content[:200]}")
        context_str = "\n".join(context_parts)
        brief = ""
        chosen = None
        try:
            user_input = job.user_text or ""
            route_prompt = f"Запрос пользователя:\n{user_input}"
            if context_str:
                route_prompt += f"\n\nПредыдущий контекст диалога:\n{context_str[:2000]}"
            route_prompt += f"\n\nДоступные кластеры:\n{listing}"
            answer = await complete_chat(
                messages=[
                    {"role": "system", "content": prompts.ROUTER_SYSTEM},
                    {"role": "user", "content": route_prompt},
                ],
                base_url=entry.base_url,
                api_key=entry.api_key,
                model=entry.model,
                temperature=0.0,
                max_tokens=300,
                timeout=min(entry.timeout, 90),
                disable_thinking=True,
            )
            text = (answer or "").strip()
            match = re.search(r"\{[\s\S]*\}", text)
            data = json.loads(match.group(0)) if match else {}
            brief = str(data.get("brief") or "")[:300]
            raw_cluster = str(data.get("cluster") or "")
            for s in candidates:
                if s.id == raw_cluster.strip() or (raw_cluster and s.id in raw_cluster):
                    chosen = s
                    break
            if chosen is None:
                for s in candidates:
                    if s.name and s.name.lower() in text.lower():
                        chosen = s
                        break
        except (ProviderError, json.JSONDecodeError, ValueError) as e:
            log.warning("Router failed: %s", e)
        if chosen is None:
            chosen = candidates[0]
        return chosen.id, chosen.name, brief

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
            chosen_id, chosen_name, brief = await self._route(job, entries[0])
            if chosen_id:
                await job.output.put(
                    ("route", json.dumps(
                        {"id": chosen_id, "name": chosen_name, "brief": brief},
                        ensure_ascii=False,
                    ))
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
                all_thinking = []
                usage: dict | None = None
                all_runs: list[dict] = []
                step_counter = 0
                for step in range(max_steps):
                    # Trim history before sending to model (keep it sane)
                    messages = _trim_agent_history(messages)
                    got = await self._stream_once(job, entry, messages)
                    if got is None:
                        return
                    full, thinking, usage = got
                    if thinking:
                        all_thinking.append(thinking)
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
                        step_counter += 1
                        messages = [
                            *messages,
                            {"role": "assistant", "content": full},
                            {"role": "user", "content": _tool_feedback(run)},
                        ]
                        # Trim after adding new step — keep history bounded
                        messages = _trim_agent_history(messages)
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
                answer, ask = extract_ask(answer)
                answer = strip_cot(answer)
                if not ask and len(answer) <= 500:
                    # fallback: a short answer that ends with a question is a clarification
                    tail = answer.strip().split("\n")[-1].strip()
                    if tail.endswith("?") and 12 < len(tail) < 260:
                        ask = tail
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
                    thinking="\n".join(all_thinking) if all_thinking else None,
                )
                if ask:
                    await job.output.put(
                        ("ask", json.dumps({"question": ask}, ensure_ascii=False))
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

        # one automatic retry with the same model (matters for Auto routing)
        if not job.retried and not job.cancel.is_set():
            job.retried = True
            log.warning("Retrying once: %s", last_error)
            await job.output.put(("step", json.dumps({"n": 0, "retry": True})))
            await self.enqueue(job)
            return
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

"""AI Router: bounded worker pool with ModelSet fallback, streaming and cancel."""
from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field

from sqlalchemy import delete, select

from ..config import settings
from ..database import SessionLocal
from ..models import (
    Chat,
    Memory,
    Message,
    MessageStatus,
    ModelSet,
    RouteType,
)
from . import model_sets as ms
from . import prompts
from .prompts import (
    extract_ask,
    extract_memories,
    strip_cot,
)
from .providers import ProviderError, complete_chat, stream_chat

log = logging.getLogger("ai-ch.ai")


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
    generate_title: bool = False
    effort: str | None = None
    user_id: str | None = None
    retried: bool = False
    requeued: bool = False
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
                else:
                    await self._run_message(job)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # pragma: no cover - defensive
                log.exception("AI worker error: %s", e)
                if job.kind == "message":
                    await job.output.put(("error", f"{type(e).__name__}: {e}"))
            finally:
                if job.message_id and not job.requeued:
                    self.active.pop(job.message_id, None)
                job.requeued = False
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
            mset_id, mset_name, entries = await self._resolve_entries(job.route_type, job.model_set_id)
        except ProviderError as e:
            await self._finish(job.message_id, MessageStatus.failed, error=str(e))
            await job.output.put(("error", str(e)))
            return
        if await self._is_router_set(mset_id):
            chosen_id, chosen_name, brief = await self._route(job, entries[0])
            if chosen_id:
                await job.output.put(("route", json.dumps({"id": chosen_id, "name": chosen_name, "brief": brief}, ensure_ascii=False)))
                job.model_set_id = chosen_id
                mset_id, mset_name, entries = await self._resolve_entries(RouteType.MAIN, chosen_id)
        await self._set_status(job.message_id, MessageStatus.processing, mset_id, mset_name)
        last_error = "Генерация не удалась"
        for index, entry in enumerate(entries):
            if index:
                await job.output.put(("step", json.dumps({"attempt": index + 1, "total": len(entries)}, ensure_ascii=False)))
            if job.cancel.is_set():
                await self._finish(job.message_id, MessageStatus.cancelled, error="Остановлено пользователем")
                await job.output.put(("cancelled", ""))
                return
            try:
                result = await self._stream_once(job, entry, list(job.history))
                if result is None:
                    return
                full, thinking, usage = result
                answer = full if full.strip() else thinking
                answer, memories = extract_memories(answer)
                answer, ask = extract_ask(answer)
                answer = strip_cot(answer)
                if not answer.strip():
                    raise ProviderError("Пустой ответ модели")
                if memories and job.user_id:
                    async with SessionLocal() as db:
                        for kind, value in memories:
                            db.add(Memory(user_id=job.user_id, content=value[:2000], kind=kind, message_id=job.message_id))
                        await db.commit()
                    await job.output.put(("memory", json.dumps([value for _, value in memories], ensure_ascii=False)))
                await self._finish(job.message_id, MessageStatus.completed, content=answer, error=None, usage=usage, thinking=thinking if thinking else None)
                if ask:
                    await job.output.put(("ask", json.dumps({"question": ask}, ensure_ascii=False)))
                # Queue the title only after a successful answer has been committed.
                # With the single Render worker, a follow-up request is queued after title generation.
                if job.generate_title:
                    await self.enqueue(
                        Job(
                            kind="title",
                            route_type=RouteType.TITLE,
                            chat_id=job.chat_id,
                            user_text=job.user_text,
                        )
                    )
                await job.output.put(("done", answer))
                return
            except ProviderError as e:
                last_error = str(e)
                log.warning("Model entry %s failed: %s", entry.model, e)
            except asyncio.CancelledError:
                await self._finish(job.message_id, MessageStatus.cancelled, error="Остановлено")
                await job.output.put(("cancelled", ""))
                return
            except Exception as e:
                last_error = f"{type(e).__name__}: {e}"
                log.warning("Model entry %s error: %s", entry.model, e)
        if not job.retried and not job.cancel.is_set():
            job.retried = True
            job.requeued = True
            await job.output.put(("step", json.dumps({"attempt": 1, "total": len(entries), "retry": True}, ensure_ascii=False)))
            log.warning("Retrying once after fallback chain failure: %s", last_error)
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




router = AIRouter(settings.global_ai_concurrency)

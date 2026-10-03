"""AI Router: bounded worker pool with ModelSet fallback, streaming and cancel."""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from ..config import settings
from ..database import SessionLocal
from ..models import Chat, Message, MessageStatus, RouteType
from . import model_sets as ms
from . import prompts
from .providers import ProviderError, complete_chat, stream_chat

log = logging.getLogger("chatstudio.ai")


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
    kind: str  # "message" | "title"
    route_type: RouteType
    chat_id: str
    history: list[dict] = field(default_factory=list)
    message_id: str | None = None
    user_text: str = ""
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
        if job.message_id:
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
        self, route_type: RouteType
    ) -> tuple[str, str, list[EntryConfig]]:
        async with SessionLocal() as db:
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
        self, message_id: str | None, status: MessageStatus, model_set_id: str | None = None
    ) -> None:
        if not message_id:
            return
        async with SessionLocal() as db:
            msg = await db.get(Message, message_id)
            if msg is not None:
                msg.status = status
                if model_set_id:
                    msg.model_set_id = model_set_id
                await db.commit()

    async def _finish(
        self,
        message_id: str | None,
        status: MessageStatus,
        content: str | None = None,
        error: str | None = None,
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
                if job.message_id:
                    self.active.pop(job.message_id, None)
                self.queue.task_done()

    async def _run_message(self, job: Job) -> None:
        try:
            mset_id, mset_name, entries = await self._resolve_entries(job.route_type)
        except ProviderError as e:
            await self._finish(job.message_id, MessageStatus.failed, error=str(e))
            await job.output.put(("error", str(e)))
            return

        await self._set_status(job.message_id, MessageStatus.processing, mset_id)

        last_error = "Генерация не удалась"
        for entry in entries:
            if job.cancel.is_set():
                await self._finish(
                    job.message_id, MessageStatus.cancelled, error="Остановлено пользователем"
                )
                await job.output.put(("cancelled", ""))
                return
            try:
                full = ""
                async for piece in stream_chat(
                    messages=job.history,
                    base_url=entry.base_url,
                    api_key=entry.api_key,
                    model=entry.model,
                    temperature=entry.temperature,
                    max_tokens=entry.max_tokens,
                    timeout=entry.timeout,
                    disable_thinking=settings.ai_disable_thinking,
                ):
                    if job.cancel.is_set():
                        await self._finish(
                            job.message_id,
                            MessageStatus.cancelled,
                            content=full,
                            error="Остановлено пользователем",
                        )
                        await job.output.put(("cancelled", full))
                        return
                    full += piece
                    await job.output.put(("delta", piece))

                if not full.strip():
                    raise ProviderError("Пустой ответ модели")

                await self._finish(job.message_id, MessageStatus.completed, content=full, error=None)
                await job.output.put(("done", full))
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


router = AIRouter(settings.global_ai_concurrency)

"""Single-primary-model AI worker with bounded concurrency and streaming.

All answer, title, and compression tasks resolve to the first active entry in
one active non-router MAIN model set. Other sets and fallback entries are ignored.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import math
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from sqlalchemy import select

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
    Role,
    RouteType,
    User,
)
from .activity_stream import ActivityMarkupParser
from ..services.files import detect_kind, sha256_bytes
from ..services.limits import get_limits
from ..services.sandbox import cleanup, run_python
from ..services.usage import account, est, record, window_spend
from ..services.websearch import format_context, image_search, web_search
from . import model_sets as ms
from . import prompts
from .provider_config import apply_primary_provider_overrides
from .prompts import (
    extract_ask,
    extract_memories,
    extract_agent_blocks,
    extract_run_blocks,
    strip_agent_blocks,
    strip_cot,
    strip_run_blocks,
    strip_sandbox_paths,
)
from .providers import (
    ProviderError,
    complete_chat,
    is_model_unavailable_error,
    stream_chat,
)

log = logging.getLogger("chatstudio.ai")


def _fileplan_runner(plan_source: str) -> tuple[str, str, str]:
    """Turn a JSON-only file plan into a fixed renderer call, never model-supplied Python."""
    try:
        plan = json.loads(plan_source)
    except json.JSONDecodeError:
        plan = {}
    encoded = base64.b64encode(plan_source.encode("utf-8")).decode("ascii")
    fmt = str(plan.get("format") or "file").upper()[:8]
    template = str(plan.get("template_id") or "auto")[:60]
    title = str(plan.get("title") or "Без названия").strip()[:90]
    blocks = plan.get("blocks", plan.get("slides", plan.get("sections", [])))
    count = len(blocks) if isinstance(blocks, list) else 0
    display = f"План сборки файла · {fmt} · {template} · {title} · блоков: {count}"
    code = (
        "import base64, json\n"
        "from pathlib import Path\n"
        "from designs.templates import build_from_plan\n"
        f"plan_source = base64.b64decode({encoded!r}).decode('utf-8')\n"
        "result = build_from_plan('out', plan_source)\n"
        "print(json.dumps({"
        "'ok': True, 'format': result['format'], 'template_id': result['template_id'], "
        "'title': result['title'], 'style': result['style'], "
        "'files': [Path(p).name for p in result.get('files', [])], "
        "'previews': len(result.get('previews', []))"
        "}, ensure_ascii=False))\n"
    )
    return code, display, plan_source


def _normalise_generated_filename(value: Any) -> str:
    """Clean model-added file-type prefixes from files created by ordinary run code."""
    raw = Path(str(value or "")).name
    raw = re.sub(r"\.(ppt|doc|xls)_$", lambda m: "." + m.group(1) + "x", raw, flags=re.I)
    suffix = Path(raw).suffix
    stem = raw[:-len(suffix)] if suffix else raw
    stem = re.sub(
        r"^(?:(?:pptx?|docx?|word|xlsx?|excel|pdf|svg|png|csv|json|markdown|md|text|txt)[_-])+",
        "", stem, flags=re.I,
    )
    stem = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", stem)
    stem = re.sub(r"\s+", "-", stem).strip(" .-_")[:140].strip(" .-_")
    suffix = suffix[:16]
    return (stem or "generated-file") + suffix


def _tool_feedback(run: dict) -> str:
    """Return execution feedback without confusing file plans with executable model code."""
    is_fileplan = run.get("kind") == "fileplan"
    parts = [
        "Результат сборки файла по проверенному шаблону:" if is_fileplan
        else "Результат выполнения кода:"
    ]
    if run.get("stdout"):
        parts.append("stdout:\n" + run["stdout"])
    if run.get("stderr"):
        parts.append("stderr:\n" + run["stderr"])
    if not run.get("stdout") and not run.get("stderr"):
        parts.append("(вывод пустой)")
    if run.get("timed_out"):
        parts.append("Операция остановлена по таймауту — упрости её.")
    if run.get("files"):
        parts.append(
            "Файлы, уже прикреплённые пользователю: "
            + ", ".join(str(f.get("name") or "файл") for f in run["files"] if isinstance(f, dict))
        )
    parts.append(
        "Сборка/выполнение завершено успешно." if run.get("ok") and not run.get("timed_out")
        else "Операция завершилась ошибкой — проанализируй stderr и исправь план или код."
    )
    parts.append("Если задача решена, дай финальный ответ пользователю без служебного блока.")
    return "\n".join(parts)


@dataclass
class EntryConfig:
    """Plain snapshot of a model entry — safe to use outside its DB session."""

    id: str
    model_set_id: str
    provider: str
    base_url: str
    api_key: str
    model: str
    temperature: float
    max_tokens: int
    timeout: int
    max_parallel: int = 2
    price_in: float = 0.0
    price_out: float = 0.0
    price_cache: float = 0.0

    @property
    def label(self) -> str:
        return self.model or self.id


@dataclass
class Job:
    kind: str  # "message" | "followup" | "merge"
    route_type: RouteType
    chat_id: str
    history: list[dict] = field(default_factory=list)
    message_id: str | None = None
    user_text: str = ""
    model_set_id: str | None = None
    effort: str | None = None
    user_id: str | None = None
    mode: str = "chat"
    execution_target: str = "site"
    project: str | None = None
    depends_on: list[str] = field(default_factory=list)
    max_steps: int | None = None
    retried: bool = False
    # built by the API layer, consumed by the worker
    system_prompt: str = ""
    history_messages: list[dict] = field(default_factory=list)
    search_query: str = ""
    web_search: bool = True
    first_exchange: bool = False
    output: asyncio.Queue = field(default_factory=asyncio.Queue)
    cancel: asyncio.Event = field(default_factory=asyncio.Event)


class ModelPool:
    """Keeps concurrency bounded for the single selected primary model."""

    def __init__(self) -> None:
        self._used: dict[str, int] = {}
        self._cond = asyncio.Condition()

    async def acquire(
        self,
        entries: list[EntryConfig],
        skip: set[str] | None = None,
        cancel: asyncio.Event | None = None,
    ) -> EntryConfig | None:
        """First entry with a free slot; waits while every model is saturated."""
        skip = skip or set()
        while True:
            if cancel is not None and cancel.is_set():
                return None
            async with self._cond:
                for entry in entries:
                    if entry.id in skip:
                        continue
                    limit = max(1, int(entry.max_parallel or 2))
                    if self._used.get(entry.id, 0) < limit:
                        self._used[entry.id] = self._used.get(entry.id, 0) + 1
                        return entry
            # The configured primary is at its concurrency limit; wait for its slot.
            try:
                async with self._cond:
                    await asyncio.wait_for(self._cond.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                pass

    async def release(self, entry: EntryConfig) -> None:
        async with self._cond:
            left = self._used.get(entry.id, 0) - 1
            if left > 0:
                self._used[entry.id] = left
            else:
                self._used.pop(entry.id, None)
            self._cond.notify_all()

    def busy(self) -> dict[str, int]:
        return dict(self._used)


pool = ModelPool()


def _estimate_text_tokens(value) -> tuple[int, int]:
    """Conservative text-token estimate; encoded image data is counted as image tokens."""
    if isinstance(value, str):
        if value.startswith("data:image/"):
            return 0, 1700
        return math.ceil(len(value) / 3.0), 0
    if isinstance(value, dict):
        if value.get("type") == "image_url" or "image_url" in value:
            return 0, 1700
        total_text = total_images = 0
        for key, item in value.items():
            if key in {"url", "image", "image_url"}:
                continue
            text_tokens, image_tokens = _estimate_text_tokens(item)
            total_text += text_tokens
            total_images += image_tokens
        return total_text, total_images
    if isinstance(value, (list, tuple)):
        total_text = total_images = 0
        for item in value:
            text_tokens, image_tokens = _estimate_text_tokens(item)
            total_text += text_tokens
            total_images += image_tokens
        return total_text, total_images
    return 0, 0


def _estimated_model_call_cost(
    entry: "EntryConfig", messages: list[dict], max_tokens: int | None = None
) -> float:
    """Upper estimate before a paid call, preventing one call from overshooting a quota."""
    input_tokens, image_tokens = _estimate_text_tokens(messages)
    input_tokens = max(1, input_tokens + image_tokens)
    configured_output = max_tokens if max_tokens is not None else entry.max_tokens
    output_tokens = max(0, int(configured_output or 0))
    price_in = max(0.0, float(entry.price_in or 0.0))
    price_out = max(0.0, float(entry.price_out or 0.0))
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000.0


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


def _local_code_chat_title(user_text: str | None) -> str:
    """Build a useful project title without an extra model request."""
    text = re.sub(r"\s+", " ", (user_text or "").strip())
    if not text:
        return "Код-проект"
    # Prefer the first sentence, but never scan or copy an unbounded prompt.
    text = re.split(r"(?<=[.!?])\s+", text[:500], maxsplit=1)[0].strip()
    if len(text) > 48:
        shortened = text[:45].rsplit(" ", 1)[0].rstrip(" ,;:-")
        text = (shortened or text[:45]) + "…"
    return _clean_title(text) or "Код-проект"


class AIRouter:
    def __init__(self, concurrency: int) -> None:
        self.concurrency = max(1, concurrency)
        self.queue: asyncio.Queue[Job] = asyncio.Queue()
        self.workers: list[asyncio.Task] = []
        self.active: dict[str, Job] = {}
        # Serialize complete user-facing main responses (including agent steps).
        # A browser chat switch does not cancel the server-side job.
        self._primary_generation_lock = asyncio.Lock()

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

    # --- single primary model ---------------------------------------------

    async def _resolve_entries(
        self, route_type: RouteType, model_set_id: str | None = None
    ) -> tuple[str, str, list[EntryConfig]]:
        """Resolve every AI task to the same single primary model.

        Per-action model sets, client-supplied set IDs, router sets, and fallback
        entries are intentionally ignored. The primary is the first active
        non-router MAIN set (stable alphabetical order) and its first active entry.
        A failed or busy primary is never silently replaced by another model.
        """
        del route_type, model_set_id
        async with SessionLocal() as db:
            result = await db.execute(
                select(ModelSet)
                .where(
                    ModelSet.route_type == RouteType.MAIN,
                    ModelSet.is_active.is_(True),
                    ModelSet.is_router.is_(False),
                )
                .order_by(ModelSet.name, ModelSet.id)
            )
            candidates = result.scalars().all()
            mset = None
            entries = []
            for candidate in candidates:
                active_entries = await ms.get_active_entries(db, candidate.id)
                if active_entries:
                    mset = candidate
                    # The first configured entry is the primary. No fallback chain.
                    entries = active_entries[:1]
                    break
            if mset is None or not entries:
                raise ProviderError(
                    "Нет активной основной модели. Включите основной MAIN-набор "
                    "без Auto Routing и добавьте в него активную модель."
                )
            e = entries[0]
            primary_provider, primary_base_url, primary_api_key, primary_model = (
                apply_primary_provider_overrides(
                    e.provider, e.base_url, e.api_key, e.model
                )
            )
            configs = [
                EntryConfig(
                    id=e.id,
                    model_set_id=e.model_set_id,
                    provider=primary_provider,
                    base_url=primary_base_url,
                    api_key=primary_api_key,
                    model=primary_model,
                    temperature=e.temperature,
                    max_tokens=e.max_tokens,
                    timeout=e.timeout,
                    max_parallel=int(getattr(e, "max_parallel", 2) or 2),
                    price_in=float(
                        settings.qwen_price_in
                        if settings.qwen_price_in is not None
                        else (getattr(e, "price_in", 0.0) or 0.0)
                    ),
                    price_out=float(
                        settings.qwen_price_out
                        if settings.qwen_price_out is not None
                        else (getattr(e, "price_out", 0.0) or 0.0)
                    ),
                    price_cache=float(
                        settings.qwen_price_cache
                        if settings.qwen_price_cache is not None
                        else (getattr(e, "price_cache", 0.0) or 0.0)
                    ),
                )
            ]
            return mset.id, mset.name, configs

    async def _acquire_primary(
        self, job: Job, entries: list[EntryConfig], skip: set[str]
    ) -> EntryConfig | None:
        return await pool.acquire(entries, skip, job.cancel)

    # --- persistence helpers ----------------------------------------------

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
        sources: list[dict] | None = None,
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
                if sources is not None:
                    msg.sources = (
                        json.dumps(sources, ensure_ascii=False) if sources else None
                    )
                if usage:
                    msg.tokens_in = int(usage.get("prompt_tokens") or 0)
                    msg.tokens_out = int(usage.get("completion_tokens") or 0)
                    details = usage.get("prompt_tokens_details") or {}
                    msg.tokens_cached = int(details.get("cached_tokens") or 0)
                await db.commit()

    async def _bill(
        self, job: Job, entry: EntryConfig, usage: dict | None, action: str
    ) -> None:
        """Write the money record for one billed call."""
        if not usage:
            return
        tin = int(usage.get("prompt_tokens") or 0)
        tout = int(usage.get("completion_tokens") or 0)
        details = usage.get("prompt_tokens_details") or {}
        tcached = int(details.get("cached_tokens") or 0)
        if tin + tout <= 0:
            return
        try:
            async with SessionLocal() as db:
                await record(
                    db,
                    user_id=job.user_id,
                    chat_id=job.chat_id,
                    message_id=job.message_id,
                    entry=entry,
                    action=action,
                    tokens_in=tin,
                    tokens_out=tout,
                    tokens_cached=tcached,
                )
                await db.commit()
        except Exception as e:  # noqa: BLE001 - accounting must never break a chat
            log.warning("Billing failed (%s): %s", action, e)

    async def _budget_error(self, job: Job, estimated_cost_usd: float = 0.0) -> str | None:
        """Block only when actual rolling-window spend has reached the configured budget.

        The estimated cost of the next call must not block a request while the
        account still has budget left. The user asked for a hard stop only at
        100% actual usage; estimated cost is therefore intentionally non-blocking.
        Keep the parameter for existing call sites and compatibility.
        """
        del estimated_cost_usd
        if not job.user_id:
            return None
        try:
            async with SessionLocal() as db:
                user = await db.get(User, job.user_id)
                if user is None:
                    return "Не удалось проверить владельца запроса. Повторите попытку."
                limits = await get_limits(db, user.plan or "free")
                budget_value = limits.get("budget_usd")
                if budget_value is None:
                    return None
                budget = max(0.0, float(budget_value))
                hours = max(1, int(limits.get("window_hours") or 5))
                spent, _ = await window_spend(db, user.id, hours)
        except Exception as e:  # noqa: BLE001
            log.warning("Budget check failed: %s", e)
            return "Не удалось проверить расходный лимит. Повторите запрос позже."

        # Stop only once actual recorded spend is 100% (or more) of the limit.
        # Do not reject an otherwise valid request based on the remaining balance
        # or a conservative estimate of its potential maximum cost.
        if spent >= budget:
            return (
                f"Лимит исчерпан: израсходовано ${spent:.2f} из ${budget:.2f} "
                f"за последние {hours} ч. Новые запросы откроются, когда часть расходов выйдет из скользящего окна."
            )
        return None

    # --- worker ------------------------------------------------------------

    async def _worker(self) -> None:
        while True:
            job = await self.queue.get()
            try:
                if job.kind == "followup":
                    await self._run_followup(job)
                elif job.kind == "merge":
                    await self._run_merge(job)
                else:
                    await self._run_serialized_message(job)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # pragma: no cover - defensive
                log.exception("AI worker error: %s", e)
                if job.kind == "message":
                    await job.output.put(("error", f"{type(e).__name__}: {e}"))
            finally:
                if job.message_id and job.kind == "message":
                    self.active.pop(job.message_id, None)
                self.queue.task_done()

    async def _run_serialized_message(self, job: Job) -> None:
        """Hold the primary generation slot for the complete response, not one token loop."""
        announced_wait = False
        while True:
            if job.cancel.is_set():
                await self._finish(
                    job.message_id, MessageStatus.cancelled,
                    error="Остановлено пользователем",
                )
                await job.output.put(("cancelled", ""))
                return
            try:
                await asyncio.wait_for(self._primary_generation_lock.acquire(), timeout=0.25)
                break
            except asyncio.TimeoutError:
                if not announced_wait:
                    announced_wait = True
                    await job.output.put(("ui_status", "Ожидаю завершения предыдущего ответа"))
        try:
            await self._run_message(job)
        finally:
            self._primary_generation_lock.release()

    async def _stream_once(self, job: Job, entry: EntryConfig, messages: list[dict]):
        """Stream clean answer text while forwarding short activity metadata separately."""
        full = ""
        thinking = ""
        usage: dict | None = None
        markup = ActivityMarkupParser()

        async def emit_items(items) -> None:
            nonlocal full
            for item in items:
                kind = item.get("kind")
                if kind == "text":
                    text = item.get("text") or ""
                    if text:
                        full += text
                        await job.output.put(("delta", text))
                elif kind == "status":
                    await job.output.put(("ui_status", item["text"]))
                elif kind == "action":
                    await job.output.put((
                        "ui_action",
                        json.dumps(
                            {"icon": item["icon"], "text": item["text"]},
                            ensure_ascii=False,
                        ),
                    ))

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
                await emit_items(markup.finish())
                await self._finish(
                    job.message_id,
                    MessageStatus.cancelled,
                    content=full,
                    error="Остановлено пользователем",
                    usage=usage,
                )
                await job.output.put(("cancelled", full))
                return None
            if kind == "thinking":
                # Keep provider-private reasoning internal; the client receives only
                # the explicit activity markers and the public answer stream.
                thinking += piece
            else:
                await emit_items(markup.feed(piece))
        await emit_items(markup.finish())
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
                original_name = _normalise_generated_filename(item.get("name"))
                ext = Path(original_name).suffix
                dest = base / f"{fid}{ext}"
                try:
                    dest.write_bytes(data)
                except OSError:
                    continue
                kind = detect_kind(original_name, "")
                db.add(
                    File(
                        id=fid,
                        user_id=chat.user_id,
                        storage_path=str(dest),
                        original_name=original_name,
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
                        "name": original_name,
                        "kind": kind,
                        "size": len(data),
                    }
                )
            await db.commit()
        return out

    # --- web search (runs inside the worker, never blocks the UI) ----------

    async def _smart_search(
        self,
        job: Job,
        entry: EntryConfig,
        *,
        use_model_queries: bool = True,
    ) -> tuple[list[dict], str]:
        """Use model-written web/image queries, with bounded best-effort providers."""
        queries: list[str] = []
        image_query = ""
        answer = ""
        explicit_none = False
        if use_model_queries:
            search_messages = [
                {"role": "system", "content": SEARCH_QUERIES_SYSTEM},
                {"role": "user", "content": (job.search_query or "")[:1500]},
            ]
            try:
                # This auxiliary call is paid too. Skip query planning if it could
                # exceed the rolling budget; deterministic keyword search remains available.
                blocked = await self._budget_error(
                    job, _estimated_model_call_cost(entry, search_messages, max_tokens=160)
                )
                if blocked:
                    log.info("Skipping paid search query planning: %s", blocked)
                else:
                    answer = await complete_chat(
                        messages=search_messages,
                        base_url=entry.base_url,
                        api_key=entry.api_key,
                        model=entry.model,
                        temperature=0.0,
                        max_tokens=160,
                        timeout=min(entry.timeout or 60, 45),
                        disable_thinking=True,
                    )
                text = (answer or "").strip()
                explicit_none = text.casefold() == "none"
                for raw_line in text.splitlines():
                    line = re.sub(r"^[\s\-*\d.)]+", "", raw_line).strip()
                    line = line.replace("«", "").replace("»", "").strip().strip('"').strip("'").strip()
                    if not line or line.casefold() == "none":
                        continue
                    image_match = re.match(r"^(?:IMAGE|IMAGES|КАРТИНКИ|ИЗОБРАЖЕНИЯ)\s*:\s*(.+)$", line, re.I)
                    if image_match:
                        candidate = image_match.group(1).strip()
                        if 2 < len(candidate) <= 160:
                            image_query = candidate
                        continue
                    search_match = re.match(r"^(?:SEARCH|WEB|ПОИСК|ВЕБ)\s*:\s*(.+)$", line, re.I)
                    candidate = (search_match.group(1) if search_match else line).strip()
                    if 2 < len(candidate) <= 120:
                        queries.append(candidate)
            except Exception as e:  # noqa: BLE001 - search must never break a chat
                log.warning("Query generation failed: %s", type(e).__name__)

        if not queries and not image_query and not explicit_none:
            words = re.findall(
                r"[A-Za-zА-Яа-яЁё0-9]{3,}", (job.search_query or "").lower()
            )
            stop = {
                "какой", "какая", "какие", "сколько", "сейчас", "сегодня", "покажи",
                "расскажи", "найди", "поищи", "что", "как", "где", "когда", "почему",
                "мне", "нужно", "хочу", "можно", "есть", "это", "the", "and", "for",
                "про", "для", "или", "если", "тоже", "очень", "самый", "самая",
            }
            key = [word for word in words if word not in stop][:6]
            queries = [" ".join(key) if key else (job.search_query or "").strip()]
        # Always search the user's original wording as well as model-generated
        # query variants. This preserves explicit locations (for example, Kazan)
        # and reduces the risk that query planning silently substitutes another city.
        original_query = (job.search_query or "").strip()
        queries = list(dict.fromkeys(
            ([original_query] if original_query else [])
            + [query.strip() for query in queries if query.strip()]
        ))[:3]

        results: list[dict] = []
        seen: set[str] = set()
        for query in queries:
            try:
                for item in await web_search(query):
                    url = item.get("url") or ""
                    if url and url not in seen:
                        seen.add(url)
                        results.append(item)
            except Exception as e:  # noqa: BLE001
                log.warning("Web search failed for %r: %s", query[:60], type(e).__name__)

        image_results: list[dict] = []
        if image_query:
            try:
                image_results = await image_search(image_query, 4)
            except Exception as e:  # defensive: image search must never break the answer
                log.warning("Image search failed: %s", type(e).__name__)

        log.info(
            "Search queries=%s image_query=%s web_results=%d image_results=%d",
            queries, bool(image_query), len(results), len(image_results),
        )

        # The query-planning call is billable even if a provider returns no hits.
        if answer:
            try:
                async with SessionLocal() as db:
                    await record(
                        db,
                        user_id=job.user_id,
                        chat_id=job.chat_id,
                        message_id=job.message_id,
                        entry=entry,
                        action="search_queries",
                        tokens_in=est(SEARCH_QUERIES_SYSTEM) + est(job.search_query),
                        tokens_out=est(answer),
                    )
                    await db.commit()
            except Exception as e:  # noqa: BLE001
                log.warning("Search accounting failed: %s", type(e).__name__)

        # Keep visual results independent from text-page deduplication and limits.
        return results[:5] + image_results[:4], answer

    async def _prepare_history(
        self, job: Job, entry: EntryConfig
    ) -> tuple[list[dict], list[dict]]:
        """Search, fold the results into the prompt and return (history, sources)."""
        system_prompt = job.system_prompt
        # Specialized, repository-bundled skill files are loaded only for relevant requests.
        skill_context = prompts.skills_for(job.user_text)
        if skill_context:
            system_prompt = f"{system_prompt}\n\n{skill_context}"
        sources: list[dict] = []
        if job.web_search and job.search_query:
            await job.output.put(("stage", json.dumps({"stage": "search"})))
            # The Code Agent uses a locally extracted query so search does not
            # consume an extra model turn from its 2-3 request budget.
            sources, _ = await self._smart_search(
                job, entry, use_model_queries=job.mode != "code"
            )
            ctx = format_context(sources)
            if ctx:
                system_prompt = f"{system_prompt}\n\n{ctx}"
        history = prompts.with_system(job.history_messages, system_prompt)
        return history, sources

    # --- main generation ---------------------------------------------------

    async def _run_message(self, job: Job) -> None:
        blocked = await self._budget_error(job)
        if blocked:
            await self._finish(job.message_id, MessageStatus.failed, error=blocked)
            await job.output.put(("error", blocked))
            return

        try:
            mset_id, mset_name, entries = await self._resolve_entries(
                job.route_type, job.model_set_id
            )
        except ProviderError as e:
            await self._finish(job.message_id, MessageStatus.failed, error=str(e))
            await job.output.put(("error", str(e)))
            return

        await self._set_status(
            job.message_id, MessageStatus.processing, mset_id, mset_name
        )

        agent_on = bool(settings.agent_enabled) and job.execution_target != "device"
        code_mode = job.mode == "code"
        plan_steps = job.max_steps
        base_steps = plan_steps or (
            settings.code_agent_max_steps if code_mode else settings.agent_max_steps
        )
        if not agent_on or code_mode:
            # A Code Agent user message is one model generation, not an autonomous loop.
            max_steps = 1
        else:
            max_steps = max(1, int(base_steps))
        run_timeout = settings.code_agent_timeout if code_mode else settings.agent_timeout
        round_limit = 1 if code_mode else 2

        tried: set[str] = set()
        last_error = "Генерация не удалась"
        rounds = 0

        while rounds < round_limit:
            rounds += 1
            retryable_error = True
            # Code Agent must not trigger a second generation through provider fallback.
            entry_attempt_limit = 1 if code_mode else len(entries)
            while len(tried) < entry_attempt_limit:
                entry = await self._acquire_primary(job, entries, tried)
                if entry is None:
                    await self._finish(
                        job.message_id, MessageStatus.cancelled,
                        error="Остановлено пользователем",
                    )
                    await job.output.put(("cancelled", ""))
                    return
                try:
                    messages, sources = await self._prepare_history(job, entry)
                    answer = ""
                    thinking = ""
                    usage: dict | None = None
                    all_runs: list[dict] = []
                    for step in range(max_steps):
                        # Search and earlier agent calls may already have consumed
                        # the remaining budget, so check before every paid model turn.
                        blocked = await self._budget_error(
                            job, _estimated_model_call_cost(entry, messages)
                        )
                        if blocked:
                            if step == 0:
                                await self._finish(job.message_id, MessageStatus.failed, error=blocked)
                                await job.output.put(("error", blocked))
                                return
                            answer = blocked
                            usage = None
                            break
                        got = await self._stream_once(job, entry, messages)
                        if got is None:
                            return
                        full, thinking, usage = got
                        agent_blocks = extract_agent_blocks(full) if agent_on else []
                        if not agent_blocks:
                            answer = full if full.strip() else thinking
                            break
                        # This response is an additional paid agent turn. Bill it
                        # immediately so the next budget check sees the real spend.
                        await self._bill(job, entry, usage, f"agent_step_{step + 1}")
                        usage = None
                        for block_kind, block_payload in agent_blocks:
                            device_plan = None
                            if block_kind == "fileplan":
                                code, display_code, raw_plan = _fileplan_runner(block_payload)
                                # Bound local fallbacks and persisted metadata; the isolated
                                # server renderer remains authoritative for large plans.
                                if len(raw_plan.encode("utf-8")) <= 80_000:
                                    device_plan = raw_plan
                            else:
                                code = block_payload
                                display_code = code
                            start_payload = {"code": display_code, "kind": block_kind}
                            if device_plan is not None:
                                start_payload["device_plan"] = device_plan
                            await job.output.put(
                                ("tool_start", json.dumps(start_payload, ensure_ascii=False))
                            )
                            result = await run_python(
                                code, timeout=run_timeout, project=job.project
                            )
                            attached = await self._attach_run_files(job, result)
                            run = {
                                "code": display_code,
                                "kind": block_kind,
                                "ok": bool(result.get("ok")),
                                "stdout": result.get("stdout", ""),
                                "stderr": result.get("stderr", ""),
                                "timed_out": bool(result.get("timed_out")),
                                "files": attached,
                            }
                            if device_plan is not None:
                                run["device_plan"] = device_plan
                            await job.output.put(("tool", json.dumps(run, ensure_ascii=False)))
                            all_runs.append(run)
                            messages = [
                                *messages,
                                {"role": "assistant", "content": full},
                                {"role": "user", "content": _tool_feedback(run)},
                            ]
                            cleanup(result.get("workdir"))
                        answer = strip_agent_blocks(full)
                        if step + 1 < max_steps:
                            await job.output.put(("step", json.dumps({"n": step + 1})))

                    if extract_agent_blocks(answer):
                        answer = strip_agent_blocks(answer)
                    answer = strip_sandbox_paths(answer)
                    if not answer.strip() and code_mode and all_runs:
                        # A one-pass agent may return only a run block. Report the
                        # real result without requesting an extra model-generated summary.
                        summaries: list[str] = []
                        for run in all_runs:
                            success = bool(run.get("ok")) and not bool(run.get("timed_out"))
                            summaries.append(
                                "Код выполнен успешно." if success else "При выполнении кода произошла ошибка."
                            )
                            stdout = str(run.get("stdout") or "").strip()
                            stderr = str(run.get("stderr") or "").strip()
                            if stdout:
                                summaries.append("Вывод:\n" + stdout[:4000])
                            if stderr:
                                summaries.append("Ошибка:\n" + stderr[:4000])
                            files = [
                                str(file.get("name") or "").strip()
                                for file in (run.get("files") or [])
                                if isinstance(file, dict) and str(file.get("name") or "").strip()
                            ]
                            if files:
                                summaries.append("Созданные файлы: " + ", ".join(files[:30]))
                        answer = "\n\n".join(summaries).strip()
                    if not answer.strip():
                        raise ProviderError("Пустой ответ модели")

                    # pull [[memory: ...]] commands out of the visible answer
                    answer, memories = extract_memories(answer)
                    answer, ask = extract_ask(answer)
                    answer = strip_cot(answer)
                    if not ask and len(answer) <= 500:
                        tail = answer.strip().split("\n")[-1].strip()
                        if tail.endswith("?") and 12 < len(tail) < 260:
                            ask = [{"question": tail[:500], "options": []}]
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
                            ("memory", json.dumps(
                                [v for _, v in memories], ensure_ascii=False
                            ))
                        )

                    await self._bill(job, entry, usage, "main")
                    await self._finish(
                        job.message_id,
                        MessageStatus.completed,
                        content=answer,
                        error=None,
                        usage=usage,
                        tool_runs=all_runs or None,
                        sources=sources,
                    )
                    if ask:
                        await job.output.put(
                            ("ask", json.dumps({"questions": ask}, ensure_ascii=False))
                        )
                    if job.first_exchange and code_mode:
                        # The Code Agent already has a 2-3 turn budget. Make a useful
                        # title locally so title generation does not add a fourth model call.
                        try:
                            async with SessionLocal() as db:
                                chat = await db.get(Chat, job.chat_id)
                                if chat is not None and (chat.title or "") in ("", "Новый чат"):
                                    chat.title = _local_code_chat_title(job.user_text)
                                    await db.commit()
                        except Exception as title_error:
                            log.warning("Local Code Agent title update failed: %s", title_error)
                    await job.output.put(("done", answer))
                    # Normal chats keep model-generated titles. The Code Agent uses
                    # a deterministic local title to avoid an extra provider request.
                    if job.first_exchange and not code_mode:
                        await self.enqueue(
                            Job(
                                kind="followup",
                                route_type=RouteType.TITLE,
                                chat_id=job.chat_id,
                                message_id=job.message_id,
                                user_id=job.user_id,
                                model_set_id=job.model_set_id,
                                user_text=job.user_text,
                                history=[
                                    *job.history_messages,
                                    {"role": "assistant", "content": answer},
                                ],
                                first_exchange=True,
                            )
                        )
                    return
                except asyncio.CancelledError:
                    await self._finish(
                        job.message_id, MessageStatus.cancelled, error="Остановлено"
                    )
                    await job.output.put(("cancelled", ""))
                    return
                except ProviderError as e:
                    last_error = str(e)
                    retryable_error = not is_model_unavailable_error(e)
                    tried.add(entry.id)
                    log.warning("Model %s failed: %s", entry.label, e)
                except Exception as e:
                    last_error = f"{type(e).__name__}: {e}"
                    tried.add(entry.id)
                    log.warning("Model %s error: %s", entry.label, e)
                finally:
                    await pool.release(entry)

            # The same primary model failed once; retry it once without switching models.
            if not retryable_error or rounds >= round_limit or job.cancel.is_set():
                break
            log.warning("Retrying the primary model once: %s", last_error)
            tried.clear()
            await job.output.put(("step", json.dumps({"n": 0, "retry": True})))

        await self._finish(job.message_id, MessageStatus.failed, error=last_error)
        await job.output.put(("error", last_error))

    # --- chat title --------------------------------------------------------

    async def _run_followup(self, job: Job) -> None:
        """Generate the chat title after the first answer; never generate suggestions."""
        if job.first_exchange:
            await self._run_title(job)

    async def _run_title(self, job: Job) -> None:
        blocked = await self._budget_error(job)
        if blocked:
            log.info("Skipping title generation: %s", blocked)
            return
        try:
            _, _, entries = await self._resolve_entries(RouteType.TITLE)
        except ProviderError as e:
            log.warning("Title generation skipped: %s", e)
            return

        messages = [
            {"role": "system", "content": prompts.TITLE_SYSTEM},
            {"role": "user", "content": (job.user_text or "")[:2000]},
        ]
        tried: set[str] = set()
        while len(tried) < len(entries):
            entry = await pool.acquire(entries, tried)
            if entry is None:
                return
            try:
                blocked = await self._budget_error(
                    job, _estimated_model_call_cost(entry, messages, max_tokens=96)
                )
                if blocked:
                    log.info("Skipping title generation: %s", blocked)
                    return
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
                        await account(
                            db,
                            job.chat_id,
                            entry.model_set_id,
                            est(prompts.TITLE_SYSTEM) + est((job.user_text or "")[:2000]),
                            est(title),
                            entry=entry,
                            user_id=job.user_id,
                            message_id=job.message_id,
                            action="title",
                        )
                        await db.commit()
                    return
            except Exception as e:
                log.warning("Title entry %s failed: %s", entry.label, e)
                tried.add(entry.id)
            finally:
                await pool.release(entry)

    # --- council merge (kept for the beta endpoint) ------------------------

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

        job.history_messages = [
            {
                "role": "user",
                "content": prompts.COUNCIL_MERGE_TEMPLATE.format(
                    question=question, variants="\n\n".join(parts)
                ),
            }
        ]
        job.system_prompt = prompts.MAIN_SYSTEM
        job.web_search = False
        await job.output.put(("step", json.dumps({"n": 0, "variants": len(parts)})))
        await self._run_message(job)


SEARCH_QUERIES_SYSTEM = """
Ты решаешь, нужен ли внешний веб-поиск по сообщению пользователя, и составляешь поисковые запросы.
Верни от 1 до 3 коротких строк SEARCH: запрос, если нужны веб-страницы. Отдельно добавь не более
одной строки IMAGE: запрос, когда реальные картинки могут заметно помочь ответу. Не считай IMAGE
редкой опцией: предпочитай его, когда визуальные примеры естественно дополняют тему, даже если
пользователь не попросил их напрямую.

Выбирай IMAGE, если пользователь просит показать/найти фотографии, иллюстрации или примеры либо
спрашивает о реальном человеке/публичной персоне, животном, городе, достопримечательности, месте
для путешествия, архитектуре, произведении искусства, растении, товаре/предмете, историческом
событии или видимом внешнем виде/дизайне. Изображения также полезны в наглядных объяснениях и
сравнениях. Запрос IMAGE должен чётко описывать нужные изображения; поиск выполняется в интернете,
а найденные изображения показываются отдельными карточками с источниками.

Не добавляй IMAGE к каждому сообщению: пропускай его для коротких бытовых фактов, простых вычислений,
обычных задач программирования и абстрактных вопросов, где реальное изображение ничего не прояснит.
Не выдумывай результаты, URL или описание картинки. Если нужен только визуальный поиск, верни только
IMAGE: запрос. Если веб-страницы и изображения одинаково полезны, верни строки SEARCH: запрос и
IMAGE: запрос. Если внешний поиск вообще не нужен, верни ровно NONE. Без нумерации и пояснений.
"""


router = AIRouter(settings.global_ai_concurrency)

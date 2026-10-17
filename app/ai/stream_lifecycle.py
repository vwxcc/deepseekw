"""Lifecycle helpers for consuming detached server-sent-event streams."""
from __future__ import annotations

import asyncio
from typing import Any

_TERMINAL_KINDS = frozenset({"done", "error", "cancelled"})
_DETACHED_DRAINS: set[asyncio.Task[None]] = set()


async def drain_output_until_terminal(output: asyncio.Queue) -> None:
    """Discard queued stream events until the worker reports a terminal event.

    The message worker owns persistence; an HTTP client disconnect only removes
    the browser consumer. Keeping the queue drained avoids retaining every token
    event in memory while the model finishes the answer.
    """
    while True:
        item: Any = await output.get()
        if not isinstance(item, tuple) or not item:
            continue
        if item[0] in _TERMINAL_KINDS:
            return


def detach_output_drain(output: asyncio.Queue) -> asyncio.Task[None]:
    """Start and strongly retain a queue drain task after the SSE client leaves."""
    task = asyncio.create_task(drain_output_until_terminal(output))
    _DETACHED_DRAINS.add(task)
    task.add_done_callback(_DETACHED_DRAINS.discard)
    return task

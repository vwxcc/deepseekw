"""Parse short, user-facing activity markers out of streamed model text.

Markers are presentation metadata, never part of the answer saved to chat:
    [[AICH_STATUS: Preparing the outline]]
    [[AICH_ACTION: book|1. Reading the supplied book]]
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_MARKER_START = re.compile(r"\[\[AICH_(STATUS|ACTION):")
_PREFIX = "[[AICH_"
_MAX_MARKER_CHARS = 1200
_MAX_LABEL_CHARS = 240

ACTIVITY_ICONS = frozenset(
    {
        "book", "book-open", "bookmark", "file-text", "file-search", "file-code",
        "presentation", "code", "calculator", "ruler", "pencil-ruler", "layers",
        "database", "list-checks", "compass", "lightbulb", "check-circle", "chart-line",
        "pie-chart", "image", "palette", "map", "calendar", "clock", "shield-check",
        "package", "network", "microscope", "flask", "graduation-cap", "target",
        "workflow", "upload", "wrench", "scan", "table", "type", "eye", "puzzle",
        "notebook", "arrow-right", "search-code", "list-todo", "pen-tool", "brain",
        "sparkle", "globe", "terminal", "folder", "link", "file", "chart", "sheet",
        "slides", "search", "check", "refresh", "lock", "user", "settings",
    }
)


@dataclass
class ActivityMarkupParser:
    """Incremental parser safe for arbitrary network/token chunk boundaries."""

    buffer: str = ""
    max_label_chars: int = _MAX_LABEL_CHARS
    _closed: bool = field(default=False, init=False)

    @staticmethod
    def _clean_label(value: str) -> str:
        return re.sub(r"\s+", " ", value or "").strip()[:_MAX_LABEL_CHARS]

    @staticmethod
    def _possible_prefix_suffix(value: str) -> int:
        max_len = min(len(value), len(_PREFIX) - 1)
        for size in range(max_len, 0, -1):
            if _PREFIX.startswith(value[-size:]):
                return size
        return 0

    def _parse_marker(self, marker: str) -> dict[str, Any] | None:
        match = re.match(r"\[\[AICH_(STATUS|ACTION):\s*([\s\S]*?)\]\]$", marker)
        if not match:
            return None
        kind, payload = match.groups()
        if kind == "STATUS":
            text = self._clean_label(payload)
            return {"kind": "status", "text": text} if text else None
        icon, separator, label = payload.partition("|")
        icon = icon.strip().lower()
        text = self._clean_label(label if separator else "")
        if not text:
            return None
        if icon not in ACTIVITY_ICONS:
            icon = "sparkle"
        return {"kind": "action", "icon": icon, "text": text}

    def feed(self, chunk: str) -> list[dict[str, Any]]:
        """Accept one streamed text chunk and emit clean text/activity events."""
        if self._closed or not chunk:
            return []
        self.buffer += str(chunk)
        out: list[dict[str, Any]] = []
        while self.buffer:
            marker_start = _MARKER_START.search(self.buffer)
            if marker_start is None:
                keep = self._possible_prefix_suffix(self.buffer)
                safe_end = len(self.buffer) - keep
                if safe_end:
                    out.append({"kind": "text", "text": self.buffer[:safe_end]})
                    self.buffer = self.buffer[safe_end:]
                break

            if marker_start.start():
                out.append({"kind": "text", "text": self.buffer[:marker_start.start()]})
                self.buffer = self.buffer[marker_start.start():]

            closing = self.buffer.find("]]", len("[[AICH_STATUS:"))
            # ACTION marker has the same prefix length as STATUS.
            if closing < 0:
                if len(self.buffer) > _MAX_MARKER_CHARS:
                    # Malformed/oversized marker: treat the prefix as regular text
                    # rather than silently deleting a large part of a real answer.
                    out.append({"kind": "text", "text": self.buffer[:len("[[AICH_")]})
                    self.buffer = self.buffer[len("[[AICH_"):]
                    continue
                break

            marker = self.buffer[:closing + 2]
            parsed = self._parse_marker(marker)
            if parsed is None:
                out.append({"kind": "text", "text": marker})
            else:
                out.append(parsed)
            self.buffer = self.buffer[closing + 2:]

        return [item for item in out if item.get("text") or item.get("kind") == "action"]

    def finish(self) -> list[dict[str, Any]]:
        """Flush ordinary trailing text; never leak a partial control marker."""
        if self._closed:
            return []
        self._closed = True
        remaining, self.buffer = self.buffer, ""
        if not remaining:
            return []
        if _MARKER_START.match(remaining):
            return []
        # Preserve an unfinished prefix such as '[[' only if it wasn't a marker
        # prefix. A partial marker is control syntax and must not leak to the user.
        if remaining.startswith(_PREFIX):
            return []
        return [{"kind": "text", "text": remaining}]

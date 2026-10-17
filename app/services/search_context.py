from __future__ import annotations


def _search_context(history_messages: list[dict], current_text: str) -> str:
    """Add recent chat context while keeping the newest user request first."""
    parts: list[str] = []
    latest = (current_text or "").strip()
    if latest:
        parts.append("Последний запрос пользователя: " + latest[:1100])
    count = 0
    for item in reversed(history_messages or []):
        role = str(item.get("role") or "").lower()
        content = str(item.get("content") or "").strip()
        if not content or role not in {"user", "assistant"}:
            continue
        if role == "user" and latest and content.strip() == latest:
            continue
        parts.append(
            ("Пользователь" if role == "user" else "Ассистент") + ": " + content[:650]
        )
        count += 1
        if count >= 5:
            break
    return "\n".join(parts)[:3500]

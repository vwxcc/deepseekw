from __future__ import annotations

import re


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

def _plan_search_queries(answer: str | None, search_query: str | None) -> list[str]:
    """Parse model-planned queries, respecting NONE and using a bounded keyword fallback."""
    text = (answer or "").strip()
    if re.fullmatch(r"NONE", text, flags=re.IGNORECASE):
        return []

    queries: list[str] = []
    if text:
        for line in text.splitlines():
            query = re.sub(r"^[\s\-*\d.)]+", "", line).strip()
            query = query.replace("\u00ab", "").replace("\u00bb", "")
            query = query.strip('"').strip("'").strip()
            if 2 < len(query) <= 120:
                queries.append(query)
        if queries:
            return queries[:3]

    source = (search_query or "").strip()
    if not source:
        return []
    words = re.findall(r"[A-Za-zА-Яа-яЁё0-9]{3,}", source.lower())
    stopwords = {
        "какой", "какая", "какие", "сколько", "сейчас", "сегодня", "покажи",
        "расскажи", "найди", "поищи", "что", "как", "где", "когда", "почему",
        "мне", "нужно", "хочу", "можно", "есть", "это", "the", "and", "for",
        "про", "для", "или", "если", "тоже", "очень", "самый", "самая",
        "последний", "запрос", "пользователя", "пользователь", "ассистент",
        "контекст", "реплик", "предыдущих", "предыдущий",
    }
    keywords = [word for word in words if word not in stopwords][:6]
    return [" ".join(keywords)] if keywords else [source[:120]]

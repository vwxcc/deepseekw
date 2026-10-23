"""Safe, allow-listed external service connectors used by AI CH."""
from __future__ import annotations

import base64
import re
from urllib.parse import quote

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import ConnectorConnection, User

CONNECTOR_CATALOG = [
    {"provider": "github", "title": "GitHub", "description": "Репозитории, файлы и issues; чтение и изменение файлов по запросу.", "actions": ["list_repositories", "search_repositories", "read_file", "update_file", "create_issue"]},
    {"provider": "youtube", "title": "YouTube", "description": "Поиск видео и каналов через YouTube Data API.", "actions": ["search_videos"]},
    {"provider": "spotify", "title": "Spotify", "description": "Поиск музыки, альбомов и исполнителей.", "actions": ["search_tracks", "search_artists"]},
    {"provider": "gitlab", "title": "GitLab", "description": "Поиск публичных и доступных проектов.", "actions": ["search_projects", "read_file"]},
    {"provider": "notion", "title": "Notion", "description": "Поиск страниц в рабочем пространстве.", "actions": ["search_pages"]},
    {"provider": "slack", "title": "Slack", "description": "Поиск сообщений в доступных каналах.", "actions": ["search_messages"]},
    {"provider": "google_drive", "title": "Google Drive", "description": "Поиск файлов на Google Drive.", "actions": ["search_files"]},
    {"provider": "linear", "title": "Linear", "description": "Поиск задач и issues.", "actions": ["search_issues"]},
    {"provider": "huggingface", "title": "Hugging Face", "description": "Поиск моделей и датасетов.", "actions": ["search_models", "search_datasets"]},
    {"provider": "discord", "title": "Discord", "description": "Просмотр серверов, к которым у бота есть доступ.", "actions": ["list_guilds"]},
]
_CATALOG = {item["provider"]: item for item in CONNECTOR_CATALOG}
_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")


async def connection_state(db: AsyncSession, user_id: str) -> dict[str, bool]:
    user = await db.get(User, user_id)
    result = await db.execute(select(ConnectorConnection).where(ConnectorConnection.user_id == user_id))
    rows = {row.provider: bool(row.token.strip()) for row in result.scalars().all()}
    rows["github"] = bool(user and user.github_token and user.github_token.strip())
    return {provider: rows.get(provider, False) for provider in _CATALOG}


async def list_connector_cards(db: AsyncSession, user: User, action_limit: int) -> dict:
    states = await connection_state(db, user.id)
    return {
        "plan": "pro" if user.is_admin else (user.plan if user.plan == "pro" else "free"),
        "action_limit": max(1, int(action_limit)),
        "catalog": [
            {**item, "connected": states.get(item["provider"], False)}
            for item in CONNECTOR_CATALOG
        ],
    }


async def save_connection(db: AsyncSession, user: User, provider: str, token: str) -> None:
    if provider not in _CATALOG:
        raise ValueError("Неизвестный коннектор")
    token = str(token or "").strip()
    if not token or len(token) > 4096:
        raise ValueError("Укажите токен/API-ключ длиной не более 4096 символов")
    if provider == "github":
        # Verify a GitHub credential and store the verified login instead of trusting browser input.
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
            response = await client.get(
                "https://api.github.com/user",
                headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
            )
        if response.status_code != 200:
            raise ValueError("GitHub не принял токен. Проверьте его и нужные права доступа.")
        user.github_token = token[:255]
        user.github_user = str(response.json().get("login") or "")[:120] or None
        await db.commit()
        return
    row = (await db.execute(
        select(ConnectorConnection).where(
            ConnectorConnection.user_id == user.id,
            ConnectorConnection.provider == provider,
        )
    )).scalars().first()
    if row is None:
        row = ConnectorConnection(user_id=user.id, provider=provider, token=token)
        db.add(row)
    else:
        row.token = token
    await db.commit()


async def delete_connection(db: AsyncSession, user: User, provider: str) -> None:
    if provider not in _CATALOG:
        raise ValueError("Неизвестный коннектор")
    if provider == "github":
        user.github_token = None
        user.github_user = None
    else:
        row = (await db.execute(
            select(ConnectorConnection).where(
                ConnectorConnection.user_id == user.id,
                ConnectorConnection.provider == provider,
            )
        )).scalars().first()
        if row is not None:
            await db.delete(row)
    await db.commit()


async def _get_token(db: AsyncSession, user_id: str, provider: str) -> str:
    if provider == "github":
        user = await db.get(User, user_id)
        token = str(user.github_token or "").strip() if user else ""
    else:
        row = (await db.execute(
            select(ConnectorConnection).where(
                ConnectorConnection.user_id == user_id,
                ConnectorConnection.provider == provider,
            )
        )).scalars().first()
        token = str(row.token or "").strip() if row else ""
    if not token:
        raise ValueError(f"Коннектор {provider} не подключён. Откройте «+ → Коннекторы» и добавьте API-токен.")
    return token


def _query(payload: dict) -> str:
    value = str(payload.get("query") or payload.get("q") or "").strip()
    if not value:
        raise ValueError("Для поиска нужно передать поле query")
    return value[:500]


async def execute_connector_action(
    db: AsyncSession,
    user_id: str,
    provider: str,
    action: str,
    payload: dict | None = None,
) -> dict:
    """Execute one catalogued operation against fixed HTTPS provider endpoints only."""
    data = payload if isinstance(payload, dict) else {}
    provider = str(provider or "").strip().lower()
    action = str(action or "").strip().lower()
    if provider not in _CATALOG or action not in _CATALOG[provider]["actions"]:
        raise ValueError("Эта команда не входит в список разрешённых действий коннектора")
    token = await _get_token(db, user_id, provider)
    query = str(data.get("query") or data.get("q") or "").strip()[:500]
    headers = {"Accept": "application/json", "User-Agent": "AI-CH-Connector/1.0"}
    url = ""
    params: dict = {}
    body: dict | None = None
    method = "GET"

    if provider == "github":
        headers.update({"Authorization": f"Bearer {token}", "X-GitHub-Api-Version": "2022-11-28", "Accept": "application/vnd.github+json"})
        if action == "list_repositories":
            url = "https://api.github.com/user/repos"
            params = {"per_page": 10, "sort": "updated"}
        elif action == "search_repositories":
            url = "https://api.github.com/search/repositories"
            params = {"q": _query(data), "per_page": 7, "sort": "updated"}
        elif action in {"read_file", "update_file"}:
            repo = str(data.get("repo") or "").strip()
            path = str(data.get("path") or "").strip().lstrip("/")
            if not _REPO_RE.fullmatch(repo) or not path or any(part == ".." for part in path.split("/")):
                raise ValueError("Для файла GitHub нужны корректные repo (owner/name) и path")
            url = "https://api.github.com/repos/" + repo + "/contents/" + quote(path, safe="/")
            branch = str(data.get("branch") or "").strip()
            if action == "read_file":
                if branch:
                    params["ref"] = branch[:200]
            else:
                content = data.get("content")
                if not isinstance(content, str):
                    raise ValueError("Для update_file нужно текстовое поле content")
                sha = str(data.get("sha") or "").strip()
                if sha:
                    body = {"sha": sha[:100]}
                else:
                    # Avoid overwriting an existing file when the model skipped the read step.
                    probe = await execute_connector_action(db, user_id, "github", "read_file", {"repo": repo, "path": path, "branch": branch})
                    if probe.get("ok") and probe.get("sha"):
                        raise ValueError("Файл уже существует. Сначала прочитайте его, а затем передайте sha из результата в update_file.")
                    body = {}
                body.update({
                    "message": str(data.get("message") or "Update from AI CH")[:200],
                    "content": base64.b64encode(content.encode("utf-8")).decode("ascii"),
                })
                if branch:
                    body["branch"] = branch[:200]
                method = "PUT"
        elif action == "create_issue":
            repo = str(data.get("repo") or "").strip()
            if not _REPO_RE.fullmatch(repo):
                raise ValueError("Для issue нужен repo в формате owner/name")
            title = str(data.get("title") or "").strip()
            if not title:
                raise ValueError("Для issue нужно поле title")
            url = "https://api.github.com/repos/" + repo + "/issues"
            method = "POST"
            body = {"title": title[:250], "body": str(data.get("body") or "")[:10000]}
    elif provider == "youtube":
        if action != "search_videos":
            raise ValueError("Неизвестное действие YouTube")
        url = "https://www.googleapis.com/youtube/v3/search"
        params = {"part": "snippet", "type": "video", "maxResults": 5, "q": _query(data), "key": token}
    elif provider == "spotify":
        headers["Authorization"] = f"Bearer {token}"
        if action in {"search_tracks", "search_artists"}:
            kind = "track" if action == "search_tracks" else "artist"
            url = "https://api.spotify.com/v1/search"
            params = {"type": kind, "limit": 5, "q": _query(data)}
        else:
            raise ValueError("Неизвестное действие Spotify")
    elif provider == "gitlab":
        headers["PRIVATE-TOKEN"] = token
        if action == "search_projects":
            url = "https://gitlab.com/api/v4/projects"
            params = {"search": _query(data), "simple": "true", "per_page": 7, "order_by": "last_activity_at"}
        elif action == "read_file":
            project = str(data.get("project_id") or data.get("repo") or "").strip()
            path = str(data.get("path") or "").strip().lstrip("/")
            if not project or not path or any(part == ".." for part in path.split("/")):
                raise ValueError("Для GitLab нужны project_id/repo и path")
            url = f"https://gitlab.com/api/v4/projects/{quote(project, safe='')}/repository/files/{quote(path, safe='')}"
            params = {"ref": str(data.get("branch") or "main")[:200]}
        else:
            raise ValueError("Неизвестное действие GitLab")
    elif provider == "notion":
        headers.update({"Authorization": f"Bearer {token}", "Notion-Version": "2022-06-28"})
        url = "https://api.notion.com/v1/search"
        method = "POST"
        body = {"query": _query(data), "page_size": 7}
    elif provider == "slack":
        headers["Authorization"] = f"Bearer {token}"
        url = "https://slack.com/api/search.messages"
        params = {"query": _query(data), "count": 7, "sort": "timestamp", "sort_dir": "desc"}
    elif provider == "google_drive":
        headers["Authorization"] = f"Bearer {token}"
        url = "https://www.googleapis.com/drive/v3/files"
        q = _query(data).replace("\\", "\\\\").replace("'", "\\'")
        params = {"q": f"name contains '{q}' or fullText contains '{q}'", "fields": "files(id,name,mimeType,webViewLink,modifiedTime)", "pageSize": 7, "orderBy": "modifiedTime desc"}
    elif provider == "linear":
        headers["Authorization"] = token
        url = "https://api.linear.app/graphql"
        method = "POST"
        escaped = _query(data).replace("\\", "\\\\").replace('"', '\\"')
        body = {"query": 'query { issues(filter: { searchableContent: { containsIgnoreCase: "' + escaped + '" } }) { nodes { id identifier title url state { name } } } }'}
    elif provider == "huggingface":
        if token:
            headers["Authorization"] = f"Bearer {token}"
        if action == "search_models":
            url = "https://huggingface.co/api/models"
        elif action == "search_datasets":
            url = "https://huggingface.co/api/datasets"
        else:
            raise ValueError("Неизвестное действие Hugging Face")
        params = {"search": _query(data), "limit": 7}
    elif provider == "discord":
        headers["Authorization"] = f"Bot {token}"
        url = "https://discord.com/api/v10/users/@me/guilds"
        params = {"limit": 10}

    try:
        async with httpx.AsyncClient(timeout=18.0, follow_redirects=False) as client:
            response = await client.request(method, url, headers=headers, params=params, json=body)
    except httpx.TimeoutException:
        return {"ok": False, "error": "Сервис не ответил вовремя."}
    except httpx.HTTPError:
        return {"ok": False, "error": "Не удалось установить соединение с сервисом."}

    if response.status_code >= 400:
        try:
            error_payload = response.json()
            message = error_payload.get("message") or error_payload.get("error_description") or error_payload.get("error") or ""
        except Exception:
            message = ""
        if response.status_code in (401, 403):
            return {"ok": False, "error": f"Сервис отклонил токен или требуемые права доступа (HTTP {response.status_code})."}
        return {"ok": False, "error": f"Запрос к сервису завершился с HTTP {response.status_code}" + (f": {str(message)[:240]}" if message else "")}

    try:
        result = response.json()
    except ValueError:
        return {"ok": False, "error": "Сервис вернул не JSON-ответ."}

    if provider == "github":
        if action == "read_file":
            encoded = result.get("content") or ""
            try:
                decoded = base64.b64decode(encoded).decode("utf-8", "replace")
            except Exception:
                decoded = ""
            return {"ok": True, "provider": provider, "action": action, "repo": data.get("repo"), "path": data.get("path"), "sha": result.get("sha"), "content": decoded[:12000], "url": result.get("html_url")}
        if action == "update_file":
            return {"ok": True, "provider": provider, "action": action, "message": "Файл обновлён или создан.", "sha": (result.get("content") or {}).get("sha"), "url": (result.get("content") or {}).get("html_url"), "commit": ((result.get("commit") or {}).get("html_url"))}
        if action == "create_issue":
            return {"ok": True, "provider": provider, "action": action, "number": result.get("number"), "title": result.get("title"), "url": result.get("html_url")}
        if action == "search_repositories":
            items = result.get("items") or []
        else:
            items = result if isinstance(result, list) else []
        return {"ok": True, "provider": provider, "action": action, "items": [{"name": i.get("full_name") or i.get("name") or "", "description": (i.get("description") or "")[:300], "url": i.get("html_url") or i.get("url") or "", "default_branch": i.get("default_branch")} for i in items[:10]]}
    if provider == "youtube":
        items = result.get("items") or []
        return {"ok": True, "provider": provider, "action": action, "items": [{"title": (i.get("snippet") or {}).get("title", ""), "channel": (i.get("snippet") or {}).get("channelTitle", ""), "url": "https://www.youtube.com/watch?v=" + str((i.get("id") or {}).get("videoId") or "")} for i in items[:7]]}
    if provider == "spotify":
        key = "tracks" if action == "search_tracks" else "artists"
        items = ((result.get(key) or {}).get("items") or [])
        normalized = []
        for item in items[:7]:
            artists = ", ".join(x.get("name", "") for x in item.get("artists", []) if isinstance(x, dict))
            normalized.append({"name": item.get("name", ""), "artists": artists, "url": (item.get("external_urls") or {}).get("spotify", ""), "album": (item.get("album") or {}).get("name", "")})
        return {"ok": True, "provider": provider, "action": action, "items": normalized}
    if provider == "gitlab":
        if action == "read_file":
            raw = result.get("content") or ""
            try: decoded = base64.b64decode(raw).decode("utf-8", "replace")
            except Exception: decoded = ""
            return {"ok": True, "provider": provider, "action": action, "content": decoded[:12000], "file_name": result.get("file_name"), "last_commit_id": result.get("last_commit_id")}
        items = result if isinstance(result, list) else []
        return {"ok": True, "provider": provider, "action": action, "items": [{"name": i.get("path_with_namespace") or i.get("name"), "description": (i.get("description") or "")[:300], "url": i.get("web_url", "")} for i in items[:7]]}
    if provider == "notion":
        return {"ok": True, "provider": provider, "action": action, "items": [{"id": i.get("id"), "title": _notion_title(i), "url": i.get("url", "")} for i in (result.get("results") or [])[:7]]}
    if provider == "slack":
        if result.get("ok") is False:
            return {"ok": False, "error": "Slack отклонил запрос: " + str(result.get("error") or "unknown_error")[:200]}
        matches = ((result.get("messages") or {}).get("matches") or [])
        return {"ok": True, "provider": provider, "action": action, "items": [{"text": (i.get("text") or "")[:600], "user": i.get("user_name") or i.get("username") or "", "channel": (i.get("channel") or {}).get("name", ""), "url": i.get("permalink", "")} for i in matches[:7]]}
    if provider == "google_drive":
        return {"ok": True, "provider": provider, "action": action, "items": [{"name": i.get("name"), "mime_type": i.get("mimeType"), "url": i.get("webViewLink"), "id": i.get("id"), "modified": i.get("modifiedTime")} for i in (result.get("files") or [])[:7]]}
    if provider == "linear":
        issues = ((result.get("data") or {}).get("issues") or {}).get("nodes") or []
        return {"ok": True, "provider": provider, "action": action, "items": [{"identifier": i.get("identifier"), "title": i.get("title"), "url": i.get("url"), "state": (i.get("state") or {}).get("name")} for i in issues[:7]]}
    if provider == "huggingface":
        items = result if isinstance(result, list) else []
        return {"ok": True, "provider": provider, "action": action, "items": [{"id": i.get("id") or i.get("modelId"), "url": "https://huggingface.co/" + str(i.get("id") or i.get("modelId") or ""), "downloads": i.get("downloads")} for i in items[:7]]}
    if provider == "discord":
        items = result if isinstance(result, list) else []
        return {"ok": True, "provider": provider, "action": action, "items": [{"name": i.get("name"), "id": i.get("id")} for i in items[:10]]}
    return {"ok": True, "provider": provider, "action": action, "result": _safe_result(result)}


def _notion_title(item: dict) -> str:
    props = item.get("properties") or {}
    for prop in props.values():
        if isinstance(prop, dict) and prop.get("type") == "title":
            return "".join(str(part.get("plain_text") or "") for part in (prop.get("title") or []))[:300]
    return str(item.get("title") or "")[:300]


def _safe_result(value, depth: int = 0):
    if depth > 4:
        return "[nested]"
    if isinstance(value, dict):
        return {str(k)[:80]: _safe_result(v, depth + 1) for k, v in list(value.items())[:40] if str(k).lower() not in {"token", "access_token", "refresh_token", "api_key", "client_secret", "authorization"}}
    if isinstance(value, list):
        return [_safe_result(item, depth + 1) for item in value[:10]]
    if isinstance(value, str):
        return value[:2000]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return str(value)[:500]

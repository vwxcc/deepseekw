"""OpenAI-compatible provider client (chat completions, stream + non-stream).

Handles reasoning models: some vLLM deployments put the answer into
``message.reasoning`` while ``content`` stays null. Thinking can be disabled
per request via ``chat_template_kwargs`` (Qwen/vLLM) which keeps short tasks
(titles, suggestions) fast and clean.
"""
from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx


class ProviderError(Exception):
    pass


def _endpoint(base_url: str) -> str:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        raise ProviderError("Не задан base_url провайдера")
    if base.endswith("/v1"):
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


def _headers(api_key: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _payload(
    *,
    messages: list[dict],
    model: str,
    temperature: float,
    max_tokens: int,
    stream: bool,
    disable_thinking: bool,
) -> dict:
    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
    }
    if disable_thinking:
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    return payload


def _extract_text(message: dict) -> str:
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content
    reasoning = message.get("reasoning")
    if isinstance(reasoning, str) and reasoning.strip():
        return reasoning
    return ""


async def stream_chat(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str,
    model: str,
    temperature: float,
    max_tokens: int,
    timeout: float,
    disable_thinking: bool = True,
) -> AsyncIterator[str]:
    """Yield answer chunks. Falls back to reasoning if no content is produced."""
    url = _endpoint(base_url)
    payload = _payload(
        messages=messages,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
        disable_thinking=disable_thinking,
    )
    content_seen = False
    reasoning_parts: list[str] = []

    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            "POST", url, json=payload, headers=_headers(api_key)
        ) as resp:
            if resp.status_code >= 400:
                body = (await resp.aread()).decode(errors="replace")
                raise ProviderError(f"HTTP {resp.status_code}: {body[:400]}")
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                rpiece = delta.get("reasoning")
                if isinstance(rpiece, str) and rpiece:
                    reasoning_parts.append(rpiece)
                piece = delta.get("content")
                if isinstance(piece, str) and piece:
                    content_seen = True
                    yield piece

    if not content_seen and reasoning_parts:
        yield "".join(reasoning_parts)


async def complete_chat(
    *,
    messages: list[dict],
    base_url: str,
    api_key: str,
    model: str,
    temperature: float,
    max_tokens: int,
    timeout: float,
    disable_thinking: bool = True,
) -> str:
    url = _endpoint(base_url)
    payload = _payload(
        messages=messages,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=False,
        disable_thinking=disable_thinking,
    )
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload, headers=_headers(api_key))
        if resp.status_code >= 400:
            raise ProviderError(f"HTTP {resp.status_code}: {resp.text[:400]}")
        data = resp.json()
        choices = data.get("choices") or []
        if not choices:
            raise ProviderError("Провайдер вернул пустой ответ")
        return _extract_text(choices[0].get("message") or {}).strip()

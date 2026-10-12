"""OpenAI-compatible provider client (chat completions, stream + non-stream).

Handles reasoning models: some vLLM deployments put the answer into
``message.reasoning`` while ``content`` stays null. Thinking can be controlled
via ``chat_template_kwargs`` (Qwen/vLLM) and/or ``reasoning_effort``.
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


def _build_payload(
    *,
    messages: list[dict],
    model: str,
    temperature: float,
    max_tokens: int,
    stream: bool,
    disable_thinking: bool,
    effort: str | None = None,
) -> dict:
    payload: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
    }
    if stream:
        payload["stream_options"] = {"include_usage": True}

    e = (effort or "").lower()
    if e in ("none", "off"):
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    elif e and e not in ("recommended", "default", "auto"):
        # low / medium / high / extra / max (backend falls back if unsupported)
        payload["reasoning_effort"] = e
    elif disable_thinking:
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


async def _stream_once(
    url: str, payload: dict, api_key: str, timeout: float
) -> AsyncIterator[tuple[str, str]]:
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
                usage = obj.get("usage")
                if isinstance(usage, dict) and usage:
                    yield ("usage", json.dumps(usage))
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                rpiece = delta.get("reasoning")
                if isinstance(rpiece, str) and rpiece:
                    yield ("thinking", rpiece)
                piece = delta.get("content")
                if isinstance(piece, str) and piece:
                    yield ("content", piece)


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
    effort: str | None = None,
) -> AsyncIterator[tuple[str, str]]:
    """Yield ("thinking"|"content"|"usage", text) chunks."""
    url = _endpoint(base_url)
    payload = _build_payload(
        messages=messages, model=model, temperature=temperature, max_tokens=max_tokens,
        stream=True, disable_thinking=disable_thinking, effort=effort,
    )
    try:
        async for item in _stream_once(url, payload, api_key, timeout):
            yield item
    except ProviderError as e:
        # some backends reject reasoning_effort -> retry once without it
        if "reasoning_effort" in payload and "400" in str(e):
            payload.pop("reasoning_effort", None)
            payload["chat_template_kwargs"] = {"enable_thinking": True}
            async for item in _stream_once(url, payload, api_key, timeout):
                yield item
        else:
            raise


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
    effort: str | None = None,
) -> str:
    url = _endpoint(base_url)
    payload = _build_payload(
        messages=messages, model=model, temperature=temperature, max_tokens=max_tokens,
        stream=False, disable_thinking=disable_thinking, effort=effort,
    )

    async def _once(pl: dict) -> str:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=pl, headers=_headers(api_key))
            if resp.status_code >= 400:
                raise ProviderError(f"HTTP {resp.status_code}: {resp.text[:400]}")
            data = resp.json()
            choices = data.get("choices") or []
            if not choices:
                raise ProviderError("Провайдер вернул пустой ответ")
            return _extract_text(choices[0].get("message") or {}).strip()

    try:
        return await _once(payload)
    except ProviderError as e:
        if "reasoning_effort" in payload and "400" in str(e):
            payload.pop("reasoning_effort", None)
            payload["chat_template_kwargs"] = {"enable_thinking": True}
            return await _once(payload)
        raise

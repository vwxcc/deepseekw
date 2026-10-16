"""OpenAI-compatible text-to-speech service with bounded input/output."""
from __future__ import annotations

import asyncio
import hashlib
import re
from pathlib import Path

import httpx

from ..config import settings


AUDIO_FORMATS = {"mp3", "opus", "aac", "flac", "wav", "pcm"}
AUDIO_MEDIA_TYPES = {
    "mp3": "audio/mpeg",
    "opus": "audio/ogg",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "pcm": "audio/pcm",
}
_MAX_AUDIO_BYTES = 40 * 1024 * 1024
_slots = asyncio.Semaphore(max(1, int(settings.tts_concurrency or 1)))


class TTSNotConfiguredError(RuntimeError):
    """Raised when the server is missing its TTS provider configuration."""


class TTSGenerationError(RuntimeError):
    """Raised when the configured TTS provider cannot return usable audio."""


def audio_file_path(user_id: str, message_id: str, fmt: str | None = None) -> Path:
    """Return a private, non-user-controlled path for a message's cached audio."""
    audio_format = normalized_audio_format(fmt)
    user_key = hashlib.sha256(str(user_id).encode("utf-8")).hexdigest()[:32]
    message_key = hashlib.sha256(str(message_id).encode("utf-8")).hexdigest()[:40]
    return settings.data_path / "audio" / user_key / (message_key + "." + audio_format)


def normalized_audio_format(value: str | None = None) -> str:
    fmt = (value or settings.tts_response_format or "mp3").strip().lower()
    if fmt not in AUDIO_FORMATS:
        raise ValueError("TTS_RESPONSE_FORMAT must be one of: " + ", ".join(sorted(AUDIO_FORMATS)))
    return fmt


def clean_tts_text(value: str, max_chars: int | None = None) -> str:
    """Remove UI/control markup before speech generation without exposing secrets."""
    text = str(value or "")
    text = re.sub(r"\[\[\s*ask\s*:[\s\S]*?\]\]", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"```[^\n`]*\n?[\s\S]*?```", " Фрагмент кода пропущен. ", text)
    text = re.sub(r"!?\[([^\]]+)\]\((?:https?://)[^)]+\)", r"\1", text)
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"(?m)^\s{0,3}#{1,6}\s*", "", text)
    text = re.sub(r"(?m)^\s*[-*+]\s+", "", text)
    text = text.replace("**", "").replace("__", "").replace("~~", "")
    text = re.sub(r"(?<!\w)[*_~`]|[*_~`](?!\w)", "", text)
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    limit = max(100, int(max_chars or settings.tts_max_chars or 30000))
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0].rstrip() + "…"
    return text


async def generate_speech(text: str) -> tuple[bytes, str]:
    """Generate audio via an OpenAI-compatible POST /audio/speech endpoint."""
    base_url = (settings.tts_base_url or "").strip().rstrip("/")
    api_key = (settings.tts_api_key or "").strip()
    if not base_url:
        raise TTSNotConfiguredError("Задайте TTS_BASE_URL в переменных окружения сервиса.")
    fmt = normalized_audio_format()
    cleaned = clean_tts_text(text)
    if not cleaned:
        raise ValueError("В ответе нет текста для озвучки.")

    endpoint = base_url if base_url.endswith("/audio/speech") else base_url + "/audio/speech"
    headers = {"Accept": AUDIO_MEDIA_TYPES[fmt]}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    payload = {
        "model": (settings.tts_model or "tts-1").strip(),
        "voice": (settings.tts_voice or "alloy").strip(),
        "input": cleaned,
        "response_format": fmt,
    }
    timeout = max(10, min(int(settings.tts_timeout or 180), 600))
    async with _slots:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=15)) as client:
                response = await client.post(endpoint, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise TTSGenerationError("Сервис озвучки не ответил вовремя.") from exc
        except httpx.HTTPError as exc:
            raise TTSGenerationError("Не удалось связаться с сервисом озвучки.") from exc

    if response.status_code < 200 or response.status_code >= 300:
        # Never return a provider response body: it might echo request data.
        raise TTSGenerationError(f"Сервис озвучки вернул HTTP {response.status_code}.")
    audio = response.content
    if not audio:
        raise TTSGenerationError("Сервис озвучки вернул пустой аудиофайл.")
    if len(audio) > _MAX_AUDIO_BYTES:
        raise TTSGenerationError("Аудиофайл превышает допустимый размер 40 МБ.")
    content_type = (response.headers.get("content-type") or "").lower()
    if "application/json" in content_type or "text/" in content_type:
        raise TTSGenerationError("Сервис озвучки вернул не аудиоданные.")
    return audio, fmt

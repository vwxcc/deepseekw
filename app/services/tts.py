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


def _provider_error_detail(response: httpx.Response) -> str:
    """Extract a short, safe provider error message without exposing credentials."""
    try:
        data = response.json()
    except (ValueError, TypeError):
        return ""
    if not isinstance(data, dict):
        return ""
    error = data.get("error")
    if isinstance(error, dict):
        detail = error.get("message") or error.get("detail") or error.get("type")
    elif isinstance(error, str):
        detail = error
    else:
        detail = data.get("message") or data.get("detail")
    if not isinstance(detail, str):
        return ""
    detail = re.sub(r"[\\x00-\\x1f\\x7f]+", " ", detail)
    detail = re.sub(r"\\s+", " ", detail).strip()
    # Error payloads should not echo credentials, but redact them defensively.
    for secret in (settings.tts_api_key, settings.tts_preprocess_api_key):
        secret = str(secret or "").strip()
        if secret:
            detail = detail.replace(secret, "[redacted]")
    return detail[:360]


def _validated_api_key(value: str, setting_name: str) -> str:
    """Reject invalid Authorization header values with a clear config error.

    Bearer credentials are HTTP header data and must be printable ASCII. Sending
    Cyrillic inside an API key otherwise raises UnicodeEncodeError in the
    HTTP transport, which was misreported to the browser as HTTP 400.
    """
    key = str(value or "").strip()
    if any(ord(ch) < 33 or ord(ch) > 126 for ch in key):
        raise TTSNotConfiguredError(
            f"{setting_name} должен содержать только печатные ASCII-символы. "
            "Проверьте значение ключа в Render → Environment: вставьте настоящий "
            "API-ключ провайдера без кириллицы, пробелов и переносов строк."
        )
    return key


async def prepare_spoken_text(value: str) -> str:
    """Use one explicitly configured OpenAI-compatible model to verbalize notation."""
    base_url = (settings.tts_preprocess_base_url or "").strip().rstrip("/")
    api_key = _validated_api_key(settings.tts_preprocess_api_key, "TTS_PREPROCESS_API_KEY")
    model = (settings.tts_preprocess_model or "").strip()
    if not base_url or not model:
        raise TTSNotConfiguredError(
            "Для понятной озвучки задайте TTS_PREPROCESS_BASE_URL, "
            "TTS_PREPROCESS_API_KEY и TTS_PREPROCESS_MODEL."
        )
    source = str(value or "").strip()
    if not source:
        raise ValueError("В ответе нет текста для озвучки.")
    limit = max(1000, int(settings.tts_max_chars or 30000))
    if len(source) > limit:
        source = source[:limit].rsplit(" ", 1)[0].rstrip() + "…"

    system_prompt = (
        "Ты — редактор текста для русской голосовой озвучки. Преобразуй исходный ответ "
        "в полный естественный текст, который TTS сможет произнести понятно. Верни ТОЛЬКО "
        "готовый текст для произношения, без комментариев о своей работе и без Markdown. "
        "Сохраняй все факты, ход решения, числа, единицы измерения, порядок действий и смысл. "
        "Ничего не додумывай и не сокращай математическое содержание. Любую формулу, LaTeX, "
        "слеши, кодовые обозначения и символы переводи в однозначные слова по-русски. "
        "Дроби произноси как «в числителе ...; в знаменателе ...» или «... делённое на ...». "
        "Интегралы — как «интеграл от ... по ... от ... до ...» с проговариванием пределов; "
        "корни — «квадратный корень из ...», степени — «... в степени ...», индексы — "
        "«... с индексом ...». Скобки, модули, суммы, пределы, производные, векторы, "
        "греческие буквы, логические и множественные знаки проговаривай словами. "
        "В геометрии проговаривай обозначения точек, отрезков, углов, параллельности, "
        "перпендикулярности, подобия и равенства. В физике и химии расшифровывай обозначения "
        "в контексте, индексы и единицы измерения, формулы веществ произноси как названия "
        "или последовательность символов, не меняя состав. В русском языке и лингвистике "
        "произноси знаки транскрипции, ударения, морфемные границы и сокращения понятным "
        "образом. В информатике объясняй символы кода словами, но не исполняй код и не "
        "выдумывай его смысл. Сохраняй обычную прозу обычной прозой. Не произноси URL, "
        "служебную разметку и декоративные Markdown-символы. Не заменяй формулу фразой "
        "«формула пропущена»: всё значимое должно быть проговорено."
    )
    endpoint = base_url if base_url.endswith("/chat/completions") else base_url + "/chat/completions"
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "Подготовь этот ответ к озвучке, сохранив содержание:\n\n" + source},
        ],
        "temperature": max(0.0, min(float(settings.tts_preprocess_temperature or 0.1), 0.5)),
        "max_tokens": max(256, min(int(settings.tts_preprocess_max_tokens or 12000), 24000)),
    }
    timeout = max(10, min(int(settings.tts_preprocess_timeout or 180), 600))
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=15)) as client:
            response = await client.post(endpoint, headers=headers, json=payload)
    except UnicodeEncodeError as exc:
        raise TTSNotConfiguredError(
            "Ошибка кодировки заголовка ИИ-подготовщика. Проверьте "
            "TTS_PREPROCESS_API_KEY и TTS_PREPROCESS_BASE_URL; HTTP-заголовки "
            "должны содержать только ASCII."
        ) from exc
    except httpx.TimeoutException as exc:
        raise TTSGenerationError("ИИ-подготовщик текста для озвучки не ответил вовремя.") from exc
    except httpx.HTTPError as exc:
        raise TTSGenerationError("Не удалось связаться с ИИ-подготовщиком озвучки.") from exc
    if response.status_code < 200 or response.status_code >= 300:
        detail = _provider_error_detail(response)
        suffix = f": {detail}" if detail else ""
        raise TTSGenerationError(
            f"ИИ-подготовщик озвучки вернул HTTP {response.status_code}{suffix}"
        )
    try:
        data = response.json()
        prepared = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise TTSGenerationError("ИИ-подготовщик озвучки вернул ответ неизвестного формата.") from exc
    if isinstance(prepared, list):
        prepared = " ".join(
            item.get("text", "") for item in prepared if isinstance(item, dict)
        )
    prepared = clean_tts_text(str(prepared or ""))
    if not prepared:
        raise TTSGenerationError("ИИ-подготовщик вернул пустой текст для озвучки.")
    return prepared


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
    api_key = _validated_api_key(settings.tts_api_key, "TTS_API_KEY")
    if not base_url:
        raise TTSNotConfiguredError("Задайте TTS_BASE_URL в переменных окружения сервиса.")
    fmt = normalized_audio_format()
    cleaned = await prepare_spoken_text(text)
    if not cleaned:
        raise ValueError("В ответе нет текста для озвучки.")

    endpoint = base_url if base_url.endswith("/audio/speech") else base_url + "/audio/speech"
    headers = {"Accept": AUDIO_MEDIA_TYPES[fmt]}
    if api_key:
        headers["Authorization"] = "Bearer " + api_key
    model = (settings.tts_model or "tts-1").strip()
    voice = (settings.tts_voice or "").strip()
    payload = {
        "model": model,
        "input": cleaned,
        "response_format": fmt,
    }
    # OpenRouter's Fish Audio models do not expose preset voice IDs. The
    # voice-cloning path uses input_references instead, so do not forward any
    # legacy TTS_VOICE value (alloy, ru-RU, or otherwise) to Fish Audio.
    if voice and not model.startswith("fish-audio/"):
        payload["voice"] = voice
    timeout = max(10, min(int(settings.tts_timeout or 180), 600))
    async with _slots:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=15)) as client:
                response = await client.post(endpoint, headers=headers, json=payload)
        except UnicodeEncodeError as exc:
            raise TTSNotConfiguredError(
                "Ошибка кодировки заголовка сервиса озвучки. Проверьте "
                "TTS_API_KEY и TTS_BASE_URL; HTTP-заголовки должны содержать "
                "только ASCII."
            ) from exc
        except httpx.TimeoutException as exc:
            raise TTSGenerationError("Сервис озвучки не ответил вовремя.") from exc
        except httpx.HTTPError as exc:
            raise TTSGenerationError("Не удалось связаться с сервисом озвучки.") from exc

    if response.status_code < 200 or response.status_code >= 300:
        detail = _provider_error_detail(response)
        suffix = f": {detail}" if detail else ""
        raise TTSGenerationError(f"Сервис озвучки вернул HTTP {response.status_code}{suffix}")
    audio = response.content
    if not audio:
        raise TTSGenerationError("Сервис озвучки вернул пустой аудиофайл.")
    if len(audio) > _MAX_AUDIO_BYTES:
        raise TTSGenerationError("Аудиофайл превышает допустимый размер 40 МБ.")
    content_type = (response.headers.get("content-type") or "").lower()
    if "application/json" in content_type or "text/" in content_type:
        raise TTSGenerationError("Сервис озвучки вернул не аудиоданные.")
    return audio, fmt

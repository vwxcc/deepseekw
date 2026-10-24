"""Application configuration loaded from environment / .env file."""
from __future__ import annotations

import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- App ---
    app_name: str = "ChatStudio"
    app_version: str = "0.1.0"

    # --- Auth / sessions ---
    # Development fallback is rejected by the production startup guard.
    session_secret: str = "dev-secret-change-me"
    # Default Secure cookies on Render, but preserve plain-HTTP local development.
    # An explicit environment value still takes precedence.
    session_cookie_secure: bool = Field(
        default_factory=lambda: bool(
            os.getenv("RENDER_SERVICE_ID") or os.getenv("RENDER_EXTERNAL_URL")
        )
    )
    session_max_age: int = 60 * 60 * 24 * 7  # 7 days
    csrf_protection: bool = True

    # --- Paths ---
    data_dir: str = "/app/data"
    upload_dir: str = "/app/uploads"
    frontend_dir: str = "/app/frontend"

    # --- AI ---
    global_ai_concurrency: int = 2
    request_timeout: int = 300
    # False => let reasoning-capable models stream their thinking
    ai_disable_thinking: bool = False

    # --- Web search (SearXNG) ---
    web_search_enabled: bool = True
    searxng_url: str = ""
    web_search_results: int = 5
    web_search_timeout: int = 8
    # context window of the default model, used for the "usage %" widget
    model_context_len: int = 262144
    # --- Agent (sandboxed code execution) ---
    agent_enabled: bool = True
    agent_max_steps: int = 6
    agent_timeout: int = 40
    # isolated runner (separate container, internal network, no internet)
    sandbox_url: str = Field(
        default_factory=lambda: (
            "" if os.getenv("RENDER_SERVICE_ID") or os.getenv("RENDER_EXTERNAL_URL")
            else "http://chatstudio-sandbox:8000"
        )
    )
    # Set to the same high-entropy key on the app and the separate sandbox service.
    sandbox_api_key: str = ""
    # Unsafe in a public multi-user app; use only for trusted local development.
    sandbox_allow_local: bool = False
    sandbox_work_dir: str = "/app/data/sandbox"
    sandbox_concurrency: int = 2
    sandbox_queue_limit: int = 12
    # code-agent mode: persistent project per chat, more steps
    code_agent_max_steps: int = 3
    code_agent_timeout: int = 60

    # --- Incoming audio transcription (OpenAI-compatible /audio/transcriptions endpoint) ---
    # Optional dedicated endpoint; MAIN model providers remain fallback candidates.
    audio_transcription_base_url: str = ""
    audio_transcription_api_key: str = ""
    audio_transcription_model: str = "whisper-1"
    audio_transcription_timeout: int = Field(default=75, ge=5, le=180)

    # --- Text-to-speech (OpenAI-compatible /audio/speech endpoint) ---
    tts_base_url: str = ""
    tts_api_key: str = ""
    tts_model: str = "tts-1"
    tts_voice: str = "alloy"
    tts_response_format: str = "mp3"
    tts_timeout: int = 180
    tts_max_chars: int = 30000
    tts_concurrency: int = 2
    # Separate, explicitly configured model that verbalizes notation before TTS.
    tts_preprocess_base_url: str = ""
    tts_preprocess_api_key: str = ""
    tts_preprocess_model: str = ""
    tts_preprocess_timeout: int = 180
    tts_preprocess_max_tokens: int = 12000
    tts_preprocess_temperature: float = 0.1

    # --- File prefetch (DeepSeek Flash helper) ---
    prefetch_base_url: str = "https://api.deepseek.com"
    prefetch_api_key: str = Field(default_factory=lambda: os.getenv("PREFETCH_API_KEY") or os.getenv("DEEPSEEK_API_KEY") or "")
    prefetch_model: str = "deepseek-flash"
    prefetch_timeout: int = Field(default=60, ge=5, le=180)
    prefetch_max_tokens: int = Field(default=4096, ge=256, le=12000)

    # --- Files ---
    max_file_size: int = 25 * 1024 * 1024        # 25 MB per file
    max_total_file_size: int = 100 * 1024 * 1024  # 100 MB per request
    max_files_per_request: int = 10
    # per-user storage quota (4 GB) and the free-space floor below which we prune
    max_user_storage: int = 4 * 1024 * 1024 * 1024
    disk_min_free: int = 3 * 1024 * 1024 * 1024
    # how many characters of an extracted document are sent to the model
    max_attachment_chars: int = 40000

    # --- Primary MAIN model provider overrides / initial seed ---
    qwen_provider: str = "openai"
    qwen_api_key: str = ""
    qwen_base_url: str = "https://llm.stage.satel.org/v1"
    qwen_model: str = "qwen36-35b"  # backwards-compatible initial seed / override
    qwen_model_id: str = ""  # optional explicit external model ID; takes priority over QWEN_MODEL
    qwen_temperature: float = 0.2
    qwen_max_tokens: int = 32000
    # Optional usage prices in USD per 1,000,000 tokens. None preserves the
    # price saved on the primary MAIN model entry in the database.
    qwen_price_in: float | None = Field(default=2.0, ge=0)
    qwen_price_out: float | None = Field(default=25.0, ge=0)
    qwen_price_cache: float | None = Field(default=None, ge=0)

    # --- Automatic fast Qwen lane (parallel with the primary model) ---
    # This is independent of the primary MAIN provider stored in Model Sets.
    # The lane is enabled only when BASE_URL, API_KEY, and MODEL_ID are all configured.
    fast_qwen_base_url: str = ""
    fast_qwen_api_key: str = ""
    fast_qwen_model_id: str = ""
    fast_qwen_max_tokens: int = Field(default=8000, ge=1)
    fast_qwen_timeout: int = Field(default=60, ge=5, le=300)
    fast_qwen_price_in: float = Field(default=0.0, ge=0)
    fast_qwen_price_out: float = Field(default=0.0, ge=0)
    fast_qwen_price_cache: float = Field(default=0.0, ge=0)

    # --- Admin and Pro-user bootstrap (optional) ---
    admin_email: str = ""
    admin_password: str = ""
    # JSON array of {"email": "...", "password": "...", "name": "..."} objects.
    pro_users_json: str = ""

    @property
    def database_url(self) -> str:
        db_path = (Path(self.data_dir).expanduser().resolve() / "chatstudio.db")
        return f"sqlite+aiosqlite:///{db_path}"

    @property
    def data_path(self) -> Path:
        return Path(self.data_dir).expanduser().resolve()

    @property
    def upload_path(self) -> Path:
        return Path(self.upload_dir).expanduser().resolve()

    @property
    def sandbox_path(self) -> Path:
        """Directory shared with the sandbox container (read-only for us)."""
        return Path(self.sandbox_work_dir).expanduser().resolve()


settings = Settings()

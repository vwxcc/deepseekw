"""Application configuration loaded from environment / .env file."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- App ---
    app_name: str = "ai-ch"
    app_version: str = "0.1.0"

    # --- Auth / sessions ---
    session_secret: str = "dev-secret-change-me"
    session_cookie_secure: bool = False
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
    web_search_timeout: int = 6
    # context window of the default model, used for the "usage %" widget
    model_context_len: int = 262144
    # --- Files ---
    max_file_size: int = 25 * 1024 * 1024        # 25 MB per file
    max_total_file_size: int = 100 * 1024 * 1024  # 100 MB per request
    max_files_per_request: int = 10
    # Conservative limits for small hosted instances.
    max_user_storage: int = 250 * 1024 * 1024
    disk_min_free: int = 100 * 1024 * 1024
    # how many characters of an extracted document are sent to the model
    max_attachment_chars: int = 8000
    # per-file, per-message cap for extracted text (hard limit even before DB)
    max_extracted_per_message: int = 24000

    # --- Default model set seed (Qwen) ---
    qwen_api_key: str = ""
    qwen_base_url: str = "https://llm.stage.satel.org/v1"
    qwen_model: str = "qwen36-35b"
    qwen_temperature: float = 0.2
    qwen_max_tokens: int = 32000

    # --- Admin bootstrap (optional) ---
    admin_email: str = "admin@ai-ch.local"
    admin_password: str = ""

    # --- HTTPS / SSL ---
    ssl_certfile: str = ""
    ssl_keyfile: str = ""
    ssl_cafile: str = ""
    ssl_verify_client: bool = False
    host: str = "127.0.0.1"
    port: int = 8000

    @property
    def is_https(self) -> bool:
        return bool(self.ssl_certfile and self.ssl_keyfile)

    @property
    def database_url(self) -> str:
        db_path = (Path(self.data_dir).expanduser().resolve() / "ai-ch.db")
        return f"sqlite+aiosqlite:///{db_path}"

    @property
    def data_path(self) -> Path:
        return Path(self.data_dir).expanduser().resolve()

    @property
    def upload_path(self) -> Path:
        return Path(self.upload_dir).expanduser().resolve()

settings = Settings()

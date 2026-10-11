"""Security middleware: headers, CORS, request logging, IP blocking."""
from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from .config import settings

log = logging.getLogger("ai-ch.security")

# ============================================================
# Security Headers
# ============================================================

# Content Security Policy — строгий CSP для защиты от XSS
_CSP_DEFAULT = {
    "default-src": "'self'",
    "script-src": "'self' 'unsafe-inline' cdn.jsdelivr.net",
    "style-src": "'self' 'unsafe-inline' cdn.jsdelivr.net",
    "img-src": "'self' data: blob:",
    "font-src": "'self' data:",
    "connect-src": "'self' https://llm.stage.satel.org",
    "media-src": "'self' blob:",
    "object-src": "'none'",
    "frame-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",  # защита от clickjacking
    "upgrade-insecure-requests": "",
}

def _build_csp() -> str:
    return "; ".join(f"{k}{v} " if v else k for k, v in _CSP_DEFAULT.items()).strip()

# ============================================================
# Rate Limiting (in-memory, IP-based)
# ============================================================

class RateLimiter:
    """Simple in-memory rate limiter for auth endpoints."""
    
    # { ip: [(timestamp, ...), ...] }
    _attempts: dict[str, list[float]] = defaultdict(list)
    
    def __init__(self, max_attempts: int = 5, window_seconds: int = 300):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
    
    def is_allowed(self, key: str) -> tuple[bool, int]:
        """Returns (allowed, remaining_attempts)."""
        now = time.time()
        window_start = now - self.window_seconds
        
        # Очистка старых записей
        self._attempts[key] = [
            t for t in self._attempts[key] if t > window_start
        ]
        
        current_count = len(self._attempts[key])
        
        if current_count >= self.max_attempts:
            # Блокируем
            remaining = 0
            log.warning(
                "IP %s заблокирован (лимит: %d попыток за %d сек)",
                key, self.max_attempts, self.window_seconds
            )
            return False, remaining
        
        # Записываем попытку
        self._attempts[key].append(now)
        remaining = self.max_attempts - current_count - 1
        
        return True, remaining
    
    def reset(self, key: str) -> None:
        """Сброс счётчика (после успешной аутентификации)."""
        self._attempts.pop(key, None)


# Глобальный rate limiter
_auth_limiter = RateLimiter(max_attempts=5, window_seconds=300)

# ============================================================
# IP Blacklist
# ============================================================

_ip_blacklist: set[str] = set()
_ip_blacklist_expiry: dict[str, datetime] = {}

# Максимальный размер blacklisted-списка
_MAX_BLACKLIST = 10000

def _check_ip_blacklist(ip: str) -> bool:
    if ip in _ip_blacklist:
        expiry = _ip_blacklist_expiry.get(ip)
        if expiry and expiry > datetime.now(timezone.utc):
            return True
        # Истёк — убираем
        _ip_blacklist.discard(ip)
        _ip_blacklist_expiry.pop(ip, None)
    return False

def _blacklist_ip(ip: str, duration_minutes: int = 60) -> None:
    if len(_ip_blacklist) >= _MAX_BLACKLIST:
        # Удаляем oldest
        if _ip_blacklist_expiry:
            oldest = min(_ip_blacklist_expiry.keys(), key=lambda k: _ip_blacklist_expiry[k])
            _ip_blacklist.discard(oldest)
            _ip_blacklist_expiry.pop(oldest, None)
    
    _ip_blacklist.add(ip)
    _ip_blacklist_expiry[ip] = datetime.now(timezone.utc).replace(tzinfo=None) + __import__('datetime').timedelta(minutes=duration_minutes)
    log.warning("IP %s добавлен в blacklist (на %d минут)", ip, duration_minutes)

# ============================================================
# Allowed file extensions for upload
# ============================================================

# Разрешённые расширения файлов
_ALLOWED_EXTENSIONS = {
    # Документы
    ".pdf", ".doc", ".docx", ".txt", ".rtf",
    # Таблицы
    ".xls", ".xlsx", ".csv",
    # Презентации
    ".ppt", ".pptx",
    # Изображения
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".ico",
    # Архивы (для анализа)
    ".zip", ".tar", ".gz",
    # Код
    ".py", ".js", ".ts", ".html", ".css", ".json", ".yaml", ".yml", ".xml", ".md",
    # Другое
    ".log",
}

# Запрещённые MIME-типы (executables, scripts)
_FORBIDDEN_MIME_TYPES = {
    "application/x-executable",
    "application/x-msdownload",
    "application/x-dosexec",  # .exe
    "application/octet-stream",  # бинарники с неизвестным типом
    "application/javascript",  # JS-файлы, загружаемые как файлы
}

# Map MIME types to allowed extensions
_MIME_TO_EXT = {
    "application/pdf": [".pdf"],
    "application/msword": [".doc"],
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
    "text/plain": [".txt", ".log", ".md"],
    "text/rtf": [".rtf"],
    "application/vnd.ms-excel": [".xls"],
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    "text/csv": [".csv"],
    "application/vnd.ms-powerpoint": [".ppt"],
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/png": [".png"],
    "image/gif": [".gif"],
    "image/webp": [".webp"],
    "image/bmp": [".bmp"],
    "image/svg+xml": [".svg"],
    "image/x-icon": [".ico"],
    "application/zip": [".zip"],
    "application/x-tar": [".tar"],
    "application/gzip": [".gz"],
    "application/json": [".json"],
    "application/xml": [".xml"],
    "text/xml": [".xml"],
    "text/markdown": [".md"],
}


# ============================================================
# Security Middleware
# ============================================================

class SecurityMiddleware(BaseHTTPMiddleware):
    """Middleware для добавления security headers и защиты приложения."""
    
    async def dispatch(self, request: Request, call_next) -> Response:
        # --- Получаем IP клиента ---
        client_ip = self._get_client_ip(request)
        
        # --- Проверяем blacklist ---
        if _check_ip_blacklist(client_ip):
            log.warning("Доступ заблокирован для IP %s", client_ip)
            return Response(
                content="Access denied",
                status_code=403,
                media_type="text/plain",
            )
        
        # --- Логирование запроса ---
        request_id = str(uuid.uuid4())[:8]
        start_time = time.time()
        
        log.info(
            "[REQ %s] %s %s | IP: %s | User-Agent: %s",
            request_id,
            request.method,
            request.url.path,
            client_ip,
            request.headers.get("user-agent", "unknown")[:100],
        )
        
        # --- Обработка запроса ---
        response = await call_next(request)
        
        # --- Время ответа ---
        elapsed = time.time() - start_time
        response.headers["X-Response-Time"] = f"{elapsed:.3f}s"
        
        # --- Security Headers ---
        self._add_security_headers(response, request, request_id)
        
        # --- Логирование ответа ---
        if response.status_code >= 400:
            log.warning(
                "[REQ %s] %s %s -> %d | IP: %s",
                request_id,
                request.method,
                request.url.path,
                response.status_code,
                client_ip,
            )
        
        return response
    
    def _get_client_ip(self, request: Request) -> str:
        """Получение реального IP клиента."""
        # Проверяем прокси-заголовки
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        
        real_ip = request.headers.get("x-real-ip")
        if real_ip:
            return real_ip.strip()
        
        # Возвращаем IP подключившегося клиента
        if request.client:
            return request.client.host
        
        return "unknown"
    
    def _add_security_headers(self, response: Response, request: Request, request_id: str) -> None:
        """Добавление заголовков безопасности."""
        
        # --- Strict Transport Security (HSTS) ---
        if settings.is_https:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains; preload"
            )
        
        # --- Content Security Policy ---
        response.headers["Content-Security-Policy"] = _build_csp()
        
        # --- X-Frame-Options (защита от clickjacking) ---
        response.headers["X-Frame-Options"] = "DENY"
        
        # --- X-Content-Type-Options (MIME-sniffing protection) ---
        response.headers["X-Content-Type-Options"] = "nosniff"
        
        # --- X-XSS-Protection (legacy XSS protection) ---
        response.headers["X-XSS-Protection"] = "1; mode=block"
        
        # --- Referrer-Policy ---
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        
        # --- Permissions-Policy (браузерные фичи) ---
        response.headers["Permissions-Policy"] = (
            "camera=(), microphone=(), geolocation=(), "
            "payment=(), usb=(), magnetometer=(), gyroscope=()"
        )
        
        # --- Cache-Control для конфиденциальных данных ---
        if request.url.path.startswith("/api/") or request.url.path.startswith("/assets/"):
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            response.headers["Pragma"] = "no-cache"
        
        # --- Request ID для tracing ---
        response.headers["X-Request-ID"] = request_id
        
        # --- Remove server header ---
        try:
            del response.headers["Server"]
        except KeyError:
            pass


# ============================================================
# Login Attempt Logger
# ============================================================

class LoginAttemptLogger:
    """Логгер попыток входа для мониторинга безопасности."""
    
    _attempts: list[dict[str, Any]] = []
    MAX_LOG_SIZE = 1000
    
    @classmethod
    def log_attempt(cls, email: str, success: bool, ip: str, reason: str = "") -> None:
        cls._attempts.append({
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "email": email[:50],  # Обрезаем длинные email
            "success": success,
            "ip": ip,
            "reason": reason[:200],
        })
        
        if len(cls._attempts) > cls.MAX_LOG_SIZE:
            cls._attempts = cls._attempts[-cls.MAX_LOG_SIZE:]
    
    @classmethod
    def get_recent_attempts(cls, limit: int = 100) -> list[dict]:
        return cls._attempts[-limit:]
    
    @classmethod
    def get_suspicious_ips(cls, threshold: int = 10) -> list[str]:
        """Находит IP с подозрительной активностью (>threshold failed attempts)."""
        ip_counts: dict[str, int] = defaultdict(int)
        for attempt in cls._attempts:
            if not attempt["success"]:
                ip_counts[attempt["ip"]] += 1
        
        return [ip for ip, count in ip_counts.items() if count >= threshold]
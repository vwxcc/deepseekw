"""Password hashing, session tokens and CSRF helpers."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from .config import settings

_SCRYPT_N = 16384
_SCRYPT_R = 8
_SCRYPT_P = 1


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P
    )
    return "scrypt$%d$%d$%d$%s$%s" % (
        _SCRYPT_N,
        _SCRYPT_R,
        _SCRYPT_P,
        base64.b64encode(salt).decode(),
        base64.b64encode(dk).decode(),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, n, r, p, salt_b64, dk_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(dk_b64)
        dk = hashlib.scrypt(
            password.encode("utf-8"), salt=salt, n=int(n), r=int(r), p=int(p)
        )
        return hmac.compare_digest(dk, expected)
    except Exception:
        return False


def generate_session_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def csrf_token_for(session_token: str) -> str:
    return hmac.new(
        settings.session_secret.encode("utf-8"),
        session_token.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_csrf(session_token: str | None, provided: str | None) -> bool:
    if not settings.csrf_protection:
        return True
    if not session_token or not provided:
        return False
    return hmac.compare_digest(csrf_token_for(session_token), provided)


def session_expiry() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(
        seconds=settings.session_max_age
    )

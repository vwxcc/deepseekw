"""Small process-wide guard for active per-user TTS requests.

The registry is shared by requests from all browser sessions on this app process.
Database reservations supplement status discovery across workers.
"""
from __future__ import annotations

from threading import Lock


class AudioGenerationInProgress(RuntimeError):
    """The account already has an active audio generation."""

    def __init__(self, message_id: str):
        self.message_id = message_id
        super().__init__("Audio generation is already in progress.")


_active_by_user: dict[str, str] = {}
_last_error_by_message: dict[tuple[str, str], str] = {}
_guard = Lock()


def begin_audio_generation(user_id: str, message_id: str) -> None:
    """Atomically start one generation for an account or reject a parallel one."""
    with _guard:
        active_message_id = _active_by_user.get(user_id)
        if active_message_id is not None:
            raise AudioGenerationInProgress(active_message_id)
        _active_by_user[user_id] = message_id
        _last_error_by_message.pop((user_id, message_id), None)


def set_audio_generation_error(user_id: str, message_id: str, detail: str | None) -> None:
    """Expose a concise failure to the owner's open player without leaking provider secrets."""
    key = (str(user_id), str(message_id))
    with _guard:
        if detail:
            _last_error_by_message[key] = str(detail).strip()[:500]
        else:
            _last_error_by_message.pop(key, None)


def audio_generation_error(user_id: str, message_id: str) -> str | None:
    """Return an in-process audio error for this user and message, if any."""
    with _guard:
        return _last_error_by_message.get((str(user_id), str(message_id)))


def active_audio_generation(user_id: str) -> str | None:
    """Get this account's active message ID, if any."""
    with _guard:
        return _active_by_user.get(user_id)


def finish_audio_generation(user_id: str, message_id: str) -> None:
    """Clear only the reservation owned by this request."""
    with _guard:
        if _active_by_user.get(user_id) == message_id:
            _active_by_user.pop(user_id, None)

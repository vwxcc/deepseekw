"""ORM models for ChatStudio."""
from __future__ import annotations

import enum
from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    # SQLite stores/returns naive datetimes, so keep everything naive UTC.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_id() -> str:
    return str(uuid4())


class MessageStatus(str, enum.Enum):
    queued = "queued"
    processing = "processing"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class Role(str, enum.Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class RouteType(str, enum.Enum):
    MAIN = "MAIN"
    TITLE = "TITLE"
    SUGGESTIONS = "SUGGESTIONS"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    name: Mapped[str] = mapped_column(String(120), default="")
    plan: Mapped[str] = mapped_column(String(32), default="free")
    avatar: Mapped[int] = mapped_column(Integer, default=0)
    github_user: Mapped[str | None] = mapped_column(String(120), nullable=True)
    github_token: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_guest: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    # HMAC of the signup/client IP; the raw IP is never stored.
    signup_ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # One-time free import allowance; normal token and budget accounting remains unchanged.
    import_transfer_used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    # A per-user quota reset marker; historical billing records remain intact.
    usage_reset_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Prepaid API token wallet. A registration receives 30,000 tokens.
    token_balance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    chats: Mapped[list["Chat"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )
    sessions: Mapped[list["Session"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    files: Mapped[list["File"]] = relationship(
        back_populates="owner", cascade="all, delete-orphan"
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # HMAC of the IP currently observed for this session, for legacy-account limits.
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped["User"] = relationship(back_populates="sessions")


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Chat(Base):
    __tablename__ = "chats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), default="Новый чат")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    share_token: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    project_id: Mapped[str | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary_upto: Mapped[str | None] = mapped_column(String(36), nullable=True)
    effort: Mapped[str] = mapped_column(String(16), default="recommended")
    mode: Mapped[str] = mapped_column(String(16), default="chat")
    model_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    model_set_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    bundle_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    source_chat_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    source_chat_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    compress_count: Mapped[int] = mapped_column(Integer, default=0)
    compress_date: Mapped[str | None] = mapped_column(String(10), nullable=True)

    owner: Mapped["User"] = relationship(back_populates="chats")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="chat", cascade="all, delete-orphan"
    )


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    chat_id: Mapped[str] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    role: Mapped[Role] = mapped_column(Enum(Role), nullable=False, default=Role.user)
    content: Mapped[str] = mapped_column(Text, default="")
    parent_message_id: Mapped[str | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[MessageStatus] = mapped_column(
        Enum(MessageStatus), default=MessageStatus.completed
    )
    model_set_id: Mapped[str | None] = mapped_column(
        ForeignKey("model_sets.id", ondelete="SET NULL"), nullable=True
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    tokens_cached: Mapped[int] = mapped_column(Integer, default=0)
    rating: Mapped[int] = mapped_column(Integer, default=0)
    sources: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_runs: Mapped[str | None] = mapped_column(Text, nullable=True)
    ui_state: Mapped[str | None] = mapped_column(Text, nullable=True)
    execution_target: Mapped[str] = mapped_column(String(16), default="site")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    chat: Mapped["Chat"] = relationship(back_populates="messages")
    parent: Mapped["Message | None"] = relationship(
        "Message", remote_side="Message.id", back_populates="children"
    )
    children: Mapped[list["Message"]] = relationship("Message", back_populates="parent")
    attachments: Mapped[list["Attachment"]] = relationship(
        back_populates="message", cascade="all, delete-orphan"
    )


class AudioGeneration(Base):
    """A successful-or-in-progress voice generation reservation for rolling quotas."""

    __tablename__ = "audio_generations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )


class ReadableTextGeneration(Base):
    """Cached spoken/readable representation of one assistant answer."""

    __tablename__ = "readable_text_generations"

    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(16), default="generating", nullable=False)
    text: Mapped[str | None] = mapped_column(Text, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    file_id: Mapped[str] = mapped_column(
        ForeignKey("files.id", ondelete="CASCADE"), nullable=False
    )

    message: Mapped["Message"] = relationship(back_populates="attachments")
    file: Mapped["File"] = relationship()


class File(Base):
    __tablename__ = "files"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    storage_path: Mapped[str] = mapped_column(String(512), nullable=False)
    original_name: Mapped[str] = mapped_column(String(512), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(255), default="")
    size: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64), default="")
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    kind: Mapped[str] = mapped_column(String(32), default="other")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    owner: Mapped["User"] = relationship(back_populates="files")


class ModelSet(Base):
    __tablename__ = "model_sets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    route_type: Mapped[RouteType] = mapped_column(Enum(RouteType), default=RouteType.MAIN)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    free_access: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_router: Mapped[bool] = mapped_column(Boolean, default=False)

    entries: Mapped[list["ModelSetEntry"]] = relationship(
        back_populates="model_set",
        cascade="all, delete-orphan",
        order_by="ModelSetEntry.position",
    )


class ModelSetEntry(Base):
    __tablename__ = "model_set_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    model_set_id: Mapped[str] = mapped_column(
        ForeignKey("model_sets.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    provider: Mapped[str] = mapped_column(String(64), default="openai")
    base_url: Mapped[str] = mapped_column(String(512), default="")
    api_key: Mapped[str] = mapped_column(String(512), default="")
    model: Mapped[str] = mapped_column(String(255), nullable=False)
    temperature: Mapped[float] = mapped_column(Float, default=0.2)
    max_tokens: Mapped[int] = mapped_column(Integer, default=32000)
    context_len: Mapped[int] = mapped_column(Integer, default=0)
    price_in: Mapped[float] = mapped_column(Float, default=0.0)
    price_out: Mapped[float] = mapped_column(Float, default=0.0)
    price_cache: Mapped[float] = mapped_column(Float, default=0.0)
    timeout: Mapped[int] = mapped_column(Integer, default=300)
    # how many requests this model may serve at the same time; when the limit is
    # reached the router moves on to the next model of the chain
    max_parallel: Mapped[int] = mapped_column(Integer, default=2)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    model_set: Mapped["ModelSet"] = relationship(back_populates="entries")


class ApiGatewayConfig(Base):
    """OpenAI-compatible /v1 gateway settings; only a hash of the API key is stored."""
    __tablename__ = "api_gateway_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    model_set_id: Mapped[str] = mapped_column(String(36), default="", nullable=False)
    api_key_hash: Mapped[str] = mapped_column(String(64), default="", nullable=False)
    api_key_prefix: Mapped[str] = mapped_column(String(24), default="", nullable=False)
    # None means inherit the selected source model's price.
    price_in: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    price_out: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    price_cache: Mapped[float | None] = mapped_column(Float, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class UserApiKey(Base):
    """User-owned API credential; only a hash is stored, never the secret."""
    __tablename__ = "user_api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(80), default="Мой API-ключ", nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    key_prefix: Mapped[str] = mapped_column(String(24), default="", nullable=False)
    token_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens_reserved: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=2048, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TokenTransaction(Base):
    """Audit trail for user token grants and API consumption."""
    __tablename__ = "token_transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    admin_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    api_key_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    amount: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    reason: Mapped[str] = mapped_column(String(240), default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class BrainSystemConfig(Base):
    """Admin-managed wiring of AI CH components shown as the system's Second Brain."""
    __tablename__ = "brain_system_config"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    graph_json: Mapped[str] = mapped_column(
        Text, default='{"version":1,"nodes":[],"edges":[]}', nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

class BrainGraph(Base):
    """Per-account editable Second Brain graph."""
    __tablename__ = "brain_graphs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    graph_json: Mapped[str] = mapped_column(Text, default='{"version":1,"nodes":[],"edges":[]}', nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

class UsageEvent(Base):
    """One billed model call — the source of truth for money limits.

    Every call (answer, title, suggestions, routing, search queries, compression)
    writes exactly one row with the price snapshot of the model that served it,
    so the dollar budget counts everything and survives price edits.
    """

    __tablename__ = "usage_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    chat_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    api_key_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    model_set_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    entry_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    model: Mapped[str] = mapped_column(String(255), default="")
    action: Mapped[str] = mapped_column(String(32), default="main")
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    tokens_cached: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, index=True
    )


class Suggestion(Base):
    __tablename__ = "suggestions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    message_id: Mapped[str] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_id: Mapped[str] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)
    text: Mapped[str] = mapped_column(Text, default="")


class Memory(Base):
    __tablename__ = "memories"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    content: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String(16), default="fact")
    message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserSkill(Base):
    __tablename__ = "user_skills"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class ScheduledItem(Base):
    __tablename__ = "scheduled_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    created_by: Mapped[str] = mapped_column(String(16), default="user")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    message_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    title: Mapped[str] = mapped_column(String(300), default="")
    preview: Mapped[str] = mapped_column(Text, default="")
    image_file_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    views: Mapped[int] = mapped_column(Integer, default=0)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PostVote(Base):
    __tablename__ = "post_votes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    post_id: Mapped[str] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    value: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PostComment(Base):
    __tablename__ = "post_comments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    post_id: Mapped[str] = mapped_column(
        ForeignKey("posts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    text: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PlanLimit(Base):
    __tablename__ = "plan_limits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    plan: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(32), nullable=False)
    value: Mapped[float | None] = mapped_column(Float, nullable=True)
    text_value: Mapped[str | None] = mapped_column(Text, nullable=True)


class PrefetchSettings(Base):
    """Global administrator-controlled switch for file prefetch."""

    __tablename__ = "prefetch_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class StatusModelConfig(Base):
    __tablename__ = "status_model_config"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    provider: Mapped[str] = mapped_column(String(64), default="openai", nullable=False)
    base_url: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    api_key: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    model: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    price_in: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    price_out: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)


class ReadableTextModelConfig(Base):
    __tablename__ = "readable_text_model_config"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    provider: Mapped[str] = mapped_column(String(64), default="openai", nullable=False)
    base_url: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    api_key: Mapped[str] = mapped_column(String(512), default="", nullable=False)
    model: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    price_in: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    price_out: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
class ReadyAnswer(Base):
    """One reusable answer generated off the request path."""
    __tablename__ = "ready_answers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    source_query: Mapped[str] = mapped_column(String(2000), default="", nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    titles: Mapped[list["ReadyAnswerTitle"]] = relationship(
        back_populates="answer", cascade="all, delete-orphan"
    )


class ReadyAnswerTitle(Base):
    """Lowercase title with a unique case-insensitive exact-match key."""
    __tablename__ = "ready_answer_titles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    answer_id: Mapped[str] = mapped_column(
        ForeignKey("ready_answers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(2000), unique=True, nullable=False, index=True)
    normalized_title: Mapped[str] = mapped_column(String(2000), default="", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    answer: Mapped["ReadyAnswer"] = relationship(back_populates="titles")


class ReadyAnswerTask(Base):
    """Manual or prepared prompt waiting to be converted into a reusable answer."""
    __tablename__ = "ready_answer_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    query: Mapped[str] = mapped_column(String(2000), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(20), default="manual", nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by_id: Mapped[str | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    ready_answer_id: Mapped[str | None] = mapped_column(
        ForeignKey("ready_answers.id", ondelete="SET NULL"), nullable=True, index=True
    )
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReadyAnswerSeed(Base):
    """The initial prepared-question pool consumed only when auto-generation is enabled."""
    __tablename__ = "ready_answer_seeds"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    question: Mapped[str] = mapped_column(String(2000), unique=True, nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False, index=True)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReadyAnswerSettings(Base):
    """Singleton configuration for auto-filling and generation concurrency."""
    __tablename__ = "ready_answer_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    auto_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    lookup_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    parallelism: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    titles_per_answer: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserPreference(Base):
    """Per-account switches controlling use of personal context."""
    __tablename__ = "user_preferences"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    memory_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    accent_color: Mapped[str] = mapped_column(String(7), default="#3b82f6", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class ConnectorConnection(Base):
    """A provider credential owned by one account; secrets are never returned by APIs."""
    __tablename__ = "connector_connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(48), nullable=False, index=True)
    token: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

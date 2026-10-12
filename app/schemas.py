"""Pydantic schemas (request / response models)."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Auth ---
class UserOut(ORMModel):
    id: str
    email: str
    name: str
    plan: str
    avatar: int = 0
    is_admin: bool
    created_at: datetime


class RegisterIn(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    name: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


class AuthOut(BaseModel):
    user: UserOut
    csrf_token: str


class HealthOut(BaseModel):
    status: str
    app: str
    version: str


# --- Chats ---
class ChatOut(ORMModel):
    id: str
    user_id: str
    title: str
    created_at: datetime
    updated_at: datetime
    is_public: bool = False
    share_token: str | None = None
    mode: str = "chat"
    model_name: str | None = None
    bundle_id: str | None = None


class ChatCreate(BaseModel):
    title: str = "Новый чат"
    mode: str = "chat"


class ChatUpdate(BaseModel):
    title: str


class ShareOut(BaseModel):
    is_public: bool
    share_token: str | None = None
    url: str | None = None


# --- Messages ---
class AttachmentOut(BaseModel):
    id: str
    file_id: str
    name: str
    kind: str
    size: int
    mime_type: str


class MessageOut(ORMModel):
    id: str
    chat_id: str
    role: str
    content: str
    parent_message_id: str | None = None
    status: str
    error: str | None = None
    created_at: datetime
    rating: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    tokens_cached: int = 0
    suggestions: list[str] = Field(default_factory=list)
    attachments: list[AttachmentOut] = Field(default_factory=list)
    sources: list[dict] = Field(default_factory=list)
    tool_runs: list[dict] = Field(default_factory=list)
    memories: list[str] = Field(default_factory=list)
    children: list["MessageOut"] = Field(default_factory=list)


class MessageCreate(BaseModel):
    content: str
    parent_message_id: str | None = None
    attachment_ids: list[str] = Field(default_factory=list)
    model_set_id: str | None = None
    web_search: bool = True
    effort: str | None = None
    style: str = "auto"


class RateIn(BaseModel):
    rating: int = 0


class UsageOut(BaseModel):
    tokens_in: int = 0
    tokens_out: int = 0
    tokens_cached: int = 0
    messages: int = 0
    avg_in: int = 0
    percent: float = 0.0
    context_len: int = 0
    summary_chars: int = 0
    effort: str = "medium"


class CompressIn(BaseModel):
    target_percent: int = 50


class SharedChatOut(BaseModel):
    id: str
    title: str
    share_token: str
    created_at: datetime
    messages: int = 0


class AdminChatOut(BaseModel):
    id: str
    title: str
    owner: str = ""
    messages: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    rating_up: int = 0
    rating_down: int = 0
    is_public: bool = False
    share_token: str | None = None
    created_at: datetime
    updated_at: datetime


class AdminStatsOut(BaseModel):
    users: int = 0
    chats: int = 0
    messages: int = 0
    files: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    tokens_cached: int = 0
    rating_up: int = 0
    rating_down: int = 0
    hourly: list[dict] = Field(default_factory=list)
    top_models: list[dict] = Field(default_factory=list)


# --- Memory ---
class MemoryOut(ORMModel):
    id: str
    content: str
    kind: str = "fact"
    message_id: str | None = None
    created_at: datetime


class MemoryIn(BaseModel):
    content: str
    kind: str = "fact"


# --- Models & status (public to signed-in users) ---
class ModelStatOut(BaseModel):
    id: str
    name: str
    model: str = ""
    route_type: str = "MAIN"
    entries: int = 0
    active_entries: int = 0
    messages: int = 0
    tokens_in: int = 0
    tokens_out: int = 0
    tokens_cached: int = 0
    rating_up: int = 0
    rating_down: int = 0
    share: float = 0.0


# --- Wall of posts ---
class PostIn(BaseModel):
    chat_id: str | None = None
    message_id: str | None = None
    title: str = ""


class PostVoteIn(BaseModel):
    value: int = 0


class PostCommentIn(BaseModel):
    text: str


class PostCommentOut(ORMModel):
    id: str
    post_id: str
    user_id: str
    author: str = ""
    text: str
    created_at: datetime


class PostOut(BaseModel):
    id: str
    user_id: str
    author: str = ""
    title: str
    preview: str
    chat_id: str | None = None
    message_id: str | None = None
    image_file_id: str | None = None
    views: int = 0
    likes: int = 0
    dislikes: int = 0
    comments: int = 0
    my_vote: int = 0
    can_delete: bool = False
    created_at: datetime


class PostDetailOut(PostOut):
    comment_list: list[PostCommentOut] = Field(default_factory=list)


# --- Council of models (beta) ---
class CouncilIn(BaseModel):
    question: str
    personas: list[str] = Field(default_factory=list)


class CouncilOut(BaseModel):
    bundle_id: str
    merge_chat_id: str
    chat_ids: list[str] = Field(default_factory=list)


class CouncilModelOut(BaseModel):
    id: str
    name: str
    hint: str = ""


class PublicChatOut(BaseModel):
    title: str
    created_at: datetime
    author: str = ""
    messages: list[MessageOut] = Field(default_factory=list)


# --- Files ---
class FileOut(ORMModel):
    id: str
    original_name: str
    mime_type: str
    size: int
    kind: str
    created_at: datetime


# --- Model sets (admin) ---
class ModelSetEntryOut(ORMModel):
    id: str
    position: int
    provider: str
    base_url: str
    model: str
    temperature: float
    max_tokens: int
    context_len: int = 0
    price_in: float = 0.0
    price_out: float = 0.0
    price_cache: float = 0.0
    timeout: int
    is_active: bool
    has_api_key: bool = False


class ModelSetOut(ORMModel):
    id: str
    name: str
    slug: str
    route_type: str
    is_active: bool
    is_router: bool = False
    entries: list[ModelSetEntryOut] = Field(default_factory=list)


class ModelSetCreate(BaseModel):
    name: str
    slug: str | None = None
    route_type: str = "MAIN"
    is_active: bool = True


class ModelSetUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None


class ModelSetEntryIn(BaseModel):
    provider: str = "openai"
    base_url: str
    api_key: str = ""
    model: str
    position: int = 0
    temperature: float = 0.2
    max_tokens: int = 32000
    timeout: int = 300
    context_len: int = 0
    price_in: float = 0.0
    price_out: float = 0.0
    price_cache: float = 0.0
    is_active: bool = True


class ModelSetEntryUpdate(BaseModel):
    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    position: int | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    context_len: int | None = None
    price_in: float | None = None
    price_out: float | None = None
    price_cache: float | None = None
    timeout: int | None = None
    is_active: bool | None = None


MessageOut.model_rebuild()

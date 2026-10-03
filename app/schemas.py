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


class ChatCreate(BaseModel):
    title: str = "Новый чат"


class ChatUpdate(BaseModel):
    title: str


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
    suggestions: list[str] = Field(default_factory=list)
    attachments: list[AttachmentOut] = Field(default_factory=list)
    children: list["MessageOut"] = Field(default_factory=list)


class MessageCreate(BaseModel):
    content: str
    parent_message_id: str | None = None
    attachment_ids: list[str] = Field(default_factory=list)


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
    timeout: int
    is_active: bool
    has_api_key: bool = False


class ModelSetOut(ORMModel):
    id: str
    name: str
    slug: str
    route_type: str
    is_active: bool
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
    is_active: bool = True


class ModelSetEntryUpdate(BaseModel):
    provider: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    model: str | None = None
    position: int | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    timeout: int | None = None
    is_active: bool | None = None


MessageOut.model_rebuild()

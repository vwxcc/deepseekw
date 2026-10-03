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
class MessageOut(ORMModel):
    id: str
    chat_id: str
    role: str
    content: str
    parent_message_id: str | None = None
    status: str
    error: str | None = None
    created_at: datetime
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


MessageOut.model_rebuild()

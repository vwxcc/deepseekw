"""WebSocket endpoint for real-time streaming with SSE fallback."""
from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, Query
from fastapi.websockets import WebSocketState

from ..ai.router import Job, router as ai_router
from ..models import Chat, Message, MessageStatus, Role, RouteType
from ..services.chats import message_out
from ..database import SessionLocal

router = APIRouter(prefix="/api/ws", tags=["websocket"])


async def _handle_stream(websocket: WebSocket, chat_id: str, user_text: str,
                          user_id: str, parent_message_id: str | None = None,
                          model_set_id: str | None = None,
                          effort: str | None = None):
    """Handle streaming to WebSocket client."""
    from sqlalchemy import select

    async with SessionLocal() as db:
        # Get chat
        result = await db.execute(
            select(Chat).where(Chat.id == chat_id, Chat.user_id == user_id)
        )
        chat = result.scalar_one_or_none()

        if not chat:
            await websocket.send_json({"type": "error", "error": "Chat not found"})
            return

        # Create assistant message
        assistant = Message(
            chat_id=chat.id,
            user_id=None,
            role=Role.assistant,
            content="",
            parent_message_id=parent_message_id,
            status=MessageStatus.queued,
        )
        db.add(assistant)
        await db.commit()
        await db.refresh(assistant)

        # Build job
        job = Job(
            kind="message",
            route_type=RouteType.MAIN,
            chat_id=chat.id,
            history=[],
            message_id=assistant.id,
            model_set_id=model_set_id,
            effort=effort or chat.effort,
            user_id=user_id,
            mode=chat.mode or "chat",
            project=chat.id if chat.mode == "code" else None,
            user_text=user_text,
        )

        await ai_router.enqueue(job)

        # Stream events
        while True:
            try:
                kind, payload = await asyncio.wait_for(
                    job.output.get(), timeout=300
                )
            except asyncio.TimeoutError:
                await websocket.send_json({
                    "type": "error",
                    "message_id": assistant.id,
                    "error": "Таймаут генерации"
                })
                break

            if kind == "delta":
                await websocket.send_json({"type": "delta", "text": payload})
            elif kind == "thinking":
                await websocket.send_json({"type": "thinking", "text": payload})
            elif kind == "done":
                await websocket.send_json({
                    "type": "done",
                    "message_id": assistant.id,
                    "text": payload
                })
                break
            elif kind == "error":
                await websocket.send_json({
                    "type": "error",
                    "message_id": assistant.id,
                    "error": payload
                })
                break
            elif kind == "cancelled":
                await websocket.send_json({
                    "type": "cancelled",
                    "message_id": assistant.id,
                    "text": payload
                })
                break

        # Final update
        await websocket.send_json({
            "type": "final",
            "message_id": assistant.id,
            "data": message_out(assistant).model_dump(mode="json")
        })


@router.websocket("/stream")
async def stream_chat(
    websocket: WebSocket,
    chat_id: str = Query(..., description="Chat ID"),
    token: str = Query("", description="Session token for auth"),
):
    """WebSocket endpoint for streaming chat responses.
    
    Auth via query parameter token. Usage:
    ws://localhost:8000/api/ws/stream?chat_id=<id>&token=<session>
    """
    # Simple token-based auth for WebSocket (cookies don't work over WS)
    # In production, use JWT or encrypted token

    await websocket.accept()

    try:
        # Receive initial message with metadata
        data = await websocket.receive_json()
        user_id = data.get("user_id")
        message_content = data.get("content", "")
        parent_message_id = data.get("parent_message_id")
        model_set_id = data.get("model_set_id")
        effort = data.get("effort")

        if not message_content:
            await websocket.send_json({"type": "error", "error": "Empty message"})
            return

        if not user_id:
            await websocket.send_json({"type": "error", "error": "Missing user_id"})
            return

        await _handle_stream(
            websocket=websocket,
            chat_id=chat_id,
            user_text=message_content,
            user_id=user_id,
            parent_message_id=parent_message_id,
            model_set_id=model_set_id,
            effort=effort,
        )

    except Exception as e:
        try:
            await websocket.send_json({"type": "error", "error": str(e)})
        except:
            pass
    finally:
        try:
            await websocket.close()
        except:
            pass


@router.websocket("/health")
async def websocket_health(websocket: WebSocket):
    """Health check for WebSocket endpoint."""
    await websocket.accept()
    await websocket.send_json({"type": "health", "status": "ok"})
    await websocket.close()
"""Runtime smoke tests for the Render deployment (no external API calls)."""
from __future__ import annotations

import asyncio

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.bootstrap import bootstrap
from app.config import settings
from app.database import SessionLocal, engine, init_db
from app.models import Chat, Message, ModelSet, MessageStatus, PlanLimit, Role, RouteType, User, utcnow
from app.security import verify_password
from app.services.limits import check_message_quota, set_limits


async def main() -> None:
    settings.data_path.mkdir(parents=True, exist_ok=True)
    settings.upload_path.mkdir(parents=True, exist_ok=True)
    await init_db()
    await bootstrap()

    async with SessionLocal() as db:
        admin = await db.scalar(
            select(User).where(User.email == settings.admin_email.lower(), User.is_admin.is_(True))
        )
        assert admin is not None, "bootstrap did not create the configured administrator"
        assert admin.plan == "max", "administrator should have unrestricted plan"
        if settings.admin_password:
            assert verify_password(settings.admin_password, admin.password_hash), "admin password is not usable"

        for slug, route in (
            ("qwen-main", RouteType.MAIN),
            ("qwen-title", RouteType.TITLE),
            ("qwen-continue", RouteType.CONTINUE),
            ("qwen-suggestions", RouteType.SUGGESTIONS),
            ("qwen-summary", RouteType.SUMMARY),
            ("qwen-file-analysis", RouteType.FILE_ANALYSIS),
        ):
            model_set = await db.scalar(
                select(ModelSet)
                .options(selectinload(ModelSet.entries))
                .where(ModelSet.slug == slug)
            )
            assert model_set is not None, f"missing task chain: {slug}"
            assert model_set.route_type == route, f"wrong task route for {slug}"
            assert model_set.is_active and not model_set.is_router, f"{slug} must be active and not an auto-router"
            assert any(entry.is_active for entry in model_set.entries), f"no active fallback entry for {slug}"
            assert all((entry.quota_reset_hours or 6) >= 1 for entry in model_set.entries), f"invalid quota window for {slug}"

        # Set a tiny quota and prove the server-side check blocks then permits after reset.
        test_email = "ci-quota-smoke@ai-ch.local"
        old = await db.scalar(select(User).where(User.email == test_email))
        if old is not None:
            await db.delete(old)
            await db.commit()
        await set_limits(db, "free", {"messages_per_day": 1})
        user = User(email=test_email, password_hash="not-used", name="Quota test", plan="free")
        db.add(user)
        await db.flush()
        chat = Chat(user_id=user.id, title="quota smoke")
        db.add(chat)
        await db.flush()
        db.add(
            Message(
                chat_id=chat.id,
                user_id=user.id,
                role=Role.assistant,
                content="already used",
                status=MessageStatus.completed,
            )
        )
        await db.commit()

        try:
            await check_message_quota(db, user)
        except HTTPException as exc:
            assert exc.status_code == 403
            assert "администратору ai-ch" in str(exc.detail).lower()
        else:
            raise AssertionError("quota did not block at the configured limit")

        user.usage_reset_at = utcnow()
        await db.commit()
        await check_message_quota(db, user)

    await engine.dispose()
    print("RUNTIME_SMOKE_OK: admin, task chains, quota blocking and reset")


if __name__ == "__main__":
    asyncio.run(main())

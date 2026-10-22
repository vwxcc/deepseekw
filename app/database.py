"""Async SQLAlchemy engine, session factory and table creation."""
from __future__ import annotations

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from .config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "connect")
def _enable_sqlite_fk(dbapi_conn, _record) -> None:
    """SQLite does not enforce foreign keys unless the pragma is set per connection."""
    try:
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()
    except Exception:
        pass


async def init_db() -> None:
    from . import models  # noqa: F401  (register all models on Base.metadata)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # lightweight forward migrations for columns added after the first release
        for table, cols in _MIGRATIONS.items():
            res = await conn.exec_driver_sql(f"PRAGMA table_info({table})")
            existing = {row[1] for row in res.fetchall()}
            for name, ddl in cols.items():
                if name not in existing:
                    await conn.exec_driver_sql(
                        f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"
                    )
        # Normalize the title key in Python for Unicode-safe case-insensitive matching.
        # Resolve pre-existing case-only collisions deterministically before the unique index.
        title_table = await conn.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table' AND name='ready_answer_titles'")
        if title_table.fetchone():
            needs_normalization = (await conn.exec_driver_sql(
                "SELECT 1 FROM ready_answer_titles "
                "WHERE normalized_title = '' OR title != normalized_title LIMIT 1"
            )).first()
            if needs_normalization:
                rows = (await conn.exec_driver_sql(
                    "SELECT id, title FROM ready_answer_titles ORDER BY created_at, id"
                )).fetchall()
                seen_normalized: set[str] = set()
                for title_id, title_value in rows:
                    normalized = str(title_value or "").strip().casefold()
                    if not normalized or normalized in seen_normalized:
                        await conn.exec_driver_sql(
                            "DELETE FROM ready_answer_titles WHERE id = ?", (title_id,)
                        )
                        continue
                    seen_normalized.add(normalized)
                    await conn.exec_driver_sql(
                        "UPDATE ready_answer_titles SET title = ?, normalized_title = ? WHERE id = ?",
                        (normalized, normalized, title_id),
                    )
            await conn.exec_driver_sql(
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_ready_answer_titles_normalized "
                "ON ready_answer_titles (normalized_title)"
            )

        await conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_chats_share_token ON chats (share_token)"
        )
        # Budget checks filter usage by user and rolling timestamp window.
        await conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_usage_events_user_created_at "
            "ON usage_events (user_id, created_at)"
        )


# table -> {column: ddl}
_MIGRATIONS: dict[str, dict[str, str]] = {
    "chats": {
        "share_token": "VARCHAR(64)",
        "is_public": "BOOLEAN DEFAULT 0",
        "summary": "TEXT",
        "summary_upto": "VARCHAR(36)",
        "effort": "VARCHAR(16) DEFAULT 'recommended'",
        "mode": "VARCHAR(16) DEFAULT 'chat'",
        "model_name": "VARCHAR(200)",
        "model_set_id": "VARCHAR(36)",
        "bundle_id": "VARCHAR(36)",
        "source_chat_id": "VARCHAR(36)",
        "source_chat_title": "VARCHAR(255)",
        "compress_count": "INTEGER DEFAULT 0",
        "compress_date": "VARCHAR(10)",
        "is_pinned": "BOOLEAN DEFAULT 0",
        "project_id": "VARCHAR(36)",
    },
    "messages": {
        "tokens_cached": "INTEGER DEFAULT 0",
        "rating": "INTEGER DEFAULT 0",
        "sources": "TEXT",
        "tool_runs": "TEXT",
        "execution_target": "VARCHAR(16) DEFAULT 'site'",
    },
    "memories": {
        "kind": "VARCHAR(16) DEFAULT 'fact'",
    },
    "model_sets": {
        "is_router": "BOOLEAN DEFAULT 0",
        "description": "TEXT DEFAULT ''",
        "free_access": "BOOLEAN DEFAULT 1",
        "is_default": "BOOLEAN DEFAULT 0",
    },
    "plan_limits": {
        "text_value": "TEXT",
    },
    "model_set_entries": {
        "context_len": "INTEGER DEFAULT 0",
        "price_in": "FLOAT DEFAULT 0",
        "price_out": "FLOAT DEFAULT 0",
        "price_cache": "FLOAT DEFAULT 0",
        "max_parallel": "INTEGER DEFAULT 2",
    },
    "ready_answer_tasks": {
        "position": "INTEGER DEFAULT 0",
    },
    "ready_answer_titles": {
        "normalized_title": "VARCHAR(2000) DEFAULT ''",
    },
    "ready_answer_settings": {
        "lookup_enabled": "BOOLEAN DEFAULT 1",
    },
    "users": {
        "avatar": "INTEGER DEFAULT 0",
        "github_user": "VARCHAR(120)",
        "github_token": "VARCHAR(255)",
        "usage_reset_at": "DATETIME",
        "is_guest": "BOOLEAN DEFAULT 0",
    },
}

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
        await conn.exec_driver_sql(
            "CREATE INDEX IF NOT EXISTS ix_chats_share_token ON chats (share_token)"
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
        "bundle_id": "VARCHAR(36)",
        "compress_count": "INTEGER DEFAULT 0",
        "compress_date": "VARCHAR(10)",
    },
    "messages": {
        "tokens_cached": "INTEGER DEFAULT 0",
        "rating": "INTEGER DEFAULT 0",
        "sources": "TEXT",
        "tool_runs": "TEXT",
    },
    "memories": {
        "kind": "VARCHAR(16) DEFAULT 'fact'",
    },
    "model_sets": {
        "is_router": "BOOLEAN DEFAULT 0",
    },
    "plan_limits": {
        "text_value": "TEXT",
    },
    "model_set_entries": {
        "context_len": "INTEGER DEFAULT 0",
    },
    "users": {
        "avatar": "INTEGER DEFAULT 0",
        "github_user": "VARCHAR(120)",
        "github_token": "VARCHAR(255)",
    },
}

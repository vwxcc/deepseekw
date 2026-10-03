# ChatStudio

Приватный AI-воркспейс в стиле Claude/ChatGPT на собственном сервере.

## Стек

- **Backend:** FastAPI + async SQLAlchemy + SQLite (aiosqlite)
- **AI:** AI Router (OpenAI-совместимый провайдер) + Model Sets с fallback
- **Frontend:** vanilla SPA, раздаётся FastAPI

## Запуск (Docker)

```bash
docker build -t chatstudio-v2:latest .
docker run -d --name chatstudio-v2 --restart unless-stopped \
  --env-file .env -p 3050:8000 \
  -v "$PWD/data:/app/data" -v "$PWD/uploads:/app/uploads" \
  -w /app chatstudio-v2:latest
```

## Конфигурация

См. `.env.example`. Минимум — `SESSION_SECRET` и `QWEN_API_KEY`.

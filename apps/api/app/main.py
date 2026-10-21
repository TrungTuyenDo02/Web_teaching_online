import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import (
    assistant,
    health,
    me,
    reports,
    sessions,
    students,
    teaching_notes,
    weekly_slots,
)
from app.services import no_show

logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper())
    missing = settings.missing_required()
    if missing and settings.is_production:
        raise RuntimeError(f"Thiếu biến môi trường bắt buộc: {', '.join(missing)}")
    if missing:
        logger.warning(
            "Chưa cấu hình: %s (chỉ chấp nhận ở môi trường development)", ", ".join(missing)
        )
    task = None
    if settings.no_show_interval_seconds > 0 and settings.supabase_service_role_key:
        task = asyncio.create_task(no_show.run_forever(settings))
    yield
    if task:
        task.cancel()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=f"{settings.app_name} API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(health.router)
    app.include_router(assistant.router)
    app.include_router(me.router)
    app.include_router(sessions.router)
    app.include_router(students.router)
    app.include_router(reports.router)
    app.include_router(teaching_notes.router)
    app.include_router(weekly_slots.router)
    return app


app = create_app()

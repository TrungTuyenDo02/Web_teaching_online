import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import health, me, sessions

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
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=f"{settings.app_name} API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST", "PATCH"],
        allow_headers=["Authorization", "Content-Type"],
    )
    app.include_router(health.router)
    app.include_router(me.router)
    app.include_router(sessions.router)
    return app


app = create_app()

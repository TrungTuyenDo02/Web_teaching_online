"""Chat có quyền và quản lý bài giảng RAG, không phải đường ghi nghiệp vụ của agent."""

from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.assistant_models import (
    AssistantAnswer,
    AssistantMaterial,
    AssistantQuestion,
    MaterialInput,
)
from app.auth import AuthUser, get_current_user
from app.config import Settings, get_settings
from app.core import time as clock
from app.repo import Repository, get_repo
from app.routers.sessions import require_teacher
from app.services import assistant, llm

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.get("/status")
async def status(
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
    settings: Settings = Depends(get_settings),
):
    """Cho biết chat đã bật/cấu hình chưa; không trả key, model hay dữ liệu riêng."""
    profile = await repo.get_profile(user.id)
    if not profile:
        raise HTTPException(404, "Không tìm thấy hồ sơ")
    return {
        "enabled": bool(
            settings.assistant_enabled and settings.openai_api_key and settings.openai_chat_model
        ),
        "student_lessons": settings.assistant_student_lessons_enabled,
        "daily_limit": min(max(settings.assistant_daily_user_turns, 1), 1000),
    }


@router.post("/chat", response_model=AssistantAnswer)
async def chat(
    body: AssistantQuestion,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
    settings: Settings = Depends(get_settings),
):
    """Agent chỉ đọc, nguồn bị lọc quyền trước khi gửi OpenAI; không lưu chat."""
    if not (settings.assistant_enabled and settings.openai_api_key and settings.openai_chat_model):
        raise HTTPException(503, "Trợ lý AI chưa được bật hoặc cấu hình.")
    profile = await repo.get_profile(user.id)
    if not profile:
        raise HTTPException(404, "Không tìm thấy hồ sơ")
    try:
        allowed = await repo.reserve_assistant_turn(
            profile.id,
            clock.as_vietnam(clock.now_utc()).date(),
            settings.assistant_daily_user_turns,
            settings.assistant_daily_total_turns,
        )
        if not allowed:
            raise HTTPException(429, "Đã hết lượt trợ lý AI hôm nay. Hãy thử lại vào ngày mai.")
        return await assistant.chat(repo, profile, body, settings)
    except llm.LLMUnavailable:
        raise HTTPException(502, "Trợ lý AI chưa trả lời được. Hãy thử lại sau.") from None
    except httpx.HTTPError:
        raise HTTPException(503, "Chưa truy xuất được kho tài liệu. Hãy thử lại sau.") from None


@router.get("/materials", response_model=list[AssistantMaterial])
async def materials(
    user: AuthUser = Depends(get_current_user), repo: Repository = Depends(get_repo)
):
    """Giáo viên xem kho bài giảng của mình; không dùng ghi chú riêng làm bài giảng."""
    await require_teacher(user, repo, "Chỉ giáo viên được quản lý tài liệu")
    return await repo.list_assistant_materials(user.id)


@router.get("/materials/{material_id}", response_model=AssistantMaterial)
async def material(
    material_id: UUID,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
    settings: Settings = Depends(get_settings),
):
    """Đọc nguồn đúng quyền; người khác hoặc HS chưa được bật bài giảng nhận 404."""
    profile = await repo.get_profile(user.id)
    if not profile or (
        profile.role == "student" and not settings.assistant_student_lessons_enabled
    ):
        raise HTTPException(404, "Không tìm thấy tài liệu")
    rows = await repo.list_assistant_materials(user.id)
    found = next((r for r in rows if r.id == str(material_id)), None)
    if not found:
        raise HTTPException(404, "Không tìm thấy tài liệu")
    return found


@router.post("/materials", response_model=AssistantMaterial)
async def create_material(
    body: MaterialInput,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
):
    """Giáo viên nhập bài giảng văn bản, gắn chủ đề; không nhập lời giải hay dữ liệu cá nhân."""
    await require_teacher(user, repo, "Chỉ giáo viên được quản lý tài liệu")
    row = await repo.create_assistant_material(user.id, body)
    if not row:
        raise HTTPException(404, "Không tìm thấy chủ đề")
    return row


@router.delete("/materials/{material_id}", status_code=204)
async def delete_material(
    material_id: UUID,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
):
    """Giáo viên gỡ bài giảng và các chunk theo FK; không giữ trong kho model bên ngoài."""
    await require_teacher(user, repo, "Chỉ giáo viên được quản lý tài liệu")
    if not await repo.delete_assistant_material(user.id, str(material_id)):
        raise HTTPException(404, "Không tìm thấy tài liệu")

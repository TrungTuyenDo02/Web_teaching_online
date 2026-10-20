"""Ghi chú riêng và chủ đề sau buổi, dùng chung cho form và Teacher-Ops sau này."""

import re
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.auth import AuthUser, get_current_user
from app.core import time as clock
from app.models import TeachingNoteRequest, TeachingRecord, TeachingTopic, TeachingTopicRequest
from app.repo import Repository, get_repo
from app.routers.sessions import require_teacher

router = APIRouter(prefix="/api", tags=["teaching-notes"])


async def _own_session(repo: Repository, user: AuthUser, session_id: str):
    profile = await repo.get_profile(user.id)
    session = await repo.get_session(session_id)
    if not profile or profile.role != "teacher" or not session or session.teacher_id != user.id:
        raise HTTPException(404, "Không tìm thấy buổi học")
    student = await repo.get_student(session.student_id)
    if not student or student.teacher_id != user.id or student.deleting_at is not None:
        raise HTTPException(404, "Không tìm thấy buổi học")
    return session


@router.get("/topics", response_model=list[TeachingTopic])
async def list_topics(
    user: AuthUser = Depends(get_current_user), repo: Repository = Depends(get_repo)
):
    """Giáo viên xem danh mục chủ đề của mình; không phải danh sách học sinh đã được dạy."""
    teacher = await require_teacher(user, repo, "Chỉ giáo viên được xem chủ đề")
    return await repo.list_teaching_topics(teacher.id)


@router.post("/topics", response_model=TeachingTopic)
async def create_topic(
    body: TeachingTopicRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
):
    """Giáo viên tạo chủ đề. Tên/lớp giống hệt đã có thì trả lại cùng chủ đề."""
    teacher = await require_teacher(user, repo, "Chỉ giáo viên được tạo chủ đề")
    return await repo.create_teaching_topic(teacher.id, body.name, body.grade)


@router.get("/sessions/{session_id}/teaching-note", response_model=TeachingRecord)
async def get_note(
    session_id: UUID,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
):
    """Chỉ giáo viên sở hữu xem ghi chú riêng/chủ đề của một buổi đã completed; người khác 404."""
    session = await _own_session(repo, user, str(session_id))
    if session.status != "completed":
        raise HTTPException(409, "Chỉ ghi chú sau khi buổi học đã kết thúc")
    record = await repo.get_teaching_record(user.id, session.id)
    if record is None:
        raise HTTPException(404, "Không tìm thấy buổi học")
    return record


@router.put("/sessions/{session_id}/teaching-note", response_model=TeachingRecord)
async def save_note(
    session_id: UUID,
    body: TeachingNoteRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
):
    """Lưu ghi chú và thay toàn bộ chủ đề nguyên tử. Phiên bản cũ trả 409, không ghi đè tab khác."""
    await _own_session(repo, user, str(session_id))
    result, record = await repo.save_teaching_record(user.id, str(session_id), body)
    errors = {
        "not_found": (404, "Không tìm thấy buổi học"),
        "not_completed": (409, "Chỉ ghi chú sau khi buổi học đã kết thúc"),
        "conflict": (409, "Ghi chú đã thay đổi ở tab khác. Hãy tải lại trước khi sửa tiếp."),
        "invalid_topics": (422, "Có chủ đề không hợp lệ. Hãy tải lại danh mục và chọn lại."),
    }
    if result in errors:
        code, message = errors[result]
        raise HTTPException(code, message)
    if result != "ok" or record is None:
        raise HTTPException(502, "Chưa lưu được ghi chú, hãy tải lại để kiểm tra trước khi thử lại")
    return record


@router.get("/students/{student_id}/teaching-notes", response_model=list[TeachingRecord])
async def student_notes(
    student_id: UUID,
    month: str,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
):
    """Giáo viên xem/xuất ghi chú riêng của buổi completed trong tháng VN. HS không được đọc."""
    teacher = await require_teacher(user, repo, "Chỉ giáo viên được xem ghi chú riêng")
    student = await repo.get_student(str(student_id))
    if not student or student.teacher_id != teacher.id or student.deleting_at is not None:
        raise HTTPException(404, "Không tìm thấy học sinh")
    try:
        if not re.fullmatch(r"\d{4}-\d{2}", month):
            raise ValueError
        start, end = clock.month_bounds_utc(*map(int, month.split("-")))
    except (ValueError, OverflowError):
        raise HTTPException(422, "Tháng không hợp lệ, dùng định dạng YYYY-MM") from None
    return await repo.list_teaching_records(teacher.id, student.id, start, end)

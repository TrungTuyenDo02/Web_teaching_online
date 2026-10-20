"""Lịch cố định hằng tuần (M1a.3): giáo viên tạo/ngừng lịch, API sinh buổi học. Teacher-Ops sau này
gọi cùng các hàm này, không có đường ghi riêng."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import AuthUser, get_current_user
from app.core import time as clock
from app.models import (
    WeeklySlot,
    WeeklySlotCreate,
    WeeklySlotCreated,
    WeeklySlotStop,
    WeeklySlotStopped,
)
from app.repo import Repository, get_repo
from app.routers.sessions import require_teacher
from app.services import weekly_slots

router = APIRouter(prefix="/api/weekly-slots", tags=["weekly-slots"])


@router.get("", response_model=list[WeeklySlot])
async def list_slots(
    user: AuthUser = Depends(get_current_user), repo: Repository = Depends(get_repo)
):
    teacher = await require_teacher(user, repo, "Chỉ giáo viên được xem lịch cố định")
    return await repo.list_weekly_slots(teacher.id)


@router.post("", response_model=WeeklySlotCreated, status_code=201)
async def create_slot(
    body: WeeklySlotCreate,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
):
    """Tạo lịch và sinh ngay các buổi 4 tuần tới; ngày trùng buổi khác được bỏ qua và báo lại."""
    teacher = await require_teacher(user, repo, "Chỉ giáo viên được tạo lịch cố định")
    student = await repo.get_student(str(body.student_id))
    if student is None or student.teacher_id != teacher.id or student.deleting_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy học sinh")
    if not student.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Học sinh đã ngừng dạy")
    now = clock.now_utc()
    slot = await repo.insert_weekly_slot(
        {
            "teacher_id": teacher.id,
            "student_id": student.id,
            "weekday": body.weekday,
            "start_time": body.start_time,
            "duration_minutes": body.duration_minutes,
            "subject": body.subject or None,
            "topic": body.topic or None,
            "starts_on": body.starts_on or clock.as_vietnam(now).date(),
        }
    )
    result = await weekly_slots.fill_slot(repo, slot, now)
    return WeeklySlotCreated(slot=slot, created=len(result.created), skipped=result.skipped)


@router.patch("/{slot_id}", response_model=WeeklySlotStopped)
async def stop_slot(
    slot_id: UUID,
    _body: WeeklySlotStop,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
):
    """Ngừng lịch: không sinh thêm, hủy các buổi sắp tới của lịch (buổi đã học giữ nguyên)."""
    teacher = await require_teacher(user, repo, "Chỉ giáo viên được ngừng lịch cố định")
    slot = await repo.get_weekly_slot(str(slot_id))
    if slot is None or slot.teacher_id != teacher.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lịch cố định")
    # Ngừng trước rồi mới hủy: vòng lặp nền đọc sau đó không sinh thêm (lần sinh xen giữa: fill_all)
    stopped = await repo.update_weekly_slot(slot.id, {"active": False})
    if stopped is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy lịch cố định")
    cancelled = await repo.cancel_future_slot_sessions(slot.id, clock.now_utc())
    return WeeklySlotStopped(slot=stopped, cancelled=cancelled)

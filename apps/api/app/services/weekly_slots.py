"""Sinh buổi học từ lịch cố định hằng tuần (M1a.3). Giờ nghiệp vụ theo Việt Nam (app/core/time.py).

Chống sinh trùng bằng ràng buộc unique (slot_id, slot_date) trong DB, không bằng khóa trong RAM:
nhiều tiến trình cùng sinh vẫn chỉ có một buổi cho mỗi ngày của lịch. Buổi đã sinh rồi bị hủy hay
dời giờ vẫn giữ (slot_id, slot_date) nên không bị sinh lại.
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.core import time as clock
from app.models import WeeklySlot
from app.repo import Repository

logger = logging.getLogger("app.weekly_slots")

HORIZON = timedelta(days=28)


@dataclass
class FillResult:
    created: list[datetime] = field(default_factory=list)
    skipped: list[datetime] = field(default_factory=list)  # trùng giờ buổi khác: không ghi đè


async def fill_slot(
    repo: Repository, slot: WeeklySlot, now: datetime, horizon: timedelta = HORIZON
) -> FillResult:
    """Sinh các buổi còn thiếu của lịch từ nay tới hết `horizon`; gọi lại nhiều lần vẫn an toàn."""
    result = FillResult()
    if not slot.active:
        return result
    student = await repo.get_student(slot.student_id)
    if (
        student is None
        or student.teacher_id != slot.teacher_id
        or not student.active
        or student.deleting_at is not None
    ):
        return result
    first = max(clock.as_vietnam(now).date(), slot.starts_on)
    last = clock.as_vietnam(now + horizon).date()
    existing = await repo.list_slot_dates(slot.id)
    hour, minute = map(int, slot.start_time.split(":"))
    day = first + timedelta(days=(slot.weekday - 1 - first.weekday()) % 7)
    while day <= last:
        start = clock.vietnam_to_utc(day, hour, minute)
        if day not in existing and start > now:
            end = start + timedelta(minutes=slot.duration_minutes)
            clash = await repo.find_overlapping_session(slot.teacher_id, start, end)
            if clash is not None and (clash.slot_id, clash.slot_date) != (slot.id, day):
                result.skipped.append(start)
            elif clash is None and await repo.insert_slot_session(
                {
                    "teacher_id": slot.teacher_id,
                    "student_id": slot.student_id,
                    "subject": slot.subject,
                    "topic": slot.topic,
                    "scheduled_start": start,
                    "scheduled_end": end,
                    "slot_id": slot.id,
                    "slot_date": day,
                }
            ):
                result.created.append(start)
        day += timedelta(days=7)
    return result


async def fill_all(repo: Repository, now: datetime) -> int:
    """Vòng lặp nền: bổ sung buổi cho mọi lịch đang dùng, trả số buổi vừa sinh; lỗi để lần sau.

    Lịch đã ngừng: hủy lại buổi tương lai còn scheduled. Chỉ có khi vòng lặp sinh đúng lúc giáo viên
    ngừng lịch (đọc thấy lịch còn dùng rồi ghi sau lần hủy).
    shortcut: duyệt mọi lịch mỗi chu kỳ, đủ cho một giáo viên vài chục học sinh; nhiều hơn thì lọc
    lịch đã ngừng lâu.
    """
    created = 0
    for slot in await repo.list_all_weekly_slots():
        try:
            if slot.active:
                created += len((await fill_slot(repo, slot, now)).created)
            else:
                await repo.cancel_future_slot_sessions(slot.id, now)
        except Exception:
            logger.exception("Chưa sinh được buổi học của lịch cố định %s", slot.id)
    return created

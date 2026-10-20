"""Báo cáo xác định dùng chung cho giao diện và Teacher-Ops sau này."""

import re

from app.core import time as clock
from app.models import MonthlySessionReport, MonthlyStudentCount
from app.repo import Repository


class InvalidReportMonth(ValueError):
    pass


async def monthly_sessions(
    repo: Repository, teacher_id: str, month: str | None = None
) -> MonthlySessionReport:
    if month is None:
        month = clock.as_vietnam(clock.now_utc()).strftime("%Y-%m")
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise InvalidReportMonth("Tháng không hợp lệ, dùng định dạng YYYY-MM")
    try:
        year, number = map(int, month.split("-"))
        start, end = clock.month_bounds_utc(year, number)
    except (ValueError, OverflowError):
        raise InvalidReportMonth("Tháng không hợp lệ, dùng định dạng YYYY-MM") from None
    counts = await repo.count_completed_sessions_in_period(teacher_id, start, end)
    students = [
        MonthlyStudentCount(
            student_id=s.id,
            full_name=s.full_name,
            grade=s.grade,
            active=s.active,
            completed_sessions=counts.get(s.id, 0),
        )
        for s in await repo.list_students(teacher_id)
        if s.deleting_at is None
    ]
    return MonthlySessionReport(
        month=month,
        period_start=start,
        period_end=end,
        total=sum(s.completed_sessions for s in students),
        students=students,
    )

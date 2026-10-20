import asyncio
import functools
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from app.core.time import month_bounds_utc
from app.models import SessionStatus
from app.repo import SupabaseRepository
from tests.conftest import (
    FOREIGN_STUDENT_ID,
    OTHER_STUDENT_ID,
    OTHER_TEACHER_ID,
    SESSION_ID,
    STUDENT_ID,
    STUDENT_PROFILE_ID,
    TEACHER_ID,
    auth_header,
)


def test_report_respects_vietnam_month_status_owner_and_deleting_students(client, repo, settings):
    start, end = month_bounds_utc(2026, 10)
    template = repo.sessions[SESSION_ID]
    repo.sessions.clear()
    rows = [
        ("before", start - timedelta(seconds=1), SessionStatus.completed, STUDENT_ID, TEACHER_ID),
        ("first", start, SessionStatus.completed, STUDENT_ID, TEACHER_ID),
        ("last", end - timedelta(seconds=1), SessionStatus.completed, STUDENT_ID, TEACHER_ID),
        ("after", end, SessionStatus.completed, STUDENT_ID, TEACHER_ID),
        ("live", start, SessionStatus.live, STUDENT_ID, TEACHER_ID),
        ("cancel", start, SessionStatus.cancelled, STUDENT_ID, TEACHER_ID),
        ("scheduled", start, SessionStatus.scheduled, STUDENT_ID, TEACHER_ID),
        ("absent", start, SessionStatus.no_show, STUDENT_ID, TEACHER_ID),
        ("foreign", start, SessionStatus.completed, FOREIGN_STUDENT_ID, OTHER_TEACHER_ID),
        ("deleting", start, SessionStatus.completed, OTHER_STUDENT_ID, TEACHER_ID),
    ]
    for key, when, status, student, teacher in rows:
        repo.sessions[key] = template.model_copy(
            update={
                "id": key,
                "student_id": student,
                "teacher_id": teacher,
                "scheduled_start": when,
                "status": status,
            }
        )
    repo.students[OTHER_STUDENT_ID].deleting_at = start
    repo.students[STUDENT_ID].active = False
    resp = client.get(
        "/api/reports/sessions?month=2026-10", headers=auth_header(settings, TEACHER_ID)
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2  # finalized_at/attendance không đổi định nghĩa completed hiện có
    assert body["period_start"] == start.isoformat().replace("+00:00", "Z")
    assert body["timezone"] == "Asia/Ho_Chi_Minh"
    assert {row["student_id"] for row in body["students"]} == {
        STUDENT_ID,
        "dddddddd-dddd-dddd-dddd-dddddddddddd",
    }
    assert (
        next(r for r in body["students"] if r["student_id"] == STUDENT_ID)["completed_sessions"]
        == 2
    )
    assert "notes" not in str(body) and "guardian" not in str(body)
    assert next(r for r in body["students"] if r["student_id"] == STUDENT_ID)["active"] is False
    assert any(row["completed_sessions"] == 0 for row in body["students"])


def test_student_cannot_read_teacher_report(client, settings):
    resp = client.get(
        "/api/reports/sessions?month=2026-10", headers=auth_header(settings, STUDENT_PROFILE_ID)
    )
    assert resp.status_code == 403


@pytest.mark.parametrize(
    "month", ["2026-13", "2026-00", "2026-1", "0000-01", "0001-01", "9999-12", "abc"]
)
def test_invalid_month_returns_vietnamese_error(client, settings, month):
    resp = client.get(
        f"/api/reports/sessions?month={month}", headers=auth_header(settings, TEACHER_ID)
    )
    assert resp.status_code == 422 and "Tháng không hợp lệ" in resp.json()["detail"]


def test_default_month_uses_vietnam_day(client, repo, settings, clock):
    clock.t = datetime(2026, 9, 30, 18, tzinfo=UTC).timestamp()
    resp = client.get("/api/reports/sessions", headers=auth_header(settings, TEACHER_ID))
    assert resp.status_code == 200 and resp.json()["month"] == "2026-10"


def test_repository_filters_and_paginates_until_empty(monkeypatch, settings):
    original = httpx.AsyncClient
    offsets = []
    start, end = month_bounds_utc(2026, 10)

    def handler(request):
        params = request.url.params
        assert params["teacher_id"] == f"eq.{TEACHER_ID}"
        assert params["status"] == "eq.completed"
        assert (
            params["and"]
            == f"(scheduled_start.gte.{start.isoformat()},scheduled_start.lt.{end.isoformat()})"
        )
        assert params["order"] == "id.asc"
        offset = int(params["offset"])
        offsets.append(offset)
        # Mô phỏng server chỉ trả 2 hàng dù client xin tối đa 500: không được đếm thiếu
        page = [{"student_id": STUDENT_ID}] * 2 if offset < 4 else []
        return httpx.Response(200, json=page)

    monkeypatch.setattr(
        "app.repo.httpx.AsyncClient",
        functools.partial(original, transport=httpx.MockTransport(handler)),
    )
    result = asyncio.run(
        SupabaseRepository(settings).count_completed_sessions_in_period(TEACHER_ID, start, end)
    )
    assert result == {STUDENT_ID: 4} and offsets == [0, 2, 4]

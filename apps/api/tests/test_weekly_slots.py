"""M1a.3 lịch lặp hằng tuần: sinh buổi học từ lịch cố định, không sinh trùng, không đè buổi khác.

Giờ nghiệp vụ theo Việt Nam (UTC+7). Mốc thử: thứ Hai 19/10/2026 08:00 giờ VN.
"""

import asyncio
from datetime import UTC, date, datetime, timedelta

import pytest

from app.models import SessionStatus
from app.services import weekly_slots
from tests.conftest import (
    FOREIGN_STUDENT_ID,
    OTHER_TEACHER_ID,
    SESSION_ID,
    STUDENT_ID,
    STUDENT_PROFILE_ID,
    TEACHER_ID,
    auth_header,
)

MONDAY_8AM_VN = datetime(2026, 10, 19, 1, 0, tzinfo=UTC)
URL = "/api/weekly-slots"


@pytest.fixture
def now(clock):
    clock.t = MONDAY_8AM_VN.timestamp()
    return clock


@pytest.fixture
def teacher(settings):
    return auth_header(settings, TEACHER_ID)


def slot_body(**overrides):
    body = {
        "student_id": STUDENT_ID,
        "weekday": 3,  # thứ Tư (1 = thứ Hai … 7 = Chủ nhật)
        "start_time": "19:30",
        "duration_minutes": 90,
        "subject": "Toán",
    }
    return body | overrides


def generated(repo, slot_id):
    return sorted(
        (s for s in repo.sessions.values() if getattr(s, "slot_id", None) == slot_id),
        key=lambda s: s.scheduled_start,
    )


def test_create_slot_generates_four_weeks_at_vietnam_time(client, repo, teacher, now):
    resp = client.post(URL, json=slot_body(), headers=teacher)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    slot_id = data["slot"]["id"]
    sessions = generated(repo, slot_id)
    # Thứ Tư 21/10, 28/10, 4/11, 11/11 lúc 19:30 VN = 12:30 UTC, trong 28 ngày tới
    assert [s.scheduled_start for s in sessions] == [
        datetime(2026, m, d, 12, 30, tzinfo=UTC) for m, d in ((10, 21), (10, 28), (11, 4), (11, 11))
    ]
    assert all(s.scheduled_end - s.scheduled_start == timedelta(minutes=90) for s in sessions)
    assert all(s.subject == "Toán" and s.status == SessionStatus.scheduled for s in sessions)
    assert [s.slot_date for s in sessions] == [
        date(2026, 10, 21),
        date(2026, 10, 28),
        date(2026, 11, 4),
        date(2026, 11, 11),
    ]
    assert data["created"] == 4 and data["skipped"] == []


def test_occurrence_later_today_is_created_but_past_one_is_not(client, repo, teacher, now):
    later = client.post(URL, json=slot_body(weekday=1, start_time="20:00"), headers=teacher)
    first = generated(repo, later.json()["slot"]["id"])[0]
    assert first.scheduled_start == datetime(2026, 10, 19, 13, 0, tzinfo=UTC)  # tối nay
    past = client.post(URL, json=slot_body(weekday=1, start_time="06:00"), headers=teacher)
    first = generated(repo, past.json()["slot"]["id"])[0]
    assert first.slot_date == date(2026, 10, 26)  # 6:00 sáng nay đã qua


def test_starts_on_delays_first_occurrence(client, repo, teacher, now):
    resp = client.post(URL, json=slot_body(starts_on="2026-11-01"), headers=teacher)
    assert generated(repo, resp.json()["slot"]["id"])[0].slot_date == date(2026, 11, 4)


def test_overlapping_occurrence_is_skipped_and_reported(client, repo, teacher, now):
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={
            "scheduled_start": datetime(2026, 10, 28, 12, 0, tzinfo=UTC),
            "scheduled_end": datetime(2026, 10, 28, 13, 0, tzinfo=UTC),
        }
    )
    data = client.post(URL, json=slot_body(), headers=teacher).json()
    assert data["created"] == 3
    assert data["skipped"] == ["2026-10-28T12:30:00Z"]
    assert date(2026, 10, 28) not in {s.slot_date for s in generated(repo, data["slot"]["id"])}


def test_filling_again_or_concurrently_never_duplicates(client, repo, teacher, now):
    slot_id = client.post(URL, json=slot_body(), headers=teacher).json()["slot"]["id"]
    slot = asyncio.run(repo.get_weekly_slot(slot_id))

    async def fill_many():
        return await asyncio.gather(
            *(weekly_slots.fill_slot(repo, slot, MONDAY_8AM_VN) for _ in range(5))
        )

    results = asyncio.run(fill_many())
    assert sum(len(r.created) for r in results) == 0
    assert len(generated(repo, slot_id)) == 4


def test_cancelled_or_moved_occurrence_is_not_recreated(client, repo, teacher, now):
    slot_id = client.post(URL, json=slot_body(), headers=teacher).json()["slot"]["id"]
    first, second = generated(repo, slot_id)[:2]
    resp = client.post(f"/api/sessions/{first.id}/cancel", headers=teacher)
    assert resp.status_code == 200
    moved = second.scheduled_start + timedelta(days=1)
    resp = client.patch(
        f"/api/sessions/{second.id}",
        json={
            "scheduled_start": moved.isoformat(),
            "scheduled_end": (moved + timedelta(minutes=90)).isoformat(),
        },
        headers=teacher,
    )
    assert resp.status_code == 200, resp.text
    slot = asyncio.run(repo.get_weekly_slot(slot_id))
    assert asyncio.run(weekly_slots.fill_slot(repo, slot, MONDAY_8AM_VN)).created == []
    assert len(generated(repo, slot_id)) == 4


def test_background_fill_extends_horizon_week_by_week(client, repo, teacher, now):
    slot_id = client.post(URL, json=slot_body(), headers=teacher).json()["slot"]["id"]
    later = MONDAY_8AM_VN + timedelta(days=7)
    assert asyncio.run(weekly_slots.fill_all(repo, later)) == 1
    assert generated(repo, slot_id)[-1].slot_date == date(2026, 11, 18)
    assert asyncio.run(weekly_slots.fill_all(repo, later)) == 0


def test_stopping_slot_cancels_only_its_future_scheduled_sessions(client, repo, teacher, now):
    slot_id = client.post(URL, json=slot_body(), headers=teacher).json()["slot"]["id"]
    first = generated(repo, slot_id)[0]
    repo.sessions[first.id] = first.model_copy(update={"status": SessionStatus.completed})
    resp = client.patch(f"{URL}/{slot_id}", json={"active": False}, headers=teacher)
    assert resp.status_code == 200, resp.text
    assert resp.json()["cancelled"] == 3
    statuses = [s.status for s in generated(repo, slot_id)]
    assert statuses == [SessionStatus.completed] + [SessionStatus.cancelled] * 3
    assert repo.sessions[SESSION_ID].status == SessionStatus.scheduled  # buổi xếp tay giữ nguyên
    later = MONDAY_8AM_VN + timedelta(days=14)
    assert asyncio.run(weekly_slots.fill_all(repo, later)) == 0


@pytest.mark.parametrize("field", ["active", "deleting_at"])
def test_paused_or_deleting_student_gets_no_new_sessions(client, repo, teacher, now, field):
    slot_id = client.post(URL, json=slot_body(), headers=teacher).json()["slot"]["id"]
    change = {"active": False} if field == "active" else {"deleting_at": MONDAY_8AM_VN}
    repo.students[STUDENT_ID] = repo.students[STUDENT_ID].model_copy(update=change)
    assert asyncio.run(weekly_slots.fill_all(repo, MONDAY_8AM_VN + timedelta(days=7))) == 0
    assert len(generated(repo, slot_id)) == 4


def test_list_shows_only_own_slots(client, repo, teacher, settings, now):
    client.post(URL, json=slot_body(), headers=teacher)
    mine = client.get(URL, headers=teacher).json()
    assert [(s["weekday"], s["start_time"], s["active"]) for s in mine] == [(3, "19:30", True)]
    other = client.get(URL, headers=auth_header(settings, OTHER_TEACHER_ID)).json()
    assert other == []


def test_permissions(client, repo, teacher, settings, now):
    student = auth_header(settings, STUDENT_PROFILE_ID)
    assert client.get(URL, headers=student).status_code == 403
    assert client.post(URL, json=slot_body(), headers=student).status_code == 403
    foreign = client.post(URL, json=slot_body(student_id=FOREIGN_STUDENT_ID), headers=teacher)
    assert foreign.status_code == 404
    slot_id = client.post(URL, json=slot_body(), headers=teacher).json()["slot"]["id"]
    other = auth_header(settings, OTHER_TEACHER_ID)
    resp = client.patch(f"{URL}/{slot_id}", json={"active": False}, headers=other)
    assert resp.status_code == 404
    assert all(s.status == SessionStatus.scheduled for s in generated(repo, slot_id))


def test_paused_student_cannot_get_a_new_slot(client, repo, teacher, now):
    repo.students[STUDENT_ID] = repo.students[STUDENT_ID].model_copy(update={"active": False})
    resp = client.post(URL, json=slot_body(), headers=teacher)
    assert resp.status_code == 409 and resp.json()["detail"] == "Học sinh đã ngừng dạy"


@pytest.mark.parametrize(
    "bad",
    [
        {"weekday": 0},
        {"weekday": 8},
        {"start_time": "25:00"},
        {"start_time": "7h"},
        {"duration_minutes": 20},
        {"duration_minutes": 241},
        {"starts_on": "2026-02-30"},
    ],
)
def test_invalid_slot_is_rejected(client, repo, teacher, now, bad):
    resp = client.post(URL, json=slot_body(**bad), headers=teacher)
    assert resp.status_code == 422
    assert not any(getattr(s, "slot_id", None) for s in repo.sessions.values())


def test_student_deletion_removes_slots(client, repo, teacher, now):
    client.post(URL, json=slot_body(), headers=teacher)
    asyncio.run(repo.delete_student(STUDENT_ID))
    assert client.get(URL, headers=teacher).json() == []

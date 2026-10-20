import asyncio
from datetime import UTC, datetime, timedelta

from app.models import SessionStatus
from app.services.no_show import mark_no_show
from tests.conftest import (
    FOREIGN_STUDENT_ID,
    NO_ACCOUNT_STUDENT_ID,
    SESSION_ID,
    STUDENT_ID,
    STUDENT_PROFILE_ID,
    TEACHER_ID,
    auth_header,
)

TOMORROW = datetime.now(UTC).replace(microsecond=0) + timedelta(days=1)


def body(start=TOMORROW, minutes=60, student_id=STUDENT_ID):
    return {
        "student_id": student_id,
        "subject": "Toán",
        "topic": "Phương trình bậc hai",
        "scheduled_start": start.isoformat(),
        "scheduled_end": (start + timedelta(minutes=minutes)).isoformat(),
    }


def post(client, settings, data, user_id=TEACHER_ID):
    return client.post("/api/sessions", json=data, headers=auth_header(settings, user_id))


def cancel(client, settings, session_id, user_id=TEACHER_ID):
    return client.post(f"/api/sessions/{session_id}/cancel", headers=auth_header(settings, user_id))


def test_teacher_creates_session(client, settings, repo):
    resp = post(client, settings, body())
    assert resp.status_code == 201
    created = repo.sessions[resp.json()["id"]]
    assert created.teacher_id == TEACHER_ID and created.student_id == STUDENT_ID
    assert created.status == SessionStatus.scheduled
    assert created.subject == "Toán"


def test_student_cannot_create_session(client, settings):
    assert post(client, settings, body(), STUDENT_PROFILE_ID).status_code == 403


def test_other_teachers_student_is_not_found(client, settings):
    assert post(client, settings, body(student_id=FOREIGN_STUDENT_ID)).status_code == 404


def test_inactive_student_rejected(client, settings, repo):
    repo.students[NO_ACCOUNT_STUDENT_ID] = repo.students[NO_ACCOUNT_STUDENT_ID].model_copy(
        update={"active": False}
    )
    assert post(client, settings, body(student_id=NO_ACCOUNT_STUDENT_ID)).status_code == 409


def test_end_before_start_rejected(client, settings):
    assert post(client, settings, body(minutes=-30)).status_code == 422


def test_too_long_session_rejected(client, settings):
    assert post(client, settings, body(minutes=5 * 60)).status_code == 422


def test_session_already_over_rejected(client, settings):
    start = datetime.now(UTC) - timedelta(hours=3)
    assert post(client, settings, body(start=start)).status_code == 422


def test_time_without_timezone_rejected(client, settings):
    data = body() | {
        "scheduled_start": "2026-10-20T19:00:00",
        "scheduled_end": "2026-10-20T20:00:00",
    }
    assert post(client, settings, data).status_code == 422


def test_overlapping_session_rejected(client, settings):
    assert post(client, settings, body()).status_code == 201
    # bắt đầu giữa buổi trước
    assert post(client, settings, body(start=TOMORROW + timedelta(minutes=30))).status_code == 409
    # nối tiếp ngay sau thì được
    assert post(client, settings, body(start=TOMORROW + timedelta(minutes=60))).status_code == 201


def test_cancelled_session_frees_the_slot(client, settings, repo):
    first = post(client, settings, body()).json()["id"]
    assert cancel(client, settings, first).status_code == 200
    assert repo.sessions[first].status == SessionStatus.cancelled
    assert post(client, settings, body()).status_code == 201


def test_student_cannot_cancel(client, settings):
    assert cancel(client, settings, SESSION_ID, STUDENT_PROFILE_ID).status_code == 403


def test_live_session_cannot_be_cancelled(client, settings, repo):
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={"status": SessionStatus.live}
    )
    assert cancel(client, settings, SESSION_ID).status_code == 409


def test_mark_no_show_only_touches_stale_scheduled(settings, repo):
    now = datetime.now(UTC)
    stale_end = now - timedelta(minutes=settings.join_late_minutes + 1)
    old = repo.sessions[SESSION_ID].model_copy(
        update={"scheduled_start": stale_end - timedelta(hours=1), "scheduled_end": stale_end}
    )
    repo.sessions[SESSION_ID] = old
    repo.sessions["done"] = old.model_copy(update={"id": "done", "status": SessionStatus.completed})
    repo.sessions["late-ok"] = old.model_copy(
        update={"id": "late-ok", "scheduled_end": now - timedelta(minutes=10)}
    )

    assert asyncio.run(mark_no_show(repo, settings, now)) == 1
    assert repo.sessions[SESSION_ID].status == SessionStatus.no_show
    assert repo.sessions["done"].status == SessionStatus.completed
    # vẫn còn trong khung vào muộn: chưa coi là vắng
    assert repo.sessions["late-ok"].status == SessionStatus.scheduled


def patch(client, settings, session_id, data, user_id=TEACHER_ID):
    return client.patch(
        f"/api/sessions/{session_id}", json=data, headers=auth_header(settings, user_id)
    )


def test_teacher_reschedules_session(client, settings, repo):
    sid = post(client, settings, body()).json()["id"]
    later = TOMORROW + timedelta(hours=2)
    resp = patch(
        client,
        settings,
        sid,
        {
            "topic": "Hệ thức Vi-ét",
            "scheduled_start": later.isoformat(),
            "scheduled_end": (later + timedelta(minutes=90)).isoformat(),
        },
    )
    assert resp.status_code == 200
    assert repo.sessions[sid].topic == "Hệ thức Vi-ét"
    assert repo.sessions[sid].scheduled_start == later
    assert repo.sessions[sid].subject == "Toán"  # trường không gửi giữ nguyên


def test_moving_end_only_is_checked_against_existing_start(client, settings):
    sid = post(client, settings, body()).json()["id"]
    early = (TOMORROW - timedelta(minutes=10)).isoformat()
    assert patch(client, settings, sid, {"scheduled_end": early}).status_code == 422


def test_session_does_not_overlap_with_itself(client, settings):
    sid = post(client, settings, body()).json()["id"]
    shifted = TOMORROW + timedelta(minutes=15)
    data = {
        "scheduled_start": shifted.isoformat(),
        "scheduled_end": (shifted + timedelta(hours=1)).isoformat(),
    }
    assert patch(client, settings, sid, data).status_code == 200


def test_reschedule_into_other_session_rejected(client, settings):
    post(client, settings, body())
    other = post(client, settings, body(start=TOMORROW + timedelta(hours=3))).json()["id"]
    assert (
        patch(
            client,
            settings,
            other,
            {
                "scheduled_start": TOMORROW.isoformat(),
                "scheduled_end": (TOMORROW + timedelta(hours=1)).isoformat(),
            },
        ).status_code
        == 409
    )


def test_student_cannot_edit_session(client, settings):
    assert (
        patch(client, settings, SESSION_ID, {"topic": "x"}, STUDENT_PROFILE_ID).status_code == 403
    )


def test_live_session_cannot_be_edited(client, settings, repo):
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={"status": SessionStatus.live}
    )
    assert patch(client, settings, SESSION_ID, {"topic": "x"}).status_code == 409

from datetime import UTC, datetime, timedelta

import jwt

from app.models import DeviceMode, SessionStatus
from tests.conftest import (
    OTHER_STUDENT_PROFILE_ID,
    SESSION_ID,
    STUDENT_PROFILE_ID,
    TEACHER_ID,
    auth_header,
)


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_join_requires_token(client):
    resp = client.post(f"/api/sessions/{SESSION_ID}/join", json={})
    assert resp.status_code == 401


def test_join_rejects_token_signed_with_wrong_secret(client, settings):
    headers = auth_header(settings, TEACHER_ID, secret="x" * 40)
    resp = client.post(f"/api/sessions/{SESSION_ID}/join", json={}, headers=headers)
    assert resp.status_code == 401


def test_teacher_join_returns_livekit_and_board_tokens_and_starts_session(client, settings, repo):
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join", json={}, headers=auth_header(settings, TEACHER_ID)
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["role"] == "teacher" and data["mode"] == "main"

    video = jwt.decode(
        data["livekit"]["token"],
        settings.livekit_api_secret,
        algorithms=["HS256"],
        options={"verify_aud": False},
    )
    assert video["video"]["room"] == "room-test"
    assert video["video"]["roomJoin"] is True

    board = jwt.decode(
        data["whiteboard"]["token"], settings.whiteboard_jwt_secret, algorithms=["HS256"]
    )
    assert board["sid"] == SESSION_ID and board["sub"] == TEACHER_ID and board["mode"] == "main"

    assert repo.sessions[SESSION_ID].status == SessionStatus.live
    assert repo.attendance == [(SESSION_ID, TEACHER_ID, DeviceMode.main)]


def test_board_mode_gets_no_video_token(client, settings):
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join",
        json={"mode": "board"},
        headers=auth_header(settings, TEACHER_ID),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["livekit"] is None
    assert data["whiteboard"]["token"]


def test_student_can_join_own_session_but_does_not_start_it(client, settings, repo):
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join",
        json={},
        headers=auth_header(settings, STUDENT_PROFILE_ID),
    )
    assert resp.status_code == 200
    assert repo.sessions[SESSION_ID].status == SessionStatus.scheduled


def test_other_student_cannot_join(client, settings):
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join",
        json={},
        headers=auth_header(settings, OTHER_STUDENT_PROFILE_ID),
    )
    assert resp.status_code == 404  # không lộ buổi học tồn tại


def test_unknown_user_without_profile_is_forbidden(client, settings):
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join",
        json={},
        headers=auth_header(settings, "99999999-9999-9999-9999-999999999999"),
    )
    assert resp.status_code == 403


def test_join_outside_time_window_is_rejected(client, settings, repo):
    now = datetime.now(UTC)
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={
            "scheduled_start": now + timedelta(hours=3),
            "scheduled_end": now + timedelta(hours=4),
        }
    )
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join", json={}, headers=auth_header(settings, TEACHER_ID)
    )
    assert resp.status_code == 409


def test_cancelled_session_cannot_be_joined(client, settings, repo):
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={"status": SessionStatus.cancelled}
    )
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join", json={}, headers=auth_header(settings, TEACHER_ID)
    )
    assert resp.status_code == 409


def test_end_session_flow(client, settings, repo):
    headers = auth_header(settings, TEACHER_ID)
    # chưa live thì không kết thúc được
    assert (
        client.post(f"/api/sessions/{SESSION_ID}/end", json={}, headers=headers).status_code == 409
    )

    client.post(f"/api/sessions/{SESSION_ID}/join", json={}, headers=headers)
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/end",
        json={"summary": "Hệ phương trình", "homework_note": "Bài 1-5"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert repo.sessions[SESSION_ID].status == SessionStatus.completed


def test_student_cannot_end_session(client, settings):
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/end",
        json={},
        headers=auth_header(settings, STUDENT_PROFILE_ID),
    )
    assert resp.status_code == 403


def test_me_returns_role(client, settings):
    resp = client.get("/api/me", headers=auth_header(settings, STUDENT_PROFILE_ID))
    assert resp.status_code == 200
    assert resp.json()["role"] == "student"

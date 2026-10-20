"""Kết thúc buổi gọi lại được, làm nốt việc đóng phòng khi lỗi, không ghi đè trạng thái."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from app.models import SessionStatus
from app.services.finalize import retry_pending
from tests.conftest import SESSION_ID, STUDENT_ID, TEACHER_ID, auth_header

BOARD = [{"id": "x", "version": 1, "versionNonce": 1}]
PATH = f"{STUDENT_ID}/{SESSION_ID}.json"


def join(client, settings, user=TEACHER_ID, mode="main"):
    return client.post(
        f"/api/sessions/{SESSION_ID}/join", json={"mode": mode}, headers=auth_header(settings, user)
    )


def end(client, settings, body=None):
    return client.post(
        f"/api/sessions/{SESSION_ID}/end",
        json=body or {},
        headers=auth_header(settings, TEACHER_ID),
    )


def completed_count(repo) -> int:
    return sum(1 for s in repo.sessions.values() if s.status == SessionStatus.completed)


def test_end_all_steps_ok_marks_finalized(client, settings, repo, rooms):
    rooms.board_elements = BOARD
    join(client, settings)
    resp = end(client, settings)
    assert resp.status_code == 200 and resp.json()["finalize_pending"] is False
    assert repo.sessions[SESSION_ID].finalized_at is not None


@pytest.mark.parametrize(
    "fail",
    ["livekit", "whiteboard", "upload", "snapshot_path", "attendance"],
)
def test_one_failing_step_keeps_others_and_retry_finishes(client, settings, repo, rooms, fail):
    rooms.board_elements = BOARD
    join(client, settings)
    setattr_fail(repo, rooms, fail, True)
    first = end(client, settings, {"summary": "Hệ phương trình"})
    assert first.status_code == 200
    assert first.json()["finalize_pending"] is True
    session = repo.sessions[SESSION_ID]
    assert session.status == SessionStatus.completed and session.finalized_at is None
    # các bước không lỗi vẫn chạy
    if fail != "livekit":
        assert rooms.livekit == ["room-test"]
    if fail != "whiteboard":
        assert rooms.whiteboard == [SESSION_ID]
    if fail != "attendance":
        assert SESSION_ID in repo.attendance_closed

    # dịch vụ phục hồi, giáo viên bấm thử lại: không tính thêm buổi, làm nốt phần thiếu
    setattr_fail(repo, rooms, fail, False)
    again = end(client, settings)
    assert again.status_code == 200 and again.json()["finalize_pending"] is False
    assert again.json()["ended_at"] == first.json()["ended_at"]
    session = repo.sessions[SESSION_ID]
    assert completed_count(repo) == 1 and session.summary == "Hệ phương trình"
    assert session.finalized_at is not None
    assert repo.board_files[PATH] == BOARD and session.board_snapshot_path == PATH
    assert SESSION_ID in repo.attendance_closed and "room-test" in rooms.livekit


def setattr_fail(repo, rooms, fail: str, value: bool) -> None:
    if fail == "livekit":
        rooms.fail_livekit = value
    elif fail == "whiteboard":
        rooms.fail_whiteboard = value
    elif fail == "upload":
        repo.fail_board_upload = value
    elif fail == "snapshot_path":
        repo.fail_update_fields = {"board_snapshot_path"} if value else set()
    elif fail == "attendance":
        repo.fail_close_attendance = value


def test_end_twice_or_lost_response_counts_one_session(client, settings, repo, rooms):
    join(client, settings)
    first = end(client, settings, {"summary": "Bài 1"})
    second = end(client, settings, {"summary": "Bài 1"})
    assert first.status_code == second.status_code == 200
    assert second.json()["ended_at"] == first.json()["ended_at"]
    assert completed_count(repo) == 1


def test_end_scheduled_or_cancelled_session_is_still_rejected(client, settings, repo):
    assert end(client, settings).status_code == 409  # chưa vào lớp
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={"status": SessionStatus.cancelled}
    )
    assert end(client, settings).status_code == 409


def test_concurrent_end_second_request_finishes_without_overwriting(client, settings, repo):
    join(client, settings)
    earlier = datetime.now(UTC) - timedelta(seconds=5)

    def other_end_commits_first():
        repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
            update={"status": SessionStatus.completed, "ended_at": earlier, "summary": "Lần 1"}
        )

    repo.before_next_update = other_end_commits_first
    resp = end(client, settings, {"summary": "Lần 2"})
    assert resp.status_code == 200
    session = repo.sessions[SESSION_ID]
    assert session.summary == "Lần 1" and session.ended_at == earlier
    assert session.finalized_at is not None


def test_stale_teacher_join_cannot_reopen_completed_session(client, settings, repo):
    # Thiết bị khác đã vào lớp và kết thúc trong lúc yêu cầu join này đang chạy
    def ended_meanwhile():
        repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
            update={"status": SessionStatus.completed, "ended_at": datetime.now(UTC)}
        )

    repo.before_next_update = ended_meanwhile
    resp = join(client, settings)
    assert resp.status_code == 409
    assert repo.sessions[SESSION_ID].status == SessionStatus.completed
    assert repo.attendance == []


def test_join_cannot_reopen_session_cancelled_meanwhile(client, settings, repo):
    def cancelled_meanwhile():
        repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
            update={"status": SessionStatus.cancelled}
        )

    repo.before_next_update = cancelled_meanwhile
    assert join(client, settings).status_code == 409
    assert repo.sessions[SESSION_ID].status == SessionStatus.cancelled


def test_two_teacher_devices_joining_together_both_get_in(client, settings, repo):
    def laptop_started_it():
        repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
            update={"status": SessionStatus.live, "started_at": datetime.now(UTC)}
        )

    repo.before_next_update = laptop_started_it
    resp = join(client, settings, mode="board")
    assert resp.status_code == 200
    assert repo.sessions[SESSION_ID].status == SessionStatus.live


@pytest.mark.parametrize("action", ["cancel", "edit"])
def test_cancel_or_edit_does_not_overwrite_session_started_meanwhile(
    client, settings, repo, action
):
    before = repo.sessions[SESSION_ID]

    def teacher_joined_meanwhile():
        repo.sessions[SESSION_ID] = before.model_copy(update={"status": SessionStatus.live})

    repo.before_next_update = teacher_joined_meanwhile
    headers = auth_header(settings, TEACHER_ID)
    if action == "cancel":
        resp = client.post(f"/api/sessions/{SESSION_ID}/cancel", headers=headers)
    else:
        resp = client.patch(f"/api/sessions/{SESSION_ID}", json={"topic": "Mới"}, headers=headers)
    assert resp.status_code == 409
    session = repo.sessions[SESSION_ID]
    assert session.status == SessionStatus.live and session.topic == before.topic


def test_background_retry_finishes_sessions_left_pending_by_api_restart(settings, repo, rooms):
    # API ghi completed rồi tắt trước khi đóng phòng, lưu bảng
    ended = datetime.now(UTC) - timedelta(minutes=10)
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={"status": SessionStatus.completed, "ended_at": ended}
    )
    rooms.board_elements = BOARD
    assert asyncio.run(retry_pending(repo, settings, datetime.now(UTC))) == 1
    session = repo.sessions[SESSION_ID]
    assert session.finalized_at is not None and session.board_snapshot_path == PATH
    assert rooms.livekit == ["room-test"] and repo.attendance_closed[SESSION_ID] == ended
    # đã xong thì lần sau không làm lại
    assert asyncio.run(retry_pending(repo, settings, datetime.now(UTC))) == 0
    assert rooms.whiteboard == [SESSION_ID]


def test_background_retry_skips_session_just_ended(settings, repo, rooms):
    # yêu cầu /end vừa ghi completed và đang tự đóng phòng: không chạy chồng
    now = datetime.now(UTC)
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={"status": SessionStatus.completed, "ended_at": now}
    )
    assert asyncio.run(retry_pending(repo, settings, now)) == 0
    assert rooms.whiteboard == []

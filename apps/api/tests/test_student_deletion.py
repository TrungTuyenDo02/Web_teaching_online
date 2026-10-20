"""Xóa hẳn học sinh: dọn bảng, tệp, tài khoản, dữ liệu; lỗi giữa chừng thì làm tiếp được."""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from app.models import DeviceMode, SessionStatus
from app.services.finalize import retry_pending
from app.services.student_deletion import retry_pending_deletions
from tests.conftest import (
    OTHER_STUDENT_ID,
    SESSION_ID,
    STUDENT_ID,
    STUDENT_PROFILE_ID,
    TEACHER_ID,
    auth_header,
)

PATH = f"/api/students/{STUDENT_ID}"
OWN_BOARD = f"{STUDENT_ID}/{SESSION_ID}.json"
OWN_SUBMISSION = f"{STUDENT_ID}/sub-1/anh.jpg"
OTHER_BOARD = f"{OTHER_STUDENT_ID}/khac.json"
OTHER_SUBMISSION = f"{OTHER_STUDENT_ID}/sub-2/anh.jpg"
OTHER_SESSION = "ffffffff-ffff-ffff-ffff-ffffffffffff"


@pytest.fixture
def seeded(client, settings, repo):
    """Học sinh A đã ngừng dạy, có tài khoản, buổi học, điểm danh, bảng và bài nộp; HS B cũng có."""
    repo.auth_users["em-a@example.com"] = STUDENT_PROFILE_ID
    repo.attendance.append((SESSION_ID, STUDENT_PROFILE_ID, DeviceMode.main))
    repo.board_files[OWN_BOARD] = [{"id": "x"}]
    repo.submission_files[OWN_SUBMISSION] = b"anh"
    repo.board_files[OTHER_BOARD] = [{"id": "y"}]
    repo.submission_files[OTHER_SUBMISSION] = b"anh"
    repo.sessions[OTHER_SESSION] = repo.sessions[SESSION_ID].model_copy(
        update={"id": OTHER_SESSION, "student_id": OTHER_STUDENT_ID, "room_name": "room-b"}
    )
    teacher = auth_header(settings, TEACHER_ID)
    assert client.patch(PATH, json={"active": False}, headers=teacher).status_code == 200
    return teacher


def assert_fully_deleted(repo, rooms):
    assert STUDENT_ID not in repo.students
    assert SESSION_ID not in repo.sessions
    assert STUDENT_PROFILE_ID not in repo.auth_users.values()
    assert STUDENT_PROFILE_ID not in repo.profiles
    assert OWN_BOARD not in repo.board_files and OWN_SUBMISSION not in repo.submission_files
    assert SESSION_ID in rooms.purged
    # dữ liệu học sinh khác giữ nguyên
    assert OTHER_BOARD in repo.board_files and OTHER_SUBMISSION in repo.submission_files
    assert OTHER_SESSION in repo.sessions and OTHER_SESSION not in rooms.purged


def test_delete_cleans_board_files_account_and_data_only_for_that_student(
    client, repo, rooms, seeded
):
    assert client.delete(PATH, headers=seeded).status_code == 204
    assert_fully_deleted(repo, rooms)
    # mất phản hồi rồi bấm lại: đã xóa xong thì 404, web coi như xong
    assert client.delete(PATH, headers=seeded).status_code == 404


@pytest.mark.parametrize("fail", ["whiteboard", "storage", "auth"])
def test_failure_midway_keeps_progress_and_retry_finishes(client, repo, rooms, seeded, fail):
    if fail == "whiteboard":
        rooms.fail_purge = True
    elif fail == "storage":
        repo.fail_storage_purge = True
    else:
        repo.fail_auth_delete = True

    resp = client.delete(PATH, headers=seeded)
    assert resp.status_code == 502
    assert "chưa xóa xong" in resp.json()["detail"].lower()
    # còn hồ sơ (đánh dấu đang xóa) để biết cần dọn gì tiếp; giáo viên thấy trạng thái
    assert repo.students[STUDENT_ID].deleting_at is not None
    listed = {s["id"]: s for s in client.get("/api/students", headers=seeded).json()}
    assert listed[STUDENT_ID]["deleting_at"] is not None
    if fail != "auth":
        # chưa dọn xong bảng/tệp thì chưa xóa buổi học: còn id buổi và đường dẫn để dọn tiếp
        assert SESSION_ID in repo.sessions and STUDENT_PROFILE_ID in repo.profiles

    rooms.fail_purge = repo.fail_storage_purge = repo.fail_auth_delete = False
    assert client.delete(PATH, headers=seeded).status_code == 204
    assert_fully_deleted(repo, rooms)


def test_student_being_deleted_cannot_be_reactivated_or_used(client, settings, repo, rooms, seeded):
    rooms.fail_purge = True
    assert client.delete(PATH, headers=seeded).status_code == 502
    assert client.patch(PATH, json={"active": True}, headers=seeded).status_code == 409
    resp = client.post(f"{PATH}/password", json={"password": "matkhau-moi-1"}, headers=seeded)
    assert resp.status_code == 409
    # buổi học của học sinh đang xóa coi như không còn: không vào lớp, không kết thúc được
    for user in (TEACHER_ID, STUDENT_PROFILE_ID):
        headers = auth_header(settings, user)
        resp = client.post(f"/api/sessions/{SESSION_ID}/join", json={}, headers=headers)
        assert resp.status_code == 404
    resp = client.post(f"/api/sessions/{SESSION_ID}/end", json={}, headers=seeded)
    assert resp.status_code == 404


def test_background_retry_finishes_deletion_left_by_api_restart(settings, repo, rooms, seeded):
    # API đánh dấu đang xóa rồi tắt trước khi dọn
    repo.students[STUDENT_ID] = repo.students[STUDENT_ID].model_copy(
        update={"deleting_at": datetime.now(UTC) - timedelta(minutes=10)}
    )
    assert asyncio.run(retry_pending_deletions(repo, settings, datetime.now(UTC))) == 1
    assert_fully_deleted(repo, rooms)


def test_finalize_retry_does_not_recreate_board_of_student_being_deleted(settings, repo, rooms):
    ended = datetime.now(UTC) - timedelta(minutes=10)
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={"status": SessionStatus.completed, "ended_at": ended}
    )
    repo.students[STUDENT_ID] = repo.students[STUDENT_ID].model_copy(
        update={"active": False, "deleting_at": ended}
    )
    rooms.board_elements = [{"id": "x", "version": 1, "versionNonce": 1}]
    assert asyncio.run(retry_pending(repo, settings, datetime.now(UTC))) == 0
    assert rooms.whiteboard == [] and repo.board_files == {}

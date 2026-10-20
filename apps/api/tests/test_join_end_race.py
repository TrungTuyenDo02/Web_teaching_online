"""Học sinh vào lớp đúng lúc giáo viên kết thúc buổi: không cấp token, không để lượt điểm danh mở.

Thứ tự điều khiển bằng `repo.before_next_attendance` / `repo.after_next_attendance`: chạy việc
"kết thúc buổi" của yêu cầu khác ngay trước/sau khi yêu cầu join ghi điểm danh.
"""

from datetime import UTC, datetime

from app.models import SessionStatus
from tests.conftest import SESSION_ID, STUDENT_PROFILE_ID, TEACHER_ID, auth_header


def start_live(client, settings):
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join", json={}, headers=auth_header(settings, TEACHER_ID)
    )
    assert resp.status_code == 200


def student_join(client, settings):
    return client.post(
        f"/api/sessions/{SESSION_ID}/join",
        json={},
        headers=auth_header(settings, STUDENT_PROFILE_ID),
    )


def end_meanwhile(repo):
    """Như POST /end của giáo viên: ghi completed rồi đóng mọi lượt điểm danh đang mở."""

    def run():
        ended = datetime.now(UTC)
        repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
            update={"status": SessionStatus.completed, "ended_at": ended}
        )
        repo.close_open_attendance(SESSION_ID)

    return run


def open_rows(repo):
    return [a for a in repo.open_attendance() if a[0] == SESSION_ID]


def test_end_commits_before_student_writes_attendance(client, settings, repo):
    start_live(client, settings)
    repo.before_next_attendance = end_meanwhile(repo)
    resp = student_join(client, settings)
    assert resp.status_code == 409
    assert "whiteboard" not in resp.json() and "livekit" not in resp.json()
    assert open_rows(repo) == []  # lượt điểm danh đến muộn được đóng ngay


def test_end_commits_after_attendance_but_before_tokens(client, settings, repo):
    start_live(client, settings)
    repo.after_next_attendance = end_meanwhile(repo)
    resp = student_join(client, settings)
    assert resp.status_code == 409
    assert open_rows(repo) == []


def test_student_joining_before_end_is_closed_by_end(client, settings, repo):
    start_live(client, settings)
    assert student_join(client, settings).status_code == 200
    assert len(open_rows(repo)) == 2
    teacher = auth_header(settings, TEACHER_ID)
    assert (
        client.post(f"/api/sessions/{SESSION_ID}/end", json={}, headers=teacher).status_code == 200
    )
    assert open_rows(repo) == []


def test_teacher_second_device_joining_during_end_is_refused(client, settings, repo):
    start_live(client, settings)
    repo.after_next_attendance = end_meanwhile(repo)
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join",
        json={"mode": "board"},
        headers=auth_header(settings, TEACHER_ID),
    )
    assert resp.status_code == 409
    assert open_rows(repo) == []

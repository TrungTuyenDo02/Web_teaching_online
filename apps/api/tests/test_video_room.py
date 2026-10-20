"""Phòng video do API tạo và đóng (thiết kế B2, docs/design-video-token.md).

Chạy qua chính `app.services.tokens` với `FakeLiveKit` (conftest), mô hình đã chỉnh theo kết quả
thử trên Cloud 2026-10-20 (T1–T14 trừ T8, T4, T10): phòng đã xóa vẫn vào lại được bằng token chưa
thu hồi; thu hồi khi phòng không tồn tại vẫn có hiệu lực. Thời hạn giữ thu hồi chưa đo xong (T8).
Test tên `test_known_gap_*` ghi lại giới hạn còn mở: đổi hành vi thì phải cập nhật thiết kế.
"""

import asyncio
import contextlib
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
import pytest
from fastapi import HTTPException

from app.auth import AuthUser
from app.config import Settings
from app.models import DeviceMode, EndSessionRequest, JoinRequest, SessionStatus
from app.routers.sessions import end_session, join_session
from app.services import finalize
from tests.conftest import (
    SESSION_ID,
    STUDENT_ID,
    STUDENT_PROFILE_ID,
    TEACHER_ID,
    auth_header,
)

SID = UUID(SESSION_ID)
TEACHER = AuthUser(id=TEACHER_ID)
STUDENT = AuthUser(id=STUDENT_PROFILE_ID)
ROOM = "room-test"


async def join(repo, settings, user, mode=DeviceMode.main):
    return await join_session(SID, JoinRequest(mode=mode), user, repo, settings)


async def end(repo, settings):
    return await end_session(SID, EndSessionRequest(), TEACHER, repo, settings)


async def join_status(repo, settings, user, mode=DeviceMode.main) -> int:
    try:
        await join(repo, settings, user, mode)
    except HTTPException as exc:
        return exc.status_code
    return 200


async def sweep(repo, settings) -> int:
    return await finalize.sweep_livekit_rooms(repo, settings)


# --- /join tạo phòng ---------------------------------------------------------------------------


def test_main_join_creates_room_kept_open_for_whole_join_window(client, settings, repo, rooms):
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join", json={}, headers=auth_header(settings, TEACHER_ID)
    )
    assert resp.status_code == 200
    req = rooms.lk.rooms[ROOM]
    closes = repo.sessions[SESSION_ID].scheduled_end + timedelta(minutes=settings.join_late_minutes)
    window = (closes - datetime.now(UTC)).total_seconds()
    assert abs(req.empty_timeout - window) < 5 and req.departure_timeout == req.empty_timeout
    # < 5 s: SDK chỉ gửi một lần, không tự phát lại CreateRoom sang vùng khác
    assert 0 < rooms.lk.timeouts["create"] < 5


def test_board_join_never_creates_or_deletes_video_room(settings, repo, rooms):
    async def scenario():
        await join(repo, settings, TEACHER)
        assert await join_status(repo, settings, TEACHER, DeviceMode.board) == 200
        # /end ghi completed ngay sau khi join board ghi điểm danh: lần đọc lại thấy buổi đã đóng
        repo.after_next_attendance = lambda: repo.sessions.update(
            {SESSION_ID: repo.sessions[SESSION_ID].model_copy(update={"status": "completed"})}
        )
        assert await join_status(repo, settings, TEACHER, DeviceMode.board) == 409

    asyncio.run(scenario())
    assert [c for c in rooms.lk.calls if c[0] == "create"] == [("create", ROOM)]
    assert rooms.lk.deleted == []  # join board không xóa bù phòng video


def test_create_room_failure_returns_502_without_side_effects(client, settings, repo, rooms):
    rooms.lk.fail = {"create"}
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join", json={}, headers=auth_header(settings, TEACHER_ID)
    )
    assert resp.status_code == 502
    assert resp.json()["detail"] == "Chưa mở được phòng video, thử lại"
    assert repo.sessions[SESSION_ID].status == SessionStatus.scheduled
    assert repo.attendance == []


def test_video_token_cannot_create_rooms(client, settings):
    resp = client.post(
        f"/api/sessions/{SESSION_ID}/join", json={}, headers=auth_header(settings, TEACHER_ID)
    )
    claims = jwt.decode(resp.json()["livekit"]["token"], options={"verify_signature": False})
    assert claims["video"]["roomJoin"] is True
    assert not claims["video"].get("roomCreate") and not claims["video"].get("roomAdmin")


# --- /end thu hồi rồi xóa --------------------------------------------------------------------


def test_finalize_revokes_teacher_and_student_before_deleting_room(settings, repo, rooms):
    async def scenario():
        await join(repo, settings, TEACHER)
        await join(repo, settings, STUDENT)
        assert not (await end(repo, settings)).finalize_pending

    asyncio.run(scenario())
    assert rooms.lk.calls[-3:] == [
        ("revoke", f"{ROOM}/{TEACHER_ID}"),
        ("revoke", f"{ROOM}/{STUDENT_PROFILE_ID}"),
        ("delete", ROOM),
    ]


def test_revoke_failure_still_deletes_room_and_stays_pending(settings, repo, rooms, clock):
    rooms.lk.fail = {"revoke"}

    async def scenario():
        teacher = await join(repo, settings, TEACHER)
        resp = await end(repo, settings)
        assert resp.finalize_pending  # chưa thu hồi được: chưa xong
        assert ROOM in rooms.lk.deleted and ROOM not in rooms.lk.rooms  # vẫn xóa phòng
        assert repo.sessions[SESSION_ID].finalized_at is None
        # Cloud (T3B): xóa phòng không chặn token chưa thu hồi. Hở tới lần thử lại thành công
        assert rooms.lk.can_connect(teacher.livekit.token)

        # Thử lại muộn 10 phút: mốc thu hồi phải theo giờ hiện tại (Cloud chỉ nhận ±60 s)
        rooms.lk.fail = set()
        clock.advance(600)
        now = datetime.fromtimestamp(clock.t, UTC)
        assert await finalize.retry_pending(repo, settings, now) == 1
        assert repo.sessions[SESSION_ID].finalized_at is not None
        assert not rooms.lk.can_connect(teacher.livekit.token)  # thu hồi lần sau đã chặn

    asyncio.run(scenario())


def revoke_fails_then_retried_after_room_deleted(settings, repo, rooms, clock) -> str:
    rooms.lk.fail = {"revoke"}

    async def scenario():
        teacher = await join(repo, settings, TEACHER)
        await end(repo, settings)
        rooms.lk.fail = set()
        clock.advance(120)
        await finalize.retry_pending(repo, settings, datetime.fromtimestamp(clock.t, UTC))
        return teacher.livekit.token

    return asyncio.run(scenario())


def test_revoke_retried_after_room_deleted_is_recorded_on_cloud(settings, repo, rooms, clock):
    """G9 theo Cloud (T7): thu hồi khi phòng không tồn tại vẫn có hiệu lực, nên lần thử lại chặn
    được token cũ kể cả khi phòng xuất hiện lại."""
    token = revoke_fails_then_retried_after_room_deleted(settings, repo, rooms, clock)
    rooms.lk.auto_create = True
    assert not rooms.lk.can_connect(token)


def test_known_gap_if_revoke_needed_existing_room(settings, repo, rooms, clock):
    """G9 theo mô hình cũ (Cloud đổi hành vi T7): thu hồi khi phòng không tồn tại không ghi nhận,
    phòng bị tạo lại thì token cũ vào được. Giữ để biết code phụ thuộc kết quả T7."""
    rooms.lk.revoke_requires_room = True
    token = revoke_fails_then_retried_after_room_deleted(settings, repo, rooms, clock)
    rooms.lk.auto_create = True
    assert rooms.lk.can_connect(token)


# --- Join xen kẽ với end ------------------------------------------------------------------------


def test_join_stalled_after_final_read_signs_token_after_end_is_still_revoked(
    settings, repo, rooms, clock
):
    """Join đọc thấy `live`, bị treo; /end làm xong cả thu hồi và xóa; 31 giây sau join mới ký
    token. Token đó phải bị thu hồi chặn, kể cả khi phòng bị tạo lại."""

    async def scenario():
        await join(repo, settings, TEACHER)

        async def end_then_stall():
            assert not (await end(repo, settings)).finalize_pending
            clock.advance(31)

        repo.after_reread = end_then_stall
        return await join(repo, settings, STUDENT)

    late = asyncio.run(scenario())
    assert late.livekit is not None  # đọc lại đã thấy live nên vẫn được cấp
    assert not rooms.lk.can_connect(late.livekit.token)
    rooms.lk.auto_create = True  # phòng bị tạo lại: chỉ còn thu hồi chặn
    assert not rooms.lk.can_connect(late.livekit.token)


def test_end_before_join_creates_room_join_deletes_it_and_old_tokens_stay_out(
    settings, repo, rooms
):
    seen: dict[str, bool] = {}

    async def scenario():
        teacher = await join(repo, settings, TEACHER)
        rooms.lk.before_create = lambda: end(repo, settings)

        async def check_window():
            # Khoảng hở: phòng vừa được join tạo lại, chưa đọc lại và xóa bù
            seen["teacher_in_window"] = rooms.lk.can_connect(teacher.livekit.token)

        rooms.lk.after_create = check_window
        assert await join_status(repo, settings, STUDENT) == 409

    asyncio.run(scenario())
    assert seen == {"teacher_in_window": False}
    assert ROOM not in rooms.lk.rooms
    assert repo.open_attendance() == []


def test_join_compensation_that_beats_finalize_still_revokes(settings, repo, rooms):
    """/end ghi completed; join đọc lại thấy đóng và xóa bù TRƯỚC khi finalize kịp thu hồi. Lần thu
    hồi sau gặp phòng không còn (mô hình: không ghi nhận), nên xóa bù cũng phải thu hồi trước."""

    def end_written_not_finalized():
        repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
            update={"status": SessionStatus.completed, "ended_at": datetime.now(UTC)}
        )

    async def scenario():
        teacher = await join(repo, settings, TEACHER)
        repo.after_next_attendance = end_written_not_finalized
        assert await join_status(repo, settings, STUDENT) == 409
        assert not (await end(repo, settings)).finalize_pending  # finalize chạy sau xóa bù
        return teacher.livekit.token

    token = asyncio.run(scenario())
    rooms.lk.auto_create = True  # phòng bị tạo lại
    assert not rooms.lk.can_connect(token)


def test_failed_compensating_delete_is_swept_after_finalized(settings, repo, rooms):
    async def scenario():
        await join(repo, settings, TEACHER)
        rooms.lk.before_create = lambda: end(repo, settings)

        async def break_delete():
            rooms.lk.fail = {"delete"}

        rooms.lk.after_create = break_delete
        assert await join_status(repo, settings, STUDENT) == 409
        assert ROOM in rooms.lk.rooms
        assert repo.sessions[SESSION_ID].finalized_at is not None  # retry_pending không thấy nó
        rooms.lk.fail = set()
        assert await sweep(repo, settings) == 1

    asyncio.run(scenario())
    assert ROOM not in rooms.lk.rooms


def test_join_dying_after_create_leaves_room_that_is_swept(settings, repo, rooms):
    async def scenario():
        teacher = await join(repo, settings, TEACHER)
        created = asyncio.Event()
        rooms.lk.before_create = lambda: end(repo, settings)

        async def die():
            created.set()
            await asyncio.Event().wait()  # tiến trình chết ở đây

        rooms.lk.after_create = die
        task = asyncio.create_task(join(repo, settings, STUDENT))
        await asyncio.wait_for(created.wait(), timeout=5)
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        assert ROOM in rooms.lk.rooms and repo.sessions[SESSION_ID].finalized_at is not None
        assert not rooms.lk.can_connect(teacher.livekit.token)  # đã thu hồi
        assert await sweep(repo, settings) == 1

    asyncio.run(scenario())
    assert ROOM not in rooms.lk.rooms


def test_late_create_after_finalized_is_blocked_then_swept(settings, repo, rooms):
    async def scenario():
        teacher = await join(repo, settings, TEACHER)
        rooms.lk.hold_creates = 1
        assert await join_status(repo, settings, STUDENT) == 502  # client hết giờ chờ
        assert not (await end(repo, settings)).finalize_pending
        rooms.lk.apply_late_creates()  # máy chủ tạo phòng sau khi mọi thứ đã xong
        assert ROOM in rooms.lk.rooms
        assert not rooms.lk.can_connect(teacher.livekit.token)
        assert await sweep(repo, settings) == 1

    asyncio.run(scenario())
    assert ROOM not in rooms.lk.rooms


# --- Thu hồi có hạn và phòng mồ côi ---------------------------------------------------------


def orphan_after_end(repo, settings, rooms):
    """Giáo viên và học sinh có token; một CreateRoom muộn tạo lại phòng sau khi buổi đã xong."""

    async def scenario():
        teacher = await join(repo, settings, TEACHER)
        student = await join(repo, settings, STUDENT)
        rooms.lk.hold_creates = 1
        assert await join_status(repo, settings, STUDENT) == 502
        await end(repo, settings)
        rooms.lk.apply_late_creates()
        return teacher.livekit.token, student.livekit.token

    return asyncio.run(scenario())


def test_sweep_within_revocation_ttl_closes_orphan_before_tokens_work_again(
    settings, repo, rooms, clock
):
    tokens = orphan_after_end(repo, settings, rooms)
    clock.advance(Settings.model_fields["no_show_interval_seconds"].default)  # một chu kỳ mặc định
    assert not any(rooms.lk.can_connect(t) for t in tokens)
    assert asyncio.run(sweep(repo, settings)) == 1


def test_known_gap_tokens_rejoin_deleted_room_after_revocation_expires(
    settings, repo, rooms, clock
):
    """G2 theo Cloud (T3B): phòng đã xóa vẫn vào lại được, nên khi thu hồi hết hạn (mô hình 660 s,
    Cloud chờ T8) mà token còn hạn thì token cũ vào được, dù vòng lặp nền đã xóa phòng."""
    tokens = orphan_after_end(repo, settings, rooms)
    assert asyncio.run(sweep(repo, settings)) == 1
    clock.advance(rooms.lk.revocation_ttl + 1)
    assert all(rooms.lk.can_connect(t) for t in tokens)


def test_known_gap_revocation_expires_while_orphan_room_survives(settings, repo, rooms, clock):
    """G2: vòng lặp nền không chạy (API chết, LiveKit API lỗi) lâu hơn thời gian giữ thu hồi
    thì token cũ vào được phòng mồ côi. Hai người cùng vào được: P1 không được bảo đảm."""
    teacher, student = orphan_after_end(repo, settings, rooms)
    clock.advance(rooms.lk.revocation_ttl + 1)
    assert rooms.lk.can_connect(teacher) and rooms.lk.can_connect(student)


def test_permanent_revocation_model_keeps_orphan_closed_without_sweep(settings, repo, rooms, clock):
    rooms.lk.revocation_ttl = None
    tokens = orphan_after_end(repo, settings, rooms)
    clock.advance(3000)
    assert not any(rooms.lk.can_connect(t) for t in tokens)


def test_late_create_after_student_and_sessions_deleted_is_swept(
    client, settings, repo, rooms, clock
):
    """Phòng tạo muộn vẫn mang nhãn sở hữu: dọn được dù hồ sơ và buổi học đã xóa."""
    teacher_h = auth_header(settings, TEACHER_ID)
    student_h = auth_header(settings, STUDENT_PROFILE_ID)
    url = f"/api/sessions/{SESSION_ID}/join"
    teacher = client.post(url, json={}, headers=teacher_h).json()["livekit"]["token"]
    student = client.post(url, json={}, headers=student_h).json()["livekit"]["token"]
    rooms.lk.hold_creates = 1
    assert client.post(url, json={}, headers=student_h).status_code == 502

    student_url = f"/api/students/{STUDENT_ID}"
    assert client.patch(student_url, json={"active": False}, headers=teacher_h).status_code == 200
    assert client.delete(student_url, headers=teacher_h).status_code == 204
    assert SESSION_ID not in repo.sessions
    assert ("revoke", f"{ROOM}/{TEACHER_ID}") in rooms.lk.calls  # đóng phòng buổi live có thu hồi

    rooms.lk.apply_late_creates()
    assert not rooms.lk.can_connect(teacher) and not rooms.lk.can_connect(student)
    assert asyncio.run(sweep(repo, settings)) == 1 and ROOM not in rooms.lk.rooms
    # Hết hạn thu hồi thì token cũ vào lại phòng đã xóa (G2 theo Cloud, xem test known_gap ở trên)
    clock.advance(rooms.lk.revocation_ttl + 1)
    assert rooms.lk.can_connect(teacher) and rooms.lk.can_connect(student)


# --- Vòng lặp nền dọn phòng ------------------------------------------------------------------


@pytest.mark.parametrize("closed", [SessionStatus.cancelled, SessionStatus.no_show])
def test_room_of_cancelled_or_no_show_session_is_swept(settings, repo, rooms, closed):
    async def scenario():
        await join(repo, settings, STUDENT)  # học sinh vào trước: phòng có, buổi vẫn scheduled
        assert ROOM in rooms.lk.rooms
        repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(update={"status": closed})
        assert await sweep(repo, settings) == 1

    asyncio.run(scenario())
    assert ROOM not in rooms.lk.rooms


def test_sweep_only_touches_rooms_of_closed_sessions(settings, repo, rooms):
    other = "ffffffff-ffff-ffff-ffff-ffffffffffff"
    repo.sessions[other] = repo.sessions[SESSION_ID].model_copy(
        update={"id": other, "room_name": "room-done", "status": SessionStatus.completed}
    )
    for name in (ROOM, "room-done", "room-of-another-app"):
        rooms.lk.rooms[name] = None  # type: ignore[assignment]
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={"status": SessionStatus.live}
    )

    assert asyncio.run(sweep(repo, settings)) == 1
    assert set(rooms.lk.rooms) == {ROOM, "room-of-another-app"}
    assert asyncio.run(sweep(repo, settings)) == 0  # gọi lại được


def test_sweep_keeps_going_when_one_room_fails(settings, repo, rooms):
    other = "ffffffff-ffff-ffff-ffff-ffffffffffff"
    repo.sessions[other] = repo.sessions[SESSION_ID].model_copy(
        update={"id": other, "room_name": "room-done", "status": SessionStatus.completed}
    )
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={"status": SessionStatus.completed}
    )
    rooms.lk.rooms = {ROOM: None, "room-done": None}  # type: ignore[dict-item]
    rooms.lk.fail = {"revoke"}  # cả hai lỗi thu hồi: vẫn thử xóa từng phòng
    assert asyncio.run(sweep(repo, settings)) == 0
    assert rooms.lk.rooms == {}

"""Lưu bảng (finalize, /end) chạy cùng lúc với xóa học sinh: không để lại file mồ côi trên Storage.

Thứ tự được điều khiển bằng `repo.upload_gate`: finalize đã lấy nội dung bảng và dừng ngay trước
khi tải lên, đến khi test cho chạy tiếp.
"""

import asyncio
from datetime import UTC, datetime, timedelta

import httpx

from app.config import get_settings
from app.main import create_app
from app.models import SessionStatus
from app.repo import get_repo
from app.services.finalize import UPLOAD_LEASE, finalize_session, sweep_stale_uploads
from app.services.student_deletion import RETRY_AFTER, purge_student, retry_pending_deletions
from tests.conftest import (
    OTHER_STUDENT_ID,
    SESSION_ID,
    STUDENT_ID,
    TEACHER_ID,
    auth_header,
)

BOARD = [{"id": "x", "version": 1, "versionNonce": 1}]
OWN_BOARD = f"{STUDENT_ID}/{SESSION_ID}.json"
OTHER_SESSION = "ffffffff-ffff-ffff-ffff-ffffffffffff"
OTHER_BOARD = f"{OTHER_STUDENT_ID}/{OTHER_SESSION}.json"


def setup(repo, rooms):
    """Buổi của HS A đã kết thúc, chờ lưu bảng; HS A đã ngừng dạy. HS B có bảng đã lưu."""
    ended = datetime.now(UTC) - timedelta(minutes=5)
    repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
        update={"status": SessionStatus.completed, "ended_at": ended}
    )
    repo.students[STUDENT_ID] = repo.students[STUDENT_ID].model_copy(update={"active": False})
    repo.sessions[OTHER_SESSION] = repo.sessions[SESSION_ID].model_copy(
        update={"id": OTHER_SESSION, "student_id": OTHER_STUDENT_ID, "room_name": "room-b"}
    )
    repo.board_files[OTHER_BOARD] = BOARD
    rooms.board_elements = BOARD
    repo.upload_gate = asyncio.Event()
    repo.upload_waiting = asyncio.Event()


def later(minutes: float = 0) -> datetime:
    return datetime.now(UTC) + RETRY_AFTER + timedelta(minutes=minutes)


def assert_clean(repo):
    assert STUDENT_ID not in repo.students
    assert not [p for p in repo.board_files if p.startswith(f"{STUDENT_ID}/")]
    # Hàng còn lại của em (uploader chưa xác nhận xong) phải đã được dọn ít nhất một lần
    assert all(
        i.cleaned_at is not None for i in repo.upload_intents.values() if i.student_id == STUDENT_ID
    )
    # dữ liệu học sinh khác nguyên vẹn
    assert repo.board_files[OTHER_BOARD] == BOARD and OTHER_SESSION in repo.sessions


async def mark_deleting(repo):
    return await repo.mark_student_deleting(STUDENT_ID)


def test_deletion_waits_for_upload_in_flight_and_background_finishes(settings, repo, rooms):
    async def scenario():
        setup(repo, rooms)
        session = repo.sessions[SESSION_ID]
        upload = asyncio.create_task(finalize_session(repo, settings, session))
        await repo.upload_waiting.wait()  # đã lấy bảng, sắp tải lên

        student = await mark_deleting(repo)
        assert await purge_student(repo, settings, student) == ["bảng viết đang được lưu"]
        assert await purge_student(repo, settings, student)  # gọi lặp: vẫn chờ, chưa báo xong
        assert STUDENT_ID in repo.students

        repo.upload_gate.set()  # tải lên tiếp sau khi bên xóa đã chạy
        await upload
        # không cần ai bấm xóa lại: vòng lặp nền làm tiếp
        assert await retry_pending_deletions(repo, settings, later()) == 1
        assert_clean(repo)

    asyncio.run(scenario())


def test_new_finalize_after_deletion_started_does_not_upload(settings, repo, rooms):
    async def scenario():
        setup(repo, rooms)
        repo.upload_gate = None
        await mark_deleting(repo)
        await finalize_session(repo, settings, repo.sessions[SESSION_ID])
        assert OWN_BOARD not in repo.board_files and repo.upload_intents == {}

    asyncio.run(scenario())


def test_upload_stalled_past_lease_after_profile_deleted_removes_its_own_file(
    settings, repo, rooms
):
    async def scenario():
        setup(repo, rooms)
        upload = asyncio.create_task(finalize_session(repo, settings, repo.sessions[SESSION_ID]))
        await repo.upload_waiting.wait()
        # tiến trình tải lên bị treo quá hạn: bản đăng ký coi là bỏ dở, bên xóa làm xong hẳn
        for intent in repo.upload_intents.values():
            repo.upload_intents[intent.id] = intent.model_copy(
                update={"created_at": datetime.now(UTC) - UPLOAD_LEASE - timedelta(minutes=1)}
            )
        student = await mark_deleting(repo)
        assert await purge_student(repo, settings, student) == []
        assert STUDENT_ID not in repo.students

        repo.upload_gate.set()  # tải lên muộn sau khi hồ sơ đã xóa
        await upload
        assert_clean(repo)

    asyncio.run(scenario())


def test_crash_after_upload_is_cleaned_after_restart(settings, repo, rooms):
    async def scenario():
        setup(repo, rooms)
        repo.upload_gate = None
        # tiến trình chết ngay sau khi tải lên: còn file và bản đăng ký, không ai gỡ
        intent = await repo.add_upload_intent(STUDENT_ID, SESSION_ID)
        await repo.save_board_snapshot(STUDENT_ID, SESSION_ID, BOARD)
        repo.upload_intents[intent.id] = intent.model_copy(
            update={"created_at": datetime.now(UTC) - UPLOAD_LEASE - timedelta(minutes=1)}
        )
        await mark_deleting(repo)
        repo.students[STUDENT_ID] = repo.students[STUDENT_ID].model_copy(
            update={"deleting_at": datetime.now(UTC) - timedelta(minutes=30)}
        )
        # "khởi động lại": chỉ còn dữ liệu bền, vòng lặp nền tự làm
        repo.fail_storage_purge = True
        assert await retry_pending_deletions(repo, settings, datetime.now(UTC)) == 0
        assert STUDENT_ID in repo.students  # lỗi giữa chừng: chưa xóa hồ sơ
        repo.fail_storage_purge = False
        assert await retry_pending_deletions(repo, settings, datetime.now(UTC)) == 1
        assert_clean(repo)

    asyncio.run(scenario())


def test_sweeper_removes_orphan_of_deleted_student_keeps_others(settings, repo, rooms):
    async def scenario():
        setup(repo, rooms)
        repo.upload_gate = None
        stale = datetime.now(UTC) - UPLOAD_LEASE - timedelta(minutes=1)
        # bản đăng ký bỏ dở của học sinh đã bị xóa hẳn (file mồ côi) và của HS B (file hợp lệ)
        orphan = await repo.add_upload_intent(STUDENT_ID, SESSION_ID)
        await repo.save_board_snapshot(STUDENT_ID, SESSION_ID, BOARD)
        del repo.students[STUDENT_ID]
        kept = await repo.add_upload_intent(OTHER_STUDENT_ID, OTHER_SESSION)
        fresh = await repo.add_upload_intent(OTHER_STUDENT_ID, OTHER_SESSION)
        for i in (orphan, kept):
            repo.upload_intents[i.id] = i.model_copy(update={"created_at": stale})

        repo.fail_storage_purge = True
        await sweep_stale_uploads(repo, datetime.now(UTC))
        assert repo.upload_intents[orphan.id].cleaned_at is None  # xóa file lỗi: chưa dọn
        repo.fail_storage_purge = False
        await sweep_stale_uploads(repo, datetime.now(UTC))
        assert OWN_BOARD not in repo.board_files
        assert repo.board_files[OTHER_BOARD] == BOARD  # snapshot hợp lệ của HS B giữ nguyên
        # Không hàng nào bị xóa: quá hạn không chứng minh uploader thôi ghi
        assert set(repo.upload_intents) == {orphan.id, kept.id, fresh.id}
        assert repo.upload_intents[orphan.id].cleaned_at is not None
        assert repo.upload_intents[kept.id].cleaned_at is None  # HS B còn học: không đụng

    asyncio.run(scenario())


def test_end_endpoint_racing_delete_endpoint_leaves_no_orphan(settings, repo, rooms):
    async def scenario():
        setup(repo, rooms)
        repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
            update={"status": SessionStatus.live, "ended_at": None}
        )
        app = create_app()
        app.dependency_overrides[get_settings] = lambda: settings
        app.dependency_overrides[get_repo] = lambda: repo
        teacher = auth_header(settings, TEACHER_ID)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://api") as api:
            end = asyncio.create_task(
                api.post(f"/api/sessions/{SESSION_ID}/end", json={}, headers=teacher)
            )
            await repo.upload_waiting.wait()
            deleted = await api.delete(f"/api/students/{STUDENT_ID}", headers=teacher)
            assert deleted.status_code == 502
            assert "đang được lưu" in deleted.json()["detail"]
            repo.upload_gate.set()
            assert (await end).status_code == 200
        assert await retry_pending_deletions(repo, settings, later()) == 1
        assert_clean(repo)

    asyncio.run(scenario())

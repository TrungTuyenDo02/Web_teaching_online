"""Uploader treo quá UPLOAD_LEASE rồi ghi muộn và chết trước bước kiểm tra lại: file mồ côi vẫn
được vòng lặp nền tìm thấy và dọn, kể cả khi hồ sơ học sinh đã xóa.

Quá hạn không chứng minh uploader thôi ghi: hàng `board_upload_intents` chỉ do chính uploader xóa
khi đã có kết quả chắc chắn; các bên khác chỉ ghi `cleaned_at` (đã dọn lần này).
Thứ tự điều khiển bằng `repo.upload_gate` (trước khi ghi) và `repo.after_upload` (sau khi ghi,
trước kiểm tra lại: hủy tác vụ ở đây là giả lập tiến trình chết). Thời gian giả qua tham số `now`.
"""

import asyncio
from contextlib import suppress
from datetime import UTC, datetime, timedelta

from app.services.finalize import UPLOAD_LEASE, finalize_session, sweep_stale_uploads
from app.services.student_deletion import purge_student, retry_pending_deletions
from tests.conftest import STUDENT_ID
from tests.test_upload_race import OTHER_BOARD, OWN_BOARD, SESSION_ID, mark_deleting, setup

BOARD = [{"id": "x", "version": 1, "versionNonce": 1}]


def fake_now(minutes_past_lease: float = 1) -> datetime:
    return datetime.now(UTC) + UPLOAD_LEASE + timedelta(minutes=minutes_past_lease)


async def start_stalled_upload(repo, settings):
    repo.after_upload = asyncio.Event()  # không bao giờ mở: uploader dừng ngay sau khi ghi
    repo.upload_written = asyncio.Event()
    upload = asyncio.create_task(finalize_session(repo, settings, repo.sessions[SESSION_ID]))
    await repo.upload_waiting.wait()
    return upload


async def late_write_then_crash(repo, upload):
    repo.upload_gate.set()
    await repo.upload_written.wait()
    upload.cancel()  # chết trước bước kiểm tra lại
    with suppress(asyncio.CancelledError):
        await upload


def own_rows(repo):
    return [i for i in repo.upload_intents.values() if i.student_id == STUDENT_ID]


def test_sweeper_before_deletion_does_not_drop_the_only_trace(settings, repo, rooms):
    async def scenario():
        setup(repo, rooms)
        upload = await start_stalled_upload(repo, settings)
        now = fake_now()
        # học sinh chưa bị đánh dấu xóa: không đụng hàng (trước đây hàng bị xóa ở đây)
        assert await sweep_stale_uploads(repo, now) == 0
        assert [i.cleaned_at for i in own_rows(repo)] == [None]

        student = await mark_deleting(repo)
        assert await purge_student(repo, settings, student, now=now) == []  # quá hạn: thôi chờ
        assert STUDENT_ID not in repo.students

        await late_write_then_crash(repo, upload)
        assert OWN_BOARD in repo.board_files  # mồ côi, hồ sơ đã xóa

        # "khởi động lại": chỉ còn dữ liệu bền, vòng lặp nền tự dọn
        assert await sweep_stale_uploads(repo, fake_now(5)) == 1
        assert OWN_BOARD not in repo.board_files
        assert repo.board_files[OTHER_BOARD] == BOARD
        # đã dọn lần này, nhưng chưa có bằng chứng hết ghi muộn: hàng còn để canh tiếp
        rows = own_rows(repo)
        assert len(rows) == 1 and rows[0].cleaned_at is not None

    asyncio.run(scenario())


def test_deletion_with_storage_errors_concurrent_sweeps_and_restart(settings, repo, rooms):
    async def scenario():
        setup(repo, rooms)
        upload = await start_stalled_upload(repo, settings)
        now = fake_now()
        student = await mark_deleting(repo)

        repo.fail_storage_purge = True
        pending, _ = await asyncio.gather(
            purge_student(repo, settings, student, now=now), sweep_stale_uploads(repo, now)
        )
        assert pending == ["tệp bảng và bài nộp"] and STUDENT_ID in repo.students
        assert [i.cleaned_at for i in own_rows(repo)] == [None]  # lỗi: chưa dọn được

        repo.fail_storage_purge = False
        done, _ = await asyncio.gather(
            retry_pending_deletions(repo, settings, now), sweep_stale_uploads(repo, now)
        )
        assert done == 1 and STUDENT_ID not in repo.students

        await late_write_then_crash(repo, upload)
        repo.fail_storage_purge = True
        assert await sweep_stale_uploads(repo, fake_now(5)) == 0  # Storage lỗi: để lần sau
        assert OWN_BOARD in repo.board_files
        repo.fail_storage_purge = False
        assert await sweep_stale_uploads(repo, fake_now(10)) == 1
        assert OWN_BOARD not in repo.board_files

        # file xuất hiện lại (một lần ghi muộn khác): lần canh sau vẫn dọn
        repo.board_files[OWN_BOARD] = BOARD
        assert await sweep_stale_uploads(repo, fake_now(15)) == 1
        assert OWN_BOARD not in repo.board_files
        assert repo.board_files[OTHER_BOARD] == BOARD

    asyncio.run(scenario())


def test_uploader_that_finishes_late_settles_its_own_row(settings, repo, rooms):
    async def scenario():
        setup(repo, rooms)
        upload = asyncio.create_task(finalize_session(repo, settings, repo.sessions[SESSION_ID]))
        await repo.upload_waiting.wait()
        now = fake_now()
        student = await mark_deleting(repo)
        assert await purge_student(repo, settings, student, now=now) == []
        repo.upload_gate.set()
        await upload  # còn sống: kiểm tra lại, thấy hồ sơ đã xóa, tự gỡ file rồi mới xóa hàng
        assert OWN_BOARD not in repo.board_files and own_rows(repo) == []

    asyncio.run(scenario())

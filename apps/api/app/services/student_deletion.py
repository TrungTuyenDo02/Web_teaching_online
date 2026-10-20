"""Xóa hẳn học sinh theo từng bước gọi lại được; lỗi giữa chừng thì gọi lại hoặc vòng lặp nền
làm tiếp.

Dấu bền là `students.deleting_at`. Hồ sơ học sinh và buổi học chỉ bị xóa sau khi đã dọn bảng và
tệp, nên lần thử lại luôn còn đủ id buổi, đường dẫn và `profile_id` cần dọn.
"""

import logging
from datetime import datetime, timedelta

from app.config import Settings
from app.core import time as clock
from app.models import SessionStatus, StudentRow
from app.repo import Repository
from app.services.finalize import UPLOAD_LEASE
from app.services.tokens import close_livekit_room, purge_whiteboard_room

logger = logging.getLogger("app.student_deletion")

# Yêu cầu DELETE vừa đánh dấu đang tự làm: vòng lặp nền chờ rồi mới thử lại
RETRY_AFTER = timedelta(minutes=1)


async def purge_student(
    repo: Repository, settings: Settings, student: StudentRow, now: datetime | None = None
) -> list[str]:
    """Chạy các bước còn thiếu; trả về tên phần chưa xóa xong (rỗng là đã xóa hết)."""
    now = now or clock.now_utc()
    pending: list[str] = []
    sessions = await repo.list_student_sessions(student.id)
    for session in sessions:
        try:
            if session.status == SessionStatus.live:
                identities = [session.teacher_id] + [p for p in [student.profile_id] if p]
                await close_livekit_room(settings, session.room_name, identities)
            # Xóa nội dung bảng trên máy chủ bảng; dấu đóng giữ lại để token cũ bị từ chối
            await purge_whiteboard_room(settings, session.id)
        except Exception:
            logger.exception("Chưa xóa được phòng bảng/video của buổi học %s", session.id)
            if "bảng viết trên máy chủ" not in pending:
                pending.append("bảng viết trên máy chủ")
    if pending:
        return pending  # giữ buổi học và hồ sơ: còn cần id, đường dẫn để dọn tiếp

    # deleting_at đã ghi trước khi đọc bản đăng ký: lần lưu bảng nào bắt đầu sau đây sẽ tự hủy.
    # Còn bản đăng ký mới thì một lần lưu đang chạy: chờ nó xong rồi mới dọn Storage.
    intents = await repo.list_upload_intents(student_id=student.id)
    cutoff = now - UPLOAD_LEASE
    if any(i.created_at >= cutoff for i in intents):
        return ["bảng viết đang được lưu"]
    try:
        await repo.purge_student_files(student.id)  # bucket boards và submissions: <student_id>/
        for intent in intents:
            # Quá hạn mà chưa xác nhận: thôi chờ, file (nếu có) nằm dưới <student_id>/ vừa xóa.
            # Giữ hàng để vòng lặp nền dọn lần ghi muộn (nếu có) sau khi hồ sơ đã xóa.
            await repo.mark_upload_intent_cleaned(intent.id, now)
    except Exception:
        logger.exception("Chưa xóa được tệp của học sinh %s", student.id)
        return ["tệp bảng và bài nộp"]

    try:
        # Xóa buổi học trước (kéo theo điểm danh tham chiếu hồ sơ) rồi mới xóa được tài khoản
        await repo.delete_student_sessions(student.id)
        if student.profile_id:
            await repo.delete_auth_user(student.profile_id)
        await repo.delete_student(student.id)  # bài tập, bài nộp xóa dây chuyền theo khóa ngoại
    except Exception:
        logger.exception("Chưa xóa xong tài khoản/dữ liệu của học sinh %s", student.id)
        return ["tài khoản đăng nhập và dữ liệu"]
    return []


async def retry_pending_deletions(repo: Repository, settings: Settings, now: datetime) -> int:
    """Làm tiếp các học sinh đang xóa dở; trả số học sinh đã xóa xong."""
    done = 0
    for student in await repo.list_deleting_students(now - RETRY_AFTER):
        done += not await purge_student(repo, settings, student, now)
    return done

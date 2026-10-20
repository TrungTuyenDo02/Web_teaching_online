"""Làm nốt việc sau khi buổi học đã `completed`: điểm danh, đóng phòng video, đóng và lưu bảng.

Mỗi bước gọi lại được (idempotent), nên lỗi giữa chừng hay API khởi động lại thì chạy lại cả
chuỗi. `sessions.finalized_at` rỗng nghĩa là còn việc chưa xong (vòng lặp nền thử lại).
"""

import logging
from datetime import datetime, timedelta

from app.config import Settings
from app.core import time as clock
from app.models import CLOSED_STATUSES, SessionRow, UploadIntent
from app.repo import Repository
from app.services.tokens import (
    close_livekit_room,
    close_whiteboard_room,
    list_livekit_rooms,
)

logger = logging.getLogger("app.finalize")

# Buổi vừa kết thúc đang được chính yêu cầu /end làm: vòng lặp nền chờ rồi mới thử lại
RETRY_AFTER = timedelta(minutes=1)
# Bản đăng ký tải lên quá hạn này thì bên xóa thôi chờ và vòng lặp nền bắt đầu canh. Quá hạn
# KHÔNG chứng minh uploader thôi ghi (tiến trình có thể treo rồi chạy tiếp, timeout HTTP phía máy
# này không dừng được yêu cầu đã gửi): hàng chỉ do chính uploader xóa khi đã có kết quả chắc chắn.
UPLOAD_LEASE = timedelta(minutes=10)


async def video_identities(repo: Repository, session: SessionRow) -> list[str]:
    """Identity LiveKit (= profile id) của giáo viên và học sinh buổi đó: các token cần thu hồi."""
    student = await repo.get_student(session.student_id)
    return [session.teacher_id] + ([student.profile_id] if student and student.profile_id else [])


async def _student_present(repo: Repository, student_id: str) -> bool:
    student = await repo.get_student(student_id)
    return student is not None and student.deleting_at is None


async def _save_board(repo: Repository, session: SessionRow, elements: list[dict]) -> None:
    """Tải bản bảng cuối lên Storage mà không tạo lại dữ liệu của học sinh đang hoặc đã xóa.

    Bắt tay với student_deletion qua cơ sở dữ liệu (không cần khóa, đúng cả khi nhiều tiến trình):
    ở đây ghi bản đăng ký rồi mới đọc deleting_at; bên xóa ghi deleting_at rồi mới đọc bản đăng ký
    và chờ bản đăng ký còn mới rồi mới dọn Storage. Một trong hai bên luôn thấy bên kia.
    Chỉ ở đây mới xóa bản đăng ký, và chỉ khi biết chắc kết quả: chưa ghi gì, hoặc đã ghi xong và
    đã giữ (học sinh còn học) hay gỡ (học sinh đang/đã xóa) file. Lỗi, timeout hay chết giữa chừng
    thì hàng ở lại; sweep_stale_uploads canh và dọn file nếu học sinh đang/đã xóa.
    """
    intent = await repo.add_upload_intent(session.student_id, session.id)
    if not await _student_present(repo, session.student_id):
        await repo.delete_upload_intent(intent.id)  # đang xóa: không tải lên
        return
    path = await repo.save_board_snapshot(session.student_id, session.id, elements)
    if await _student_present(repo, session.student_id):
        await repo.update_session(session.id, {"board_snapshot_path": path})
    else:
        # Chỉ xảy ra khi tải lên bị treo quá UPLOAD_LEASE và bên xóa đã làm xong: tự gỡ bản vừa tải
        await repo.delete_board_snapshot(session.student_id, session.id)
    await repo.delete_upload_intent(intent.id)


async def _clean_if_orphan(repo: Repository, intent: UploadIntent, now: datetime) -> bool:
    student = await repo.get_student(intent.student_id)
    if student is not None and student.deleting_at is None:
        return False  # còn học: file (nếu có) là snapshot hợp lệ; giữ hàng phòng khi em bị xóa sau
    await repo.delete_board_snapshot(intent.student_id, intent.session_id)
    await repo.mark_upload_intent_cleaned(intent.id, now)  # đã dọn lần này, hàng vẫn ở lại
    return True


async def sweep_stale_uploads(repo: Repository, now: datetime) -> int:
    """Vòng lặp nền canh các lần tải chưa xác nhận xong (quá UPLOAD_LEASE): học sinh đang/đã xóa
    thì xóa file nếu đã được ghi. Không xóa hàng. Trả số hàng đã dọn lần này; lỗi thì để lần sau.

    shortcut: hàng chưa xác nhận được canh mãi (mỗi chu kỳ một lệnh xóa Storage, chỉ chứa id);
    nếu tích lũy nhiều thì cần bằng chứng uploader thôi ghi (vd. ghi có điều kiện ở Storage).
    """
    done = 0
    for intent in await repo.list_upload_intents(created_before=now - UPLOAD_LEASE):
        try:
            done += await _clean_if_orphan(repo, intent, now)
        except Exception:
            logger.exception("Chưa dọn được lần tải bảng của buổi học %s", intent.session_id)
    return done


async def finalize_session(repo: Repository, settings: Settings, session: SessionRow) -> bool:
    """Chạy mọi bước; bước lỗi không chặn bước sau. True khi tất cả xong và đã ghi finalized_at."""
    ended_at = session.ended_at or clock.now_utc()
    ok = True
    try:
        await repo.close_attendance(session.id, ended_at)
    except Exception:
        ok = False
        logger.exception("Không ghi được giờ rời phòng của buổi học %s", session.id)
    try:
        identities = await video_identities(repo, session)
        await close_livekit_room(settings, session.room_name, identities)
    except Exception:
        ok = False
        logger.exception("Không đóng được phòng video của buổi học %s", session.id)
    try:
        elements = await close_whiteboard_room(settings, session.id)
        if elements:  # bảng trống (hoặc máy chủ bảng mất dữ liệu): giữ bản đã lưu trước đó
            await _save_board(repo, session, elements)
    except Exception:
        ok = False
        logger.exception("Không đóng hoặc không lưu được bảng của buổi học %s", session.id)
    if not ok:
        return False
    try:
        await repo.update_session(session.id, {"finalized_at": clock.now_utc()})
    except Exception:
        logger.exception("Không ghi được finalized_at của buổi học %s", session.id)
        return False
    return True


async def sweep_livekit_rooms(repo: Repository, settings: Settings) -> int:
    """Vòng lặp nền xóa phòng video của buổi đã đóng hoặc của học sinh đang xóa, dựa vào danh
    sách phòng LiveKit, không dựa vào finalized_at: dọn cả phòng tạo muộn, phòng còn lại khi API
    chết giữa chừng hay xóa bù lỗi. Trả số phòng đã xóa; lỗi một phòng thì để lần sau.

    Phòng không còn hàng buổi học chỉ được xóa khi nhãn sở hữu có chữ ký khớp môi trường và tên
    phòng: dọn được lần tạo muộn sau xóa học sinh, không đụng phòng của ứng dụng khác. Lỗi đọc DB
    không được coi là mất hàng. Phòng cũ không có nhãn vẫn giữ lại.
    """
    done = unknown = 0
    for room in await list_livekit_rooms(settings):
        name = room.name
        try:
            session = await repo.get_session_by_room_name(name)
            if session is None:
                if room.managed:
                    await close_livekit_room(settings, name)
                    done += 1
                else:
                    unknown += 1
                continue
            student = await repo.get_student(session.student_id)
            deleting = student is None or student.deleting_at is not None
            if session.status in CLOSED_STATUSES or deleting:
                await close_livekit_room(settings, name, await video_identities(repo, session))
                done += 1
        except Exception:
            logger.exception("Chưa xóa được phòng video %s", name)
    if unknown:
        logger.info("Bỏ qua %d phòng video không thuộc buổi học nào", unknown)
    return done


async def retry_pending(repo: Repository, settings: Settings, now: datetime) -> int:
    """Thử lại các buổi completed còn việc chờ; trả số buổi đã làm xong."""
    done = 0
    for session in await repo.list_unfinalized_sessions(now - RETRY_AFTER):
        done += await finalize_session(repo, settings, session)
    return done

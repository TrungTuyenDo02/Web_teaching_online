"""Tác vụ nền, mỗi NO_SHOW_INTERVAL_SECONDS:
- buổi quá giờ mà giáo viên chưa vào (vẫn `scheduled`) thì chuyển `no_show`;
- dọn lần tải bảng bỏ dở (`finalize.sweep_stale_uploads`);
- thử lại việc đóng phòng/lưu bảng của buổi đã kết thúc (`finalize.retry_pending`);
- làm tiếp việc xóa học sinh còn dở (`student_deletion.retry_pending_deletions`)."""

import asyncio
import logging
from datetime import datetime, timedelta

from app.config import Settings
from app.core import time as clock
from app.repo import Repository, SupabaseRepository
from app.services import finalize, student_deletion, weekly_slots

logger = logging.getLogger("app.no_show")


async def mark_no_show(repo: Repository, settings: Settings, now: datetime) -> int:
    # Chờ hết khung vào muộn (cùng mốc với kiểm tra khi vào phòng) rồi mới coi là vắng
    return await repo.mark_no_show(now - timedelta(minutes=settings.join_late_minutes))


async def run_forever(settings: Settings) -> None:
    repo = SupabaseRepository(settings)
    while True:
        try:
            changed = await mark_no_show(repo, settings, clock.now_utc())
            if changed:
                logger.info("Đã chuyển %d buổi học sang no_show", changed)
        except Exception:
            logger.exception("Không cập nhật được no_show, sẽ thử lại")
        try:
            swept = await finalize.sweep_stale_uploads(repo, clock.now_utc())
            if swept:
                logger.info("Đã dọn %d lần tải bảng bỏ dở", swept)
        except Exception:
            logger.exception("Không dọn được lần tải bảng bỏ dở, sẽ thử lại")
        try:
            finished = await finalize.retry_pending(repo, settings, clock.now_utc())
            if finished:
                logger.info("Đã đóng phòng, lưu bảng nốt cho %d buổi học", finished)
        except Exception:
            logger.exception("Không thử lại được việc đóng phòng còn chờ, sẽ thử lại")
        try:
            generated = await weekly_slots.fill_all(repo, clock.now_utc())
            if generated:
                logger.info("Đã sinh %d buổi học từ lịch cố định", generated)
        except Exception:
            logger.exception("Không sinh được buổi học từ lịch cố định, sẽ thử lại")
        try:
            closed = await finalize.sweep_livekit_rooms(repo, settings)
            if closed:
                logger.info("Đã xóa %d phòng video của buổi đã đóng", closed)
        except Exception:
            logger.exception("Không dọn được phòng video, sẽ thử lại")
        try:
            deleted = await student_deletion.retry_pending_deletions(
                repo, settings, clock.now_utc()
            )
            if deleted:
                logger.info("Đã xóa nốt %d học sinh", deleted)
        except Exception:
            logger.exception("Không làm tiếp được việc xóa học sinh, sẽ thử lại")
        await asyncio.sleep(settings.no_show_interval_seconds)

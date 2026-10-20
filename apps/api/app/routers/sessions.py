import logging
from datetime import datetime, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import AuthUser, get_current_user
from app.config import Settings, get_settings
from app.core import time as clock
from app.models import (
    CLOSED_STATUSES,
    DeviceMode,
    EndSessionRequest,
    EndSessionResponse,
    JoinRequest,
    JoinResponse,
    LiveKitCredentials,
    Profile,
    Role,
    SessionCreateRequest,
    SessionRow,
    SessionStatus,
    SessionUpdateRequest,
    WhiteboardCredentials,
)
from app.repo import Repository, get_repo
from app.services.finalize import finalize_session, video_identities
from app.services.tokens import (
    close_livekit_room,
    ensure_livekit_room,
    make_livekit_token,
    make_whiteboard_token,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])
logger = logging.getLogger("app.sessions")

MAX_SESSION_LENGTH = timedelta(hours=4)


async def require_teacher(user: AuthUser, repo: Repository, message: str) -> Profile:
    profile = await repo.get_profile(user.id)
    if profile is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tài khoản chưa có hồ sơ")
    if profile.role != Role.teacher:
        raise HTTPException(status.HTTP_403_FORBIDDEN, message)
    return profile


async def _check_schedule(
    repo: Repository,
    teacher_id: str,
    start: datetime,
    end: datetime,
    exclude_id: str | None = None,
) -> None:
    invalid = status.HTTP_422_UNPROCESSABLE_CONTENT
    if end <= start:
        raise HTTPException(invalid, "Giờ kết thúc phải sau giờ bắt đầu")
    if end - start > MAX_SESSION_LENGTH:
        raise HTTPException(invalid, "Một buổi học dài tối đa 4 giờ")
    if end <= clock.now_utc():
        raise HTTPException(invalid, "Không xếp được buổi học vào thời gian đã qua")
    # shortcut: kiểm tra rồi mới ghi, hai yêu cầu cùng lúc vẫn có thể trùng giờ; đủ cho một giáo
    # viên, cần chặn tuyệt đối thì thêm exclusion constraint (btree_gist) trong migration
    if await repo.find_overlapping_session(teacher_id, start, end, exclude_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "Trùng giờ với một buổi học khác")


def _changed_meanwhile(updated: SessionRow | None, action: str) -> SessionRow:
    # Ghi có điều kiện theo trạng thái đã đọc: yêu cầu khác đã đổi trạng thái thì không ghi đè
    if updated is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Buổi học vừa thay đổi trạng thái, không {action} được"
        )
    return updated


async def _load_scheduled_for_teacher(
    session_id: UUID, user: AuthUser, repo: Repository, action: str
) -> SessionRow:
    profile, session = await _load_session_for_member(str(session_id), user, repo)
    if profile.role != Role.teacher:
        raise HTTPException(status.HTTP_403_FORBIDDEN, f"Chỉ giáo viên được {action} buổi học")
    if session.status != SessionStatus.scheduled:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Chỉ {action} được buổi học chưa bắt đầu")
    return session


async def _load_session_for_member(
    session_id: str, user: AuthUser, repo: Repository
) -> tuple[Profile, SessionRow]:
    """Trả về (hồ sơ, buổi học) nếu người dùng là giáo viên hoặc đúng học sinh của buổi đó."""
    profile = await repo.get_profile(user.id)
    if profile is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tài khoản chưa có hồ sơ")

    session = await repo.get_session(session_id)
    if session is None:
        # Cùng thông báo với trường hợp không có quyền để không lộ buổi học nào tồn tại
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy buổi học")

    student = await repo.get_student(session.student_id)
    if profile.role == Role.teacher:
        allowed = session.teacher_id == profile.id
    else:
        allowed = student is not None and student.profile_id == profile.id
    # Học sinh đang bị xóa hẳn: buổi học coi như không còn (không mở lại phòng, không lưu lại bảng)
    if not allowed or student is None or student.deleting_at is not None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy buổi học")
    return profile, session


@router.post("", response_model=SessionRow, status_code=201)
async def create_session(
    body: SessionCreateRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
) -> SessionRow:
    """Giáo viên xếp một buổi học 1-1 với học sinh của mình (tối đa 4 giờ, không trùng giờ)."""
    teacher = await require_teacher(user, repo, "Chỉ giáo viên được tạo buổi học")
    student = await repo.get_student(str(body.student_id))
    if student is None or student.teacher_id != teacher.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy học sinh")
    if not student.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Học sinh đã ngừng dạy")

    start, end = body.scheduled_start, body.scheduled_end
    await _check_schedule(repo, teacher.id, start, end)

    return await repo.insert_session(
        {
            "teacher_id": teacher.id,
            "student_id": student.id,
            "subject": body.subject or None,
            "topic": body.topic or None,
            "scheduled_start": start,
            "scheduled_end": end,
        }
    )


@router.patch("/{session_id}", response_model=SessionRow)
async def update_session(
    session_id: UUID,
    body: SessionUpdateRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
) -> SessionRow:
    """Giáo viên đổi môn, chủ đề hoặc giờ của buổi học chưa bắt đầu. Chỉ gửi trường cần đổi."""
    session = await _load_scheduled_for_teacher(session_id, user, repo, "sửa")
    fields = body.model_dump(exclude_unset=True)
    if "scheduled_start" in fields or "scheduled_end" in fields:
        start = fields.get("scheduled_start") or session.scheduled_start
        end = fields.get("scheduled_end") or session.scheduled_end
        await _check_schedule(repo, session.teacher_id, start, end, exclude_id=session.id)
    for key in ("subject", "topic"):
        if key in fields:
            fields[key] = (fields[key] or "").strip() or None
    if not fields:
        return session
    updated = await repo.update_session(session.id, fields, SessionStatus.scheduled)
    return _changed_meanwhile(updated, "sửa")


@router.post("/{session_id}/cancel", response_model=SessionRow)
async def cancel_session(
    session_id: UUID,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
) -> SessionRow:
    """Giáo viên hủy buổi học chưa bắt đầu (giữ lại trong lịch sử với trạng thái cancelled)."""
    session = await _load_scheduled_for_teacher(session_id, user, repo, "hủy")
    fields = {"status": SessionStatus.cancelled}
    updated = await repo.update_session(session.id, fields, SessionStatus.scheduled)
    return _changed_meanwhile(updated, "hủy")


async def _close_rejected_video(repo: Repository, settings: Settings, session: SessionRow) -> None:
    """Thu hồi rồi xóa bù phòng đã tạo cho lần vào lớp bị từ chối; lỗi để vòng nền làm tiếp."""
    try:
        identities = await video_identities(repo, session)
        await close_livekit_room(settings, session.room_name, identities)
    except Exception:
        logger.exception("Không xóa bù được phòng video %s", session.room_name)


@router.post("/{session_id}/join", response_model=JoinResponse)
async def join_session(
    session_id: UUID,
    body: JoinRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
    settings: Settings = Depends(get_settings),
) -> JoinResponse:
    profile, session = await _load_session_for_member(str(session_id), user, repo)

    if session.status in CLOSED_STATUSES:
        raise HTTPException(status.HTTP_409_CONFLICT, "Buổi học đã kết thúc hoặc bị hủy")

    now = clock.now_utc()
    opens = session.scheduled_start - timedelta(minutes=settings.join_early_minutes)
    closes = session.scheduled_end + timedelta(minutes=settings.join_late_minutes)
    if not (opens <= now <= closes):
        raise HTTPException(status.HTTP_409_CONFLICT, "Chưa đến hoặc đã quá giờ vào phòng")
    # Token sống đến hết khung giờ vào phòng: buổi dài 4 giờ rớt mạng giữa chừng vẫn nối lại được
    until_close = closes - now

    # Tablet ở chế độ board chỉ vào bảng viết, không vào (và không tạo) phòng video
    video = body.mode == DeviceMode.main
    if video:
        # Tạo phòng TRƯỚC lần đọc lại trạng thái bên dưới: buổi còn live thì /end (ghi completed
        # sau lần đọc đó) xóa phòng sau khi phòng đã có; buổi đã đóng thì ở đây xóa bù
        try:
            await ensure_livekit_room(settings, session.room_name, until_close)
        except Exception:
            logger.exception("Không tạo được phòng video %s", session.room_name)
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, "Chưa mở được phòng video, thử lại"
            ) from None

    if profile.role == Role.teacher and session.status == SessionStatus.scheduled:
        fields = {"status": SessionStatus.live, "started_at": now}
        if await repo.update_session(session.id, fields, SessionStatus.scheduled) is None:
            # Thiết bị khác của giáo viên vừa mở lớp thì vào tiếp; đã kết thúc/hủy thì không mở lại
            current = await repo.get_session(session.id)
            if current is None or current.status != SessionStatus.live:
                if video:
                    await _close_rejected_video(repo, settings, session)
                raise HTTPException(status.HTTP_409_CONFLICT, "Buổi học đã kết thúc hoặc bị hủy")

    await repo.add_attendance(session.id, profile.id, body.mode)
    # Ghi điểm danh rồi mới đọc lại trạng thái; /end ghi completed rồi mới đóng điểm danh. Một trong
    # hai bên luôn thấy bên kia: /end đóng lượt này, hoặc ở đây thấy buổi đã xong và không cấp token
    read_at = clock.now_utc()
    current = await repo.get_session(session.id)
    if current is None or current.status in CLOSED_STATUSES:
        ended_at = (current.ended_at if current else None) or clock.now_utc()
        await repo.close_attendance(session.id, ended_at)
        if video:
            # Thu hồi rồi mới xóa, như finalize: xóa bù có thể chạy trước khi finalize kịp thu hồi
            await _close_rejected_video(repo, settings, session)
        raise HTTPException(status.HTTP_409_CONFLICT, "Buổi học đã kết thúc hoặc bị hủy")

    livekit = None
    if video:
        livekit = LiveKitCredentials(
            url=settings.livekit_url,
            token=make_livekit_token(
                settings,
                identity=profile.id,
                name=profile.full_name or profile.role.value,
                room_name=session.room_name,
                min_ttl=until_close,
                not_before=read_at,
            ),
        )

    whiteboard = WhiteboardCredentials(
        url=settings.whiteboard_public_url,
        token=make_whiteboard_token(
            settings,
            user_id=profile.id,
            session_id=session.id,
            role=profile.role,
            mode=body.mode,
            min_ttl=until_close,
        ),
    )
    return JoinResponse(
        session_id=session.id,
        room_name=session.room_name,
        role=profile.role,
        mode=body.mode,
        livekit=livekit,
        whiteboard=whiteboard,
    )


@router.post("/{session_id}/end", response_model=EndSessionResponse)
async def end_session(
    session_id: UUID,
    body: EndSessionRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
    settings: Settings = Depends(get_settings),
) -> EndSessionResponse:
    """Giáo viên kết thúc buổi: tính một buổi đã dạy, đóng phòng video và bảng ở mọi thiết bị.

    Gọi lại được (bấm lặp, mất phản hồi): buổi đã kết thúc thì không tính thêm, chỉ làm nốt việc
    đóng phòng và lưu bảng còn thiếu. `finalize_pending` là true khi còn việc chưa xong; hệ thống
    tự thử lại sau, hoặc gọi lại endpoint này.
    """
    profile, session = await _load_session_for_member(str(session_id), user, repo)
    if profile.role != Role.teacher:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Chỉ giáo viên được kết thúc buổi học")
    if session.status == SessionStatus.live:
        fields: dict = {"status": SessionStatus.completed, "ended_at": clock.now_utc()}
        if body.summary is not None:
            fields["summary"] = body.summary
        if body.homework_note is not None:
            fields["homework_note"] = body.homework_note
        # Ghi dữ liệu trước (nguồn đúng để đếm buổi đã dạy), rồi mới đóng phòng
        updated = await repo.update_session(session.id, fields, SessionStatus.live)
        # None: yêu cầu kết thúc khác vừa ghi trước, dùng kết quả của nó
        session = updated or await repo.get_session(session.id) or session
    if session.status != SessionStatus.completed:
        raise HTTPException(status.HTTP_409_CONFLICT, "Buổi học không ở trạng thái đang diễn ra")

    done = session.finalized_at is not None or await finalize_session(repo, settings, session)
    return EndSessionResponse(
        session_id=session.id,
        status=SessionStatus.completed,
        ended_at=session.ended_at or clock.now_utc(),
        finalize_pending=not done,
    )

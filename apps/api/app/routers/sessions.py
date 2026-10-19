from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import AuthUser, get_current_user
from app.config import Settings, get_settings
from app.models import (
    DeviceMode,
    EndSessionRequest,
    EndSessionResponse,
    JoinRequest,
    JoinResponse,
    LiveKitCredentials,
    Profile,
    Role,
    SessionRow,
    SessionStatus,
    WhiteboardCredentials,
)
from app.repo import Repository, get_repo
from app.services.tokens import make_livekit_token, make_whiteboard_token

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

_CLOSED = {SessionStatus.completed, SessionStatus.cancelled, SessionStatus.no_show}


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

    if profile.role == Role.teacher:
        allowed = session.teacher_id == profile.id
    else:
        student = await repo.get_student(session.student_id)
        allowed = student is not None and student.profile_id == profile.id
    if not allowed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy buổi học")
    return profile, session


@router.post("/{session_id}/join", response_model=JoinResponse)
async def join_session(
    session_id: str,
    body: JoinRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
    settings: Settings = Depends(get_settings),
) -> JoinResponse:
    profile, session = await _load_session_for_member(session_id, user, repo)

    if session.status in _CLOSED:
        raise HTTPException(status.HTTP_409_CONFLICT, "Buổi học đã kết thúc hoặc bị hủy")

    now = datetime.now(UTC)
    opens = session.scheduled_start - timedelta(minutes=settings.join_early_minutes)
    closes = session.scheduled_end + timedelta(minutes=settings.join_late_minutes)
    if not (opens <= now <= closes):
        raise HTTPException(status.HTTP_409_CONFLICT, "Chưa đến hoặc đã quá giờ vào phòng")

    if profile.role == Role.teacher and session.status == SessionStatus.scheduled:
        await repo.update_session(session.id, {"status": SessionStatus.live, "started_at": now})

    await repo.add_attendance(session.id, profile.id, body.mode)

    # Tablet ở chế độ board chỉ vào bảng viết, không vào phòng video
    livekit = None
    if body.mode == DeviceMode.main:
        livekit = LiveKitCredentials(
            url=settings.livekit_url,
            token=make_livekit_token(
                settings,
                identity=profile.id,
                name=profile.full_name or profile.role.value,
                room_name=session.room_name,
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
    session_id: str,
    body: EndSessionRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
) -> EndSessionResponse:
    profile, session = await _load_session_for_member(session_id, user, repo)
    if profile.role != Role.teacher:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Chỉ giáo viên được kết thúc buổi học")
    if session.status != SessionStatus.live:
        raise HTTPException(status.HTTP_409_CONFLICT, "Buổi học không ở trạng thái đang diễn ra")

    ended_at = datetime.now(UTC)
    fields: dict = {"status": SessionStatus.completed, "ended_at": ended_at}
    if body.summary is not None:
        fields["summary"] = body.summary
    if body.homework_note is not None:
        fields["homework_note"] = body.homework_note
    await repo.update_session(session.id, fields)
    return EndSessionResponse(
        session_id=session.id, status=SessionStatus.completed, ended_at=ended_at
    )

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, Field


class Role(StrEnum):
    teacher = "teacher"
    student = "student"


class DeviceMode(StrEnum):
    """main: máy có camera/micro. board: tablet chỉ làm bảng viết (không vào phòng video)."""

    main = "main"
    board = "board"


class SessionStatus(StrEnum):
    scheduled = "scheduled"
    live = "live"
    completed = "completed"
    cancelled = "cancelled"
    no_show = "no_show"


class Profile(BaseModel):
    id: str
    role: Role
    full_name: str = ""


class StudentRow(BaseModel):
    id: str
    teacher_id: str
    profile_id: str | None = None
    full_name: str = ""


class SessionRow(BaseModel):
    id: str
    teacher_id: str
    student_id: str
    room_name: str
    status: SessionStatus
    scheduled_start: datetime
    scheduled_end: datetime
    started_at: datetime | None = None
    ended_at: datetime | None = None


class JoinRequest(BaseModel):
    mode: DeviceMode = DeviceMode.main


class LiveKitCredentials(BaseModel):
    url: str
    token: str


class WhiteboardCredentials(BaseModel):
    url: str
    token: str


class JoinResponse(BaseModel):
    session_id: str
    room_name: str
    role: Role
    mode: DeviceMode
    # None khi mode = board: tablet chỉ viết bảng, không vào phòng video (không tính phút video)
    livekit: LiveKitCredentials | None
    whiteboard: WhiteboardCredentials


class EndSessionRequest(BaseModel):
    summary: str | None = Field(default=None, max_length=5000)
    homework_note: str | None = Field(default=None, max_length=5000)


class EndSessionResponse(BaseModel):
    session_id: str
    status: SessionStatus
    ended_at: datetime


class MeResponse(BaseModel):
    id: str
    role: Role
    full_name: str

from datetime import date, datetime
from enum import StrEnum
from typing import Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator


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


# Buổi đã đóng không mở lại; phòng video của buổi đóng được xóa
CLOSED_STATUSES = frozenset(
    {SessionStatus.completed, SessionStatus.cancelled, SessionStatus.no_show}
)


class Profile(BaseModel):
    id: str
    role: Role
    full_name: str = ""


class StudentRow(BaseModel):
    id: str
    teacher_id: str
    profile_id: str | None = None
    full_name: str = ""
    grade: str | None = None
    goals: str | None = None
    notes: str | None = None
    guardian_name: str | None = None
    guardian_contact: str | None = None
    consent_at: datetime | None = None
    active: bool = True
    # Đang xóa hẳn (chưa dọn xong bảng, tệp, tài khoản): API và vòng lặp nền làm tiếp
    deleting_at: datetime | None = None


class SessionRow(BaseModel):
    id: str
    teacher_id: str
    student_id: str
    room_name: str
    subject: str | None = None
    topic: str | None = None
    status: SessionStatus
    scheduled_start: datetime
    scheduled_end: datetime
    started_at: datetime | None = None
    ended_at: datetime | None = None
    # Nội dung bảng cuối buổi, bucket "boards": <student_id>/<session_id>.json
    board_snapshot_path: str | None = None
    # completed mà chưa có finalized_at: còn việc đóng phòng/lưu bảng chờ thử lại
    finalized_at: datetime | None = None
    # Buổi sinh từ lịch cố định: (slot_id, slot_date) duy nhất, sửa giờ hay hủy cũng không sinh lại
    slot_id: str | None = None
    slot_date: date | None = None


class UploadIntent(BaseModel):
    """Bản đăng ký trước khi tải bảng lên Storage (bắt tay với việc xóa học sinh, quyết định 19)."""

    id: str
    student_id: str
    session_id: str
    created_at: datetime
    # Lần gần nhất bên xóa/vòng lặp nền đã dọn file của hàng này. Chỉ nghĩa là "đã dọn lần này";
    # hàng còn tồn tại nghĩa là uploader chưa xác nhận xong, vẫn có thể ghi muộn
    cleaned_at: datetime | None = None


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
    # Còn việc đóng phòng/lưu bảng chưa xong (hệ thống tự thử lại, hoặc gọi /end lần nữa)
    finalize_pending: bool = False


class MeResponse(BaseModel):
    id: str
    role: Role
    full_name: str


class PasswordResetRequest(BaseModel):
    password: str = Field(min_length=8, max_length=72)


class CreateAccountRequest(PasswordResetRequest):
    """Giáo viên đặt email và mật khẩu tạm cho học sinh (hoặc phụ huynh)."""

    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class CreateAccountResponse(BaseModel):
    student_id: str
    profile_id: str
    email: str


class SessionCreateRequest(BaseModel):
    student_id: UUID
    subject: str | None = Field(default=None, max_length=100)
    topic: str | None = Field(default=None, max_length=200)
    # Bắt buộc có múi giờ để không lệch giờ giữa trình duyệt và máy chủ
    scheduled_start: AwareDatetime
    scheduled_end: AwareDatetime


class StudentSummary(StudentRow):
    # Số buổi đã kết thúc (giáo viên bấm "Kết thúc"); dùng để đếm buổi đã dạy, đánh giá học sinh
    completed_sessions: int = 0


class MonthlyStudentCount(BaseModel):
    student_id: str
    full_name: str
    grade: str | None = None
    active: bool
    completed_sessions: int


class MonthlySessionReport(BaseModel):
    month: str
    timezone: str = "Asia/Ho_Chi_Minh"
    period_start: datetime
    period_end: datetime
    total: int
    students: list[MonthlyStudentCount]


class TeachingTopic(BaseModel):
    id: str
    name: str
    grade: str = ""


class TeachingTopicRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=200)
    grade: str = Field(default="", max_length=40)


class TeachingNoteRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    expected_revision: int = Field(ge=0, le=2147483647)
    summary_md: str = Field(default="", max_length=5000)
    understanding_level: str = Field(default="", max_length=100)
    improve_points: str = Field(default="", max_length=5000)
    homework_text: str = Field(default="", max_length=5000)
    topic_ids: list[UUID] = Field(default_factory=list, max_length=50)


class TeachingRecord(BaseModel):
    session_id: str
    scheduled_start: datetime
    subject: str | None = None
    scheduled_topic: str | None = None
    revision: int = 0
    updated_at: datetime | None = None
    summary_md: str = ""
    understanding_level: str = ""
    improve_points: str = ""
    homework_text: str = ""
    topic_ids: list[str] = Field(default_factory=list)


class _StudentFields(BaseModel):
    """Chuỗi rỗng ở trường tùy chọn nghĩa là xóa giá trị."""

    model_config = ConfigDict(str_strip_whitespace=True)

    grade: str | None = Field(default=None, max_length=40)
    goals: str | None = Field(default=None, max_length=1000)
    notes: str | None = Field(default=None, max_length=2000)
    guardian_name: str | None = Field(default=None, max_length=120)
    guardian_contact: str | None = Field(default=None, max_length=200)
    # true: ghi nhận phụ huynh đồng ý (máy chủ ghi thời điểm), false: rút lại
    consent: bool | None = None


class StudentCreateRequest(_StudentFields):
    full_name: str = Field(min_length=1, max_length=120)


class StudentUpdateRequest(_StudentFields):
    """Chỉ gửi trường cần đổi."""

    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    # false: ngừng dạy, true: dạy lại
    active: bool | None = None


class SessionUpdateRequest(BaseModel):
    """Sửa buổi học chưa bắt đầu. Chỉ gửi trường cần đổi."""

    subject: str | None = Field(default=None, max_length=100)
    topic: str | None = Field(default=None, max_length=200)
    scheduled_start: AwareDatetime | None = None
    scheduled_end: AwareDatetime | None = None


class WeeklySlot(BaseModel):
    """Lịch cố định hằng tuần (giờ Việt Nam). weekday: 1 = thứ Hai … 7 = Chủ nhật."""

    id: str
    teacher_id: str
    student_id: str
    weekday: int
    start_time: str  # "HH:MM"
    duration_minutes: int
    subject: str | None = None
    topic: str | None = None
    starts_on: date
    active: bool = True

    @field_validator("start_time", mode="before")
    @classmethod
    def _hh_mm(cls, value: str) -> str:
        return str(value)[:5]  # PostgreSQL trả "19:30:00"


class WeeklySlotCreate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    student_id: UUID
    weekday: int = Field(ge=1, le=7)
    start_time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    duration_minutes: int = Field(ge=30, le=240)
    subject: str = Field(default="", max_length=100)
    topic: str = Field(default="", max_length=200)
    starts_on: date | None = None


class WeeklySlotStop(BaseModel):
    """Chỉ hỗ trợ ngừng lịch; muốn đổi giờ thì ngừng lịch cũ và tạo lịch mới."""

    model_config = ConfigDict(extra="forbid")
    active: Literal[False]


class WeeklySlotCreated(BaseModel):
    slot: WeeklySlot
    created: int
    skipped: list[datetime]  # giờ bắt đầu (UTC) bị bỏ vì trùng buổi khác


class WeeklySlotStopped(BaseModel):
    slot: WeeklySlot
    cancelled: int

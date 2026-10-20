import logging
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.auth import AuthUser, get_current_user
from app.config import Settings, get_settings
from app.core import time as clock
from app.models import (
    CreateAccountRequest,
    CreateAccountResponse,
    PasswordResetRequest,
    StudentCreateRequest,
    StudentRow,
    StudentSummary,
    StudentUpdateRequest,
)
from app.repo import AuthAdminError, Repository, get_repo
from app.routers.sessions import require_teacher
from app.services.student_deletion import purge_student

router = APIRouter(prefix="/api/students", tags=["students"])

_EMAIL_TAKEN = {"email_exists", "user_already_exists"}
logger = logging.getLogger("app.students")


async def _load_own_student(
    student_id: UUID, user: AuthUser, repo: Repository, message: str
) -> StudentRow:
    """Học sinh của giáo viên đang gọi. Học sinh của giáo viên khác: 404 như không tồn tại."""
    teacher = await require_teacher(user, repo, message)
    student = await repo.get_student(str(student_id))
    if student is None or student.teacher_id != teacher.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Không tìm thấy học sinh")
    return student


def _not_deleting(student: StudentRow) -> StudentRow:
    if student.deleting_at is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "Học sinh đang được xóa, hãy bấm xóa lần nữa để hoàn tất"
        )
    return student


def _to_columns(fields: dict[str, Any], current: StudentRow | None = None) -> dict[str, Any]:
    """Đổi dữ liệu gửi lên thành cột: chuỗi rỗng thành null, consent thành consent_at."""
    columns = {k: (v or None) if isinstance(v, str) else v for k, v in fields.items()}
    if "consent" in columns:
        consent = columns.pop("consent")
        if not consent:
            columns["consent_at"] = None
        elif current is None or current.consent_at is None:
            columns["consent_at"] = clock.now_utc()  # giữ thời điểm đồng ý đầu tiên
    return columns


@router.get("", response_model=list[StudentSummary])
async def list_students(
    user: AuthUser = Depends(get_current_user), repo: Repository = Depends(get_repo)
) -> list[StudentSummary]:
    """Danh sách học sinh của giáo viên (kể cả đã ngừng dạy, ghi chú riêng) kèm số buổi đã dạy."""
    teacher = await require_teacher(user, repo, "Chỉ giáo viên được xem danh sách học sinh")
    counts = await repo.count_completed_sessions(teacher.id)
    return [
        StudentSummary(**s.model_dump(), completed_sessions=counts.get(s.id, 0))
        for s in await repo.list_students(teacher.id)
    ]


@router.post("", response_model=StudentRow, status_code=201)
async def create_student(
    body: StudentCreateRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
) -> StudentRow:
    """Giáo viên thêm hồ sơ học sinh (chưa có tài khoản đăng nhập)."""
    teacher = await require_teacher(user, repo, "Chỉ giáo viên được thêm học sinh")
    columns = _to_columns(body.model_dump(exclude_unset=True))
    return await repo.insert_student(columns | {"teacher_id": teacher.id})


@router.patch("/{student_id}", response_model=StudentRow)
async def update_student(
    student_id: UUID,
    body: StudentUpdateRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
) -> StudentRow:
    """Sửa hồ sơ, ghi nhận/rút đồng ý của phụ huynh, ngừng dạy (active=false) hoặc dạy lại."""
    student = await _load_own_student(student_id, user, repo, "Chỉ giáo viên được sửa học sinh")
    _not_deleting(student)
    fields = body.model_dump(exclude_unset=True)
    if fields.get("full_name") is None:
        fields.pop("full_name", None)  # họ tên không được xóa
    columns = _to_columns(fields, student)
    if not columns:
        return student
    return await repo.update_student(student.id, columns) or student


@router.delete("/{student_id}", status_code=204)
async def delete_student(
    student_id: UUID,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Xóa hẳn học sinh đã ngừng dạy: bảng viết (máy chủ bảng và Storage), ảnh bài nộp, buổi học,
    bài tập, bài nộp, tài khoản đăng nhập và hồ sơ. Không khôi phục được.

    Phải ngừng dạy trước để tránh xóa nhầm. Lỗi giữa chừng: trả 502, học sinh ở trạng thái đang xóa
    (`deleting_at`); gọi lại endpoint này hoặc chờ hệ thống tự làm tiếp.
    """
    student = await _load_own_student(student_id, user, repo, "Chỉ giáo viên được xóa học sinh")
    if student.deleting_at is None:
        if student.active:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Hãy ngừng dạy học sinh trước khi xóa hẳn"
            )
        marked = await repo.mark_student_deleting(student.id)
        if marked is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Học sinh vừa được dạy lại, không xóa")
        student = marked
    pending = await purge_student(repo, settings, student)
    if pending:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Chưa xóa xong: {', '.join(pending)}. Hệ thống sẽ tự thử lại; "
            "bạn cũng có thể bấm xóa lần nữa.",
        )
    return Response(status_code=204)


@router.post("/{student_id}/account", response_model=CreateAccountResponse, status_code=201)
async def create_student_account(
    student_id: UUID,
    body: CreateAccountRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
) -> CreateAccountResponse:
    """Giáo viên tạo tài khoản đăng nhập cho học sinh của mình (không cho tự đăng ký)."""
    student = await _load_own_student(
        student_id, user, repo, "Chỉ giáo viên được tạo tài khoản học sinh"
    )
    if student.profile_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Học sinh đã có tài khoản")
    if not student.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Học sinh đã ngừng dạy")

    email = body.email.lower()
    try:
        profile_id = await repo.create_auth_user(email, body.password, student.full_name)
    except AuthAdminError as exc:
        if exc.code in _EMAIL_TAKEN:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Email này đã được dùng cho tài khoản khác"
            ) from exc
        if exc.code == "weak_password":
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT, "Mật khẩu chưa đủ mạnh"
            ) from exc
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Không tạo được tài khoản với email này"
        ) from exc

    # Gắn thất bại thì xóa tài khoản vừa tạo, không để tài khoản mồ côi đăng nhập được
    try:
        linked = await repo.link_student_profile(student.id, profile_id)
    except Exception:
        await repo.delete_auth_user(profile_id)
        raise
    if not linked:
        await repo.delete_auth_user(profile_id)
        raise HTTPException(status.HTTP_409_CONFLICT, "Học sinh đã có tài khoản")
    return CreateAccountResponse(student_id=student.id, profile_id=profile_id, email=email)


@router.post("/{student_id}/password", status_code=204)
async def reset_student_password(
    student_id: UUID,
    body: PasswordResetRequest,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
) -> Response:
    """Giáo viên đặt mật khẩu mới khi học sinh quên (học sinh không tự lấy lại qua email)."""
    student = await _load_own_student(
        student_id, user, repo, "Chỉ giáo viên được đặt lại mật khẩu học sinh"
    )
    _not_deleting(student)
    if not student.profile_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "Học sinh chưa có tài khoản đăng nhập")
    try:
        await repo.set_auth_password(student.profile_id, body.password)
    except AuthAdminError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Mật khẩu chưa đủ mạnh") from exc
    return Response(status_code=204)

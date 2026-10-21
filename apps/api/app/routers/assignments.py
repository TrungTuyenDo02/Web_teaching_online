"""Bài tập, nộp ảnh bài làm, OCR bằng Gemini, chấm và trả bài (0011: mọi thao tác ghi qua đây).

Không log nội dung ảnh, bản chép hay nhận xét. Người không có quyền nhận 404 như khi không tồn tại.
"""

import uuid
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.auth import AuthUser, get_current_user
from app.config import Settings, get_settings
from app.core import time as clock
from app.models import (
    AssignmentCreate,
    AssignmentRow,
    AssignmentStatus,
    Role,
    StudentRow,
    SubmissionFileRow,
    SubmissionReturn,
    SubmissionRow,
    SubmissionStatus,
    SubmissionTranscript,
)
from app.repo import Repository, get_repo
from app.routers.sessions import require_teacher
from app.services import gemini, images

router = APIRouter(prefix="/api", tags=["assignments"])

_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


async def _read_image(request: Request, settings: Settings) -> tuple[bytes, str]:
    """Đọc thân request (ảnh thô), dừng ngay khi vượt giới hạn; kiểm loại và gỡ metadata."""
    limit = settings.submission_max_bytes
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(413, f"Ảnh quá lớn (tối đa {limit // (1024 * 1024)} MB)")
    body = bytearray()
    async for chunk in request.stream():
        body += chunk
        if len(body) > limit:
            raise HTTPException(413, f"Ảnh quá lớn (tối đa {limit // (1024 * 1024)} MB)")
    try:
        return images.clean(bytes(body), limit)
    except images.InvalidImage as exc:
        raise HTTPException(422, str(exc)) from None


async def _student_of(user: AuthUser, repo: Repository, student_id: str, missing: str):
    """(hồ sơ, học sinh) nếu người gọi là GV của học sinh hoặc chính học sinh; không thì 404."""
    profile = await repo.get_profile(user.id)
    if profile is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tài khoản chưa có hồ sơ")
    student = await repo.get_student(student_id)
    if student is None or student.deleting_at is not None:
        raise HTTPException(404, missing)
    owner = (
        student.teacher_id == profile.id
        if profile.role == Role.teacher
        else student.profile_id == profile.id
    )
    if not owner:
        raise HTTPException(404, missing)
    return profile, student


async def _load_submission(user: AuthUser, repo: Repository, submission_id: UUID, role: Role):
    missing = "Không tìm thấy bài nộp"
    submission = await repo.get_submission(str(submission_id))
    if submission is None:
        raise HTTPException(404, missing)
    profile, student = await _student_of(user, repo, submission.student_id, missing)
    if profile.role != role:
        raise HTTPException(404, missing)
    return profile, student, submission


async def _store(
    repo: Repository,
    student: StudentRow,
    submission: SubmissionRow,
    data: bytes,
    mime: str,
) -> SubmissionFileRow:
    path = f"{student.id}/{submission.id}/{uuid.uuid4().hex}.{_EXT[mime]}"
    await repo.upload_submission_object(path, data, mime)
    row = await repo.insert_submission_file(
        {
            "submission_id": submission.id,
            "storage_path": path,
            "mime_type": mime,
            "size_bytes": len(data),
        }
    )
    # Học sinh bị xóa hẳn trong lúc tải lên: dọn ảnh vừa ghi để không còn tệp mồ côi.
    # shortcut: kiểm lại sau khi ghi, không có bắt tay bền như board_upload_intents; tiến trình chết
    # đúng lúc này thì lần xóa thử lại (purge thư mục học sinh) vẫn dọn được.
    current = await repo.get_student(student.id)
    if current is None or current.deleting_at is not None:
        await repo.delete_submission_object(path)
        raise HTTPException(404, "Không tìm thấy bài nộp")
    return row


@router.post("/assignments", response_model=AssignmentRow, status_code=201)
async def create_assignment(
    body: AssignmentCreate,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
):
    """Giáo viên giao bài cho một học sinh đang học của mình (tiêu đề, mô tả, hạn nộp)."""
    profile = await require_teacher(user, repo, "Chỉ giáo viên được giao bài")
    student = await repo.get_student(str(body.student_id))
    if (
        student is None
        or student.teacher_id != profile.id
        or student.deleting_at is not None
        or not student.active
    ):
        raise HTTPException(404, "Không tìm thấy học sinh")
    return await repo.insert_assignment(
        {
            "student_id": student.id,
            "title": body.title,
            "description": body.description or None,
            "due_at": body.due_at,
        }
    )


@router.post(
    "/assignments/{assignment_id}/submissions", response_model=SubmissionRow, status_code=201
)
async def submit_assignment(
    assignment_id: UUID,
    request: Request,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
    settings: Settings = Depends(get_settings),
):
    """Học sinh nộp bài: thân request là ảnh đầu tiên (JPEG/PNG/WebP), ảnh sau gửi qua /files."""
    missing = "Không tìm thấy bài tập"
    assignment = await repo.get_assignment(str(assignment_id))
    if assignment is None:
        raise HTTPException(404, missing)
    profile, student = await _student_of(user, repo, assignment.student_id, missing)
    if profile.role != Role.student:
        raise HTTPException(404, missing)
    if assignment.status == AssignmentStatus.returned:
        raise HTTPException(409, "Bài này thầy cô đã chấm và trả, không nộp thêm được.")
    data, mime = await _read_image(request, settings)
    # shortcut: mỗi lần gọi là một lượt nộp mới, chưa giới hạn số lượt (spec OQ11 đề xuất 3)
    submission = await repo.insert_submission(
        {"student_id": student.id, "assignment_id": assignment.id}
    )
    await _store(repo, student, submission, data, mime)
    await repo.update_assignment(assignment.id, {"status": AssignmentStatus.submitted})
    return submission


@router.post(
    "/submissions/{submission_id}/files", response_model=SubmissionFileRow, status_code=201
)
async def add_submission_file(
    submission_id: UUID,
    request: Request,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
    settings: Settings = Depends(get_settings),
):
    """Học sinh thêm ảnh vào bài vừa nộp, khi thầy cô chưa bắt đầu chấm."""
    _, student, submission = await _load_submission(user, repo, submission_id, Role.student)
    if submission.status != SubmissionStatus.submitted:
        raise HTTPException(409, "Thầy cô đã bắt đầu chấm bài này, không thêm ảnh được.")
    if len(await repo.list_submission_files(submission.id)) >= settings.submission_max_files:
        raise HTTPException(409, f"Mỗi bài nộp tối đa {settings.submission_max_files} ảnh.")
    data, mime = await _read_image(request, settings)
    return await _store(repo, student, submission, data, mime)


@router.post("/submissions/{submission_id}/ocr", response_model=SubmissionTranscript)
async def ocr_submission(
    submission_id: UUID,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
    settings: Settings = Depends(get_settings),
):
    """Giáo viên nhờ Gemini chép lại chữ/công thức trong ảnh bài làm (không giải, không chấm).

    Chỉ khi đã ghi nhận phụ huynh đồng ý; mỗi lần tính một lượt trợ lý AI của giáo viên.
    """
    if not (settings.ocr_enabled and settings.gemini_api_key and settings.gemini_ocr_model):
        raise HTTPException(503, "Đọc bài bằng AI chưa được bật hoặc cấu hình.")
    profile, student, submission = await _load_submission(user, repo, submission_id, Role.teacher)
    if student.consent_at is None:
        raise HTTPException(
            409,
            "Chưa ghi nhận phụ huynh đồng ý cho lưu dữ liệu học tập, nên chưa gửi ảnh cho AI đọc.",
        )
    files = await repo.list_submission_files(submission.id)
    if not files:
        raise HTTPException(409, "Bài nộp chưa có ảnh.")
    allowed = await repo.reserve_assistant_turn(
        profile.id,
        clock.as_vietnam(clock.now_utc()).date(),
        settings.assistant_daily_user_turns,
        settings.assistant_daily_total_turns,
    )
    if not allowed:
        raise HTTPException(429, "Đã hết lượt AI hôm nay. Hãy thử lại vào ngày mai.")
    try:
        # Gỡ metadata lần nữa trước khi gửi ra ngoài (ảnh cũ có thể lưu trước khi có bước gỡ)
        batch = [
            images.clean(
                await repo.download_submission_object(f.storage_path),
                settings.submission_max_bytes,
            )
            for f in files[: settings.submission_max_files]
        ]
        content = await gemini.transcribe(settings, batch)
    except (images.InvalidImage, gemini.OCRUnavailable):
        raise HTTPException(
            502, "AI chưa đọc được ảnh. Hãy thử lại sau hoặc tự xem ảnh bài làm."
        ) from None
    except httpx.HTTPError:
        raise HTTPException(503, "Chưa tải được ảnh bài làm. Hãy thử lại sau.") from None
    current = await repo.get_student(student.id)
    if current is None or current.deleting_at is not None:
        raise HTTPException(404, "Không tìm thấy bài nộp")
    row = await repo.insert_transcript(
        {"submission_id": submission.id, "model": settings.gemini_ocr_model, "content": content}
    )
    await repo.update_submission(
        submission.id, {"status": SubmissionStatus.reviewing}, SubmissionStatus.submitted
    )
    return row


@router.post("/submissions/{submission_id}/return", response_model=SubmissionRow)
async def return_submission(
    submission_id: UUID,
    body: SubmissionReturn,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
):
    """Giáo viên trả bài: nhận xét và điểm (0–10, tùy chọn); trả lại lần nữa thì sửa nhận xét."""
    _, _, submission = await _load_submission(user, repo, submission_id, Role.teacher)
    updated = await repo.update_submission(
        submission.id,
        {
            "status": SubmissionStatus.returned,
            "teacher_comment": body.teacher_comment or None,
            "score": body.score,
            "returned_at": clock.now_utc(),
        },
    )
    if updated is None:
        raise HTTPException(404, "Không tìm thấy bài nộp")
    if submission.assignment_id:
        await repo.update_assignment(
            submission.assignment_id, {"status": AssignmentStatus.returned}
        )
    return updated

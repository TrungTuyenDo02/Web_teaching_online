import asyncio
import os
import random
import time
import uuid
from collections.abc import Awaitable, Callable, Iterator
from datetime import UTC, date, datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient
from livekit import api as lk

# Không chạy vòng lặp no_show thật trong lifespan khi test (lifespan đọc cấu hình thật)
os.environ["NO_SHOW_INTERVAL_SECONDS"] = "0"

from app.assistant_models import AssistantMaterial, MaterialInput  # noqa: E402
from app.config import Settings, get_settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import (  # noqa: E402
    AssignmentRow,
    DeviceMode,
    Profile,
    Role,
    SessionRow,
    SessionStatus,
    StudentRow,
    SubmissionFileRow,
    SubmissionRow,
    SubmissionStatus,
    SubmissionTranscript,
    TeachingNoteRequest,
    TeachingRecord,
    TeachingTopic,
    UploadIntent,
    WeeklySlot,
)
from app.repo import AuthAdminError, get_repo  # noqa: E402
from app.services.board_document import BoardSnapshot  # noqa: E402

TEACHER_ID = "11111111-1111-1111-1111-111111111111"
STUDENT_PROFILE_ID = "22222222-2222-2222-2222-222222222222"
OTHER_STUDENT_PROFILE_ID = "33333333-3333-3333-3333-333333333333"
STUDENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
OTHER_STUDENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
NO_ACCOUNT_STUDENT_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd"
OTHER_TEACHER_ID = "44444444-4444-4444-4444-444444444444"
FOREIGN_STUDENT_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
SESSION_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"


def make_settings() -> Settings:
    return Settings(
        _env_file=None,
        app_env="development",
        supabase_url="https://example.supabase.co",
        supabase_service_role_key="service-role",
        supabase_jwt_secret="test-supabase-jwt-secret-0123456789abcdef",
        livekit_url="wss://example.livekit.cloud",
        livekit_api_key="lk-key",
        livekit_api_secret="lk-secret-0123456789abcdef0123456789abcdef",
        whiteboard_jwt_secret="test-whiteboard-secret-0123456789abcdef",
    )


class FakeRepo:
    def __init__(self) -> None:
        self.assistant_materials: dict[str, AssistantMaterial] = {}
        self.assistant_usage: dict[tuple[str, date], int] = {}
        self.assistant_global_usage: dict[date, int] = {}
        now = datetime.now(UTC)
        self.profiles = {
            TEACHER_ID: Profile(id=TEACHER_ID, role=Role.teacher, full_name="Cô Thử"),
            STUDENT_PROFILE_ID: Profile(id=STUDENT_PROFILE_ID, role=Role.student, full_name="Em A"),
            OTHER_STUDENT_PROFILE_ID: Profile(
                id=OTHER_STUDENT_PROFILE_ID, role=Role.student, full_name="Em B"
            ),
            OTHER_TEACHER_ID: Profile(
                id=OTHER_TEACHER_ID, role=Role.teacher, full_name="Thầy Khác"
            ),
        }
        self.students = {
            STUDENT_ID: StudentRow(
                id=STUDENT_ID,
                teacher_id=TEACHER_ID,
                profile_id=STUDENT_PROFILE_ID,
                full_name="Em A",
            ),
            OTHER_STUDENT_ID: StudentRow(
                id=OTHER_STUDENT_ID,
                teacher_id=TEACHER_ID,
                profile_id=OTHER_STUDENT_PROFILE_ID,
                full_name="Em B",
            ),
            NO_ACCOUNT_STUDENT_ID: StudentRow(
                id=NO_ACCOUNT_STUDENT_ID, teacher_id=TEACHER_ID, full_name="Em C"
            ),
            FOREIGN_STUDENT_ID: StudentRow(
                id=FOREIGN_STUDENT_ID, teacher_id=OTHER_TEACHER_ID, full_name="Em D"
            ),
        }
        self.sessions = {
            SESSION_ID: SessionRow(
                id=SESSION_ID,
                teacher_id=TEACHER_ID,
                student_id=STUDENT_ID,
                room_name="room-test",
                status=SessionStatus.scheduled,
                scheduled_start=now - timedelta(minutes=5),
                scheduled_end=now + timedelta(minutes=55),
            )
        }
        self.attendance: list[tuple[str, str, DeviceMode]] = []
        self.attendance_open: set[int] = set()  # chỉ số các lượt trong attendance chưa có left_at
        # Chạy ngay trước/sau lần add_attendance tới: giả lập yêu cầu khác ghi xen vào
        self.before_next_attendance: Callable[[], None] | None = None
        self.after_next_attendance: Callable[[], None] | None = None
        self.auth_users: dict[str, str] = {}  # email -> id
        self.fail_link = False
        self.passwords: dict[str, str] = {}  # user_id -> mật khẩu đặt lại
        self.attendance_closed: dict[str, datetime] = {}  # session_id -> left_at
        self.board_files: dict[str, BoardSnapshot] = {}  # đường dẫn trong bucket boards -> nội dung
        self.fail_board_upload = False
        self.submission_files: dict[str, bytes] = {}  # đường dẫn trong bucket submissions
        self.assignments: dict[str, AssignmentRow] = {}
        self.submissions: dict[str, SubmissionRow] = {}
        self.submission_rows: list[SubmissionFileRow] = []
        self.transcripts: list[SubmissionTranscript] = []
        self.fail_storage_purge = False
        self.upload_intents: dict[str, UploadIntent] = {}
        # Điều khiển thứ tự: save_board_snapshot báo upload_waiting rồi chờ upload_gate
        self.upload_gate: asyncio.Event | None = None
        self.upload_waiting: asyncio.Event | None = None
        # Sau khi ghi: báo upload_written rồi chờ after_upload (hủy tác vụ ở đây = tiến trình chết)
        self.upload_written: asyncio.Event | None = None
        self.after_upload: asyncio.Event | None = None
        self.fail_auth_delete = False
        self.fail_close_attendance = False
        self.fail_update_fields: set[str] = set()  # update_session có trường này thì lỗi
        # Chạy ngay trước lần update_session tới: giả lập yêu cầu khác ghi xen giữa đọc và ghi
        self.before_next_update: Callable[[], None] | None = None
        # Chờ (await) ngay SAU lần get_session đầu tiên kể từ add_attendance gần nhất, tức lần đọc
        # lại cuối của /join: giả lập join bị treo sau khi đã thấy trạng thái buổi
        self.after_reread: Callable[[], Awaitable[None]] | None = None
        self._reread_pending = False
        self.rng: random.Random | None = None  # có thì nhường vòng lặp ngẫu nhiên mỗi lệnh
        self.teaching_topics: dict[str, dict] = {}
        self.weekly_slots: dict[str, WeeklySlot] = {}
        self.teaching_records: dict[str, TeachingRecord] = {}
        self.before_save_teaching_record: Callable[[], None] | None = None

    # ---------- Bài tập, bài nộp, OCR (0011) ----------
    async def insert_assignment(self, fields: dict[str, Any]) -> AssignmentRow:
        row = AssignmentRow(
            id=str(uuid.uuid4()), status="assigned", created_at=datetime.now(UTC), **fields
        )
        self.assignments[row.id] = row
        return row

    async def get_assignment(self, assignment_id: str) -> AssignmentRow | None:
        return self.assignments.get(assignment_id)

    async def update_assignment(
        self, assignment_id: str, fields: dict[str, Any]
    ) -> AssignmentRow | None:
        row = self.assignments.get(assignment_id)
        if row is None:
            return None
        self.assignments[assignment_id] = row.model_copy(update=fields)
        return self.assignments[assignment_id]

    async def insert_submission(self, fields: dict[str, Any]) -> SubmissionRow:
        row = SubmissionRow(
            id=str(uuid.uuid4()), status="submitted", submitted_at=datetime.now(UTC), **fields
        )
        self.submissions[row.id] = row
        return row

    async def get_submission(self, submission_id: str) -> SubmissionRow | None:
        return self.submissions.get(submission_id)

    async def update_submission(
        self,
        submission_id: str,
        fields: dict[str, Any],
        expected_status: SubmissionStatus | None = None,
    ) -> SubmissionRow | None:
        row = self.submissions.get(submission_id)
        if row is None or (expected_status and row.status != expected_status):
            return None
        self.submissions[submission_id] = row.model_copy(update=fields)
        return self.submissions[submission_id]

    async def list_submission_files(self, submission_id: str) -> list[SubmissionFileRow]:
        return [f for f in self.submission_rows if f.submission_id == submission_id]

    async def insert_submission_file(self, fields: dict[str, Any]) -> SubmissionFileRow:
        row = SubmissionFileRow(id=str(uuid.uuid4()), **fields)
        self.submission_rows.append(row)
        return row

    async def delete_submission_file(self, file_id: str) -> None:
        self.submission_rows = [f for f in self.submission_rows if f.id != file_id]

    async def upload_submission_object(self, path: str, data: bytes, mime: str) -> None:
        if path in self.submission_files:
            raise AssertionError("không ghi đè ảnh bài làm")
        self.submission_files[path] = data

    async def download_submission_object(self, path: str) -> bytes:
        return self.submission_files[path]

    async def delete_submission_object(self, path: str) -> None:
        self.submission_files.pop(path, None)

    async def insert_transcript(self, fields: dict[str, Any]) -> SubmissionTranscript:
        row = SubmissionTranscript(id=str(uuid.uuid4()), created_at=datetime.now(UTC), **fields)
        self.transcripts.append(row)
        return row

    async def list_teacher_sessions(
        self, teacher_id: str, start: datetime, end: datetime
    ) -> list[SessionRow]:
        rows = [
            s
            for s in self.sessions.values()
            if s.teacher_id == teacher_id and start <= s.scheduled_start < end
        ]
        return sorted(rows, key=lambda s: (s.scheduled_start, s.id))

    async def list_weekly_slots(self, teacher_id: str) -> list[WeeklySlot]:
        mine = [w for w in self.weekly_slots.values() if w.teacher_id == teacher_id]
        return sorted(mine, key=lambda w: (not w.active, w.weekday, w.start_time, w.id))

    async def list_all_weekly_slots(self) -> list[WeeklySlot]:
        return list(self.weekly_slots.values())

    async def get_weekly_slot(self, slot_id: str) -> WeeklySlot | None:
        return self.weekly_slots.get(slot_id)

    async def insert_weekly_slot(self, fields: dict[str, Any]) -> WeeklySlot:
        row = WeeklySlot(id=str(uuid.uuid4()), **fields)
        self.weekly_slots[row.id] = row
        return row

    async def update_weekly_slot(self, slot_id: str, fields: dict[str, Any]) -> WeeklySlot | None:
        if slot_id not in self.weekly_slots:
            return None
        self.weekly_slots[slot_id] = self.weekly_slots[slot_id].model_copy(update=fields)
        return self.weekly_slots[slot_id]

    async def list_slot_dates(self, slot_id: str) -> set[date]:
        return {s.slot_date for s in self.sessions.values() if s.slot_id == slot_id and s.slot_date}

    async def insert_slot_session(self, fields: dict[str, Any]) -> bool:
        # Như unique (slot_id, slot_date) trong 0009: không await trước khi ghi nên nguyên tử
        key = (fields["slot_id"], fields["slot_date"])
        if any((s.slot_id, s.slot_date) == key for s in self.sessions.values()):
            return False
        await self.insert_session(fields)
        return True

    async def cancel_future_slot_sessions(self, slot_id: str, after: datetime) -> int:
        ids = [
            s.id
            for s in self.sessions.values()
            if s.slot_id == slot_id
            and s.status == SessionStatus.scheduled
            and s.scheduled_start > after
        ]
        for sid in ids:
            self.sessions[sid] = self.sessions[sid].model_copy(
                update={"status": SessionStatus.cancelled}
            )
        return len(ids)

    async def list_assistant_materials(self, actor_id: str) -> list[AssistantMaterial]:
        profile = self.profiles.get(actor_id)
        if not profile:
            return []
        if profile.role == Role.teacher:
            return [m for m in self.assistant_materials.values() if m.teacher_id == actor_id]
        result = []
        for material in self.assistant_materials.values():
            if not material.student_visible:
                continue
            for session in self.sessions.values():
                student = self.students.get(session.student_id)
                record = self.teaching_records.get(session.id)
                if (
                    student
                    and student.profile_id == actor_id
                    and student.deleting_at is None
                    and student.teacher_id == session.teacher_id == material.teacher_id
                    and session.status == SessionStatus.completed
                    and record
                    and material.topic_id in record.topic_ids
                ):
                    result.append(material)
                    break
        return result

    async def create_assistant_material(
        self, actor_id: str, body: MaterialInput
    ) -> AssistantMaterial | None:
        topic = self.teaching_topics.get(str(body.topic_id))
        if not topic or topic["teacher_id"] != actor_id:
            return None
        from app.core import time as app_clock

        row = AssistantMaterial(
            id=str(uuid.uuid4()),
            teacher_id=actor_id,
            topic_id=str(body.topic_id),
            title=body.title,
            content=body.content,
            student_visible=body.student_visible,
            created_at=app_clock.now_utc(),
        )
        self.assistant_materials[row.id] = row
        return row

    async def delete_assistant_material(self, actor_id: str, material_id: str) -> bool:
        row = self.assistant_materials.get(material_id)
        if not row or row.teacher_id != actor_id:
            return False
        del self.assistant_materials[material_id]
        return True

    async def search_assistant_chunks(self, actor_id: str, query: str) -> list[dict]:
        import re

        words = re.findall(r"[^\W_]{2,}", query.lower())
        return [
            {
                "material_id": m.id,
                "sequence": i // 1000,
                "title": m.title,
                "content": m.content[i : i + 1200],
            }
            for m in await self.list_assistant_materials(actor_id)
            for i in range(0, len(m.content), 1000)
            if any(w in m.content[i : i + 1200].lower() for w in words)
        ][:4]

    async def reserve_assistant_turn(
        self, actor_id: str, day: date, user_limit: int, total_limit: int
    ) -> bool:
        key = (actor_id, day)
        if self.assistant_usage.get(key, 0) >= max(
            min(user_limit, 1000), 1
        ) or self.assistant_global_usage.get(day, 0) >= max(min(total_limit, 10000), 1):
            return False
        self.assistant_usage[key] = self.assistant_usage.get(key, 0) + 1
        self.assistant_global_usage[day] = self.assistant_global_usage.get(day, 0) + 1
        return True

    async def list_teaching_topics(self, teacher_id: str) -> list[TeachingTopic]:
        return [
            TeachingTopic.model_validate(t)
            for t in sorted(self.teaching_topics.values(), key=lambda t: (t["name"], t["id"]))
            if t["teacher_id"] == teacher_id
        ]

    async def create_teaching_topic(self, teacher_id: str, name: str, grade: str) -> TeachingTopic:
        for row in self.teaching_topics.values():
            if (row["teacher_id"], row["name"], row["grade"]) == (teacher_id, name, grade):
                return TeachingTopic.model_validate(row)
        row = {"id": str(uuid.uuid4()), "teacher_id": teacher_id, "name": name, "grade": grade}
        self.teaching_topics[row["id"]] = row
        return TeachingTopic.model_validate(row)

    async def get_teaching_record(self, teacher_id: str, session_id: str) -> TeachingRecord | None:
        session = self.sessions.get(session_id)
        student = self.students.get(session.student_id) if session else None
        if (
            not session
            or session.teacher_id != teacher_id
            or session.status != SessionStatus.completed
            or not student
            or student.deleting_at is not None
            or student.teacher_id != teacher_id
        ):
            return None
        return self.teaching_records.get(
            session_id,
            TeachingRecord(
                session_id=session.id,
                scheduled_start=session.scheduled_start,
                subject=session.subject,
                scheduled_topic=session.topic,
            ),
        ).model_copy(deep=True)

    async def list_teaching_records(
        self, teacher_id: str, student_id: str, start: datetime, end: datetime
    ) -> list[TeachingRecord]:
        records = []
        for session in sorted(self.sessions.values(), key=lambda s: (s.scheduled_start, s.id)):
            if session.student_id == student_id and start <= session.scheduled_start < end:
                row = await self.get_teaching_record(teacher_id, session.id)
                if row:
                    records.append(row)
        return records

    async def save_teaching_record(
        self, teacher_id: str, session_id: str, body: TeachingNoteRequest
    ) -> tuple[str, TeachingRecord | None]:
        if self.before_save_teaching_record:
            hook, self.before_save_teaching_record = self.before_save_teaching_record, None
            hook()
        session = self.sessions.get(session_id)
        student = self.students.get(session.student_id) if session else None
        profile = self.profiles.get(teacher_id)
        if (
            not session
            or session.teacher_id != teacher_id
            or not student
            or student.teacher_id != teacher_id
            or student.deleting_at is not None
            or not profile
            or profile.role != Role.teacher
        ):
            return "not_found", None
        if session.status != SessionStatus.completed:
            return "not_completed", None
        topic_ids = sorted({str(t) for t in body.topic_ids})
        if any(
            t not in self.teaching_topics or self.teaching_topics[t]["teacher_id"] != teacher_id
            for t in topic_ids
        ):
            return "invalid_topics", None
        current = self.teaching_records.get(session_id)
        revision = current.revision if current else 0
        if body.expected_revision != revision:
            return "conflict", None
        from app.core import time as clock

        record = TeachingRecord(
            session_id=session_id,
            scheduled_start=session.scheduled_start,
            subject=session.subject,
            scheduled_topic=session.topic,
            revision=revision + 1,
            updated_at=clock.now_utc(),
            **body.model_dump(exclude={"expected_revision", "topic_ids"}),
            topic_ids=topic_ids,
        )
        self.teaching_records[session_id] = record
        return "ok", record.model_copy(deep=True)

    async def _step(self) -> None:
        if self.rng:
            for _ in range(self.rng.randint(0, 3)):
                await asyncio.sleep(0)

    async def get_profile(self, user_id: str) -> Profile | None:
        return self.profiles.get(user_id)

    async def get_session(self, session_id: str) -> SessionRow | None:
        await self._step()
        row = self.sessions.get(session_id)
        if self._reread_pending:
            self._reread_pending = False
            if hook := self.after_reread:
                self.after_reread = None
                await hook()
        return row

    async def get_session_by_room_name(self, room_name: str) -> SessionRow | None:
        return next((s for s in self.sessions.values() if s.room_name == room_name), None)

    async def get_student(self, student_id: str) -> StudentRow | None:
        return self.students.get(student_id)

    async def update_session(
        self,
        session_id: str,
        fields: dict[str, Any],
        expected_status: SessionStatus | None = None,
    ) -> SessionRow | None:
        await self._step()
        if self.before_next_update:
            hook, self.before_next_update = self.before_next_update, None
            hook()
        if self.fail_update_fields & fields.keys():
            raise RuntimeError("PostgREST không trả lời")
        session = self.sessions.get(session_id)
        if session is None or (expected_status and session.status != expected_status):
            return None
        self.sessions[session_id] = session.model_copy(update=fields)
        return self.sessions[session_id]

    async def add_attendance(self, session_id: str, profile_id: str, mode: DeviceMode) -> None:
        if self.before_next_attendance:
            hook, self.before_next_attendance = self.before_next_attendance, None
            hook()
        await self._step()
        self.attendance.append((session_id, profile_id, mode))
        self.attendance_open.add(len(self.attendance) - 1)
        self._reread_pending = True
        if self.after_next_attendance:
            hook, self.after_next_attendance = self.after_next_attendance, None
            hook()

    def open_attendance(self) -> list[tuple[str, str, DeviceMode]]:
        return [self.attendance[i] for i in sorted(self.attendance_open)]

    def close_open_attendance(self, session_id: str) -> None:
        self.attendance_open = {
            i for i in self.attendance_open if self.attendance[i][0] != session_id
        }

    async def save_board_snapshot(
        self, student_id: str, session_id: str, elements: BoardSnapshot
    ) -> str:
        if self.upload_gate is not None:
            if self.upload_waiting is not None:
                self.upload_waiting.set()
            await self.upload_gate.wait()
        if self.fail_board_upload:
            raise RuntimeError("Storage không trả lời")
        path = f"{student_id}/{session_id}.json"
        self.board_files[path] = elements
        if self.upload_written is not None:
            self.upload_written.set()
        if self.after_upload is not None:
            await self.after_upload.wait()
        return path

    async def close_attendance(self, session_id: str, left_at: datetime) -> None:
        await self._step()
        if self.fail_close_attendance:
            raise RuntimeError("PostgREST không trả lời")
        self.attendance_closed.setdefault(session_id, left_at)
        self.close_open_attendance(session_id)

    async def list_unfinalized_sessions(self, ended_before: datetime) -> list[SessionRow]:
        return [
            s
            for s in self.sessions.values()
            if s.status == SessionStatus.completed
            and s.finalized_at is None
            and s.ended_at is not None
            and s.ended_at < ended_before
            and self.students[s.student_id].deleting_at is None
        ]

    async def mark_student_deleting(self, student_id: str) -> StudentRow | None:
        student = self.students.get(student_id)
        if student is None or student.active:
            return None
        if student.deleting_at is None:
            student = student.model_copy(update={"deleting_at": datetime.now(UTC)})
            self.students[student_id] = student
        return student

    async def list_deleting_students(self, before: datetime) -> list[StudentRow]:
        return [s for s in self.students.values() if s.deleting_at and s.deleting_at < before]

    async def list_student_sessions(self, student_id: str) -> list[SessionRow]:
        return [s for s in self.sessions.values() if s.student_id == student_id]

    async def add_upload_intent(self, student_id: str, session_id: str) -> UploadIntent:
        intent = UploadIntent(
            id=str(uuid.uuid4()),
            student_id=student_id,
            session_id=session_id,
            created_at=datetime.now(UTC),
        )
        self.upload_intents[intent.id] = intent
        return intent

    async def delete_upload_intent(self, intent_id: str) -> None:
        self.upload_intents.pop(intent_id, None)

    async def mark_upload_intent_cleaned(self, intent_id: str, at: datetime) -> None:
        intent = self.upload_intents.get(intent_id)
        if intent is not None:
            self.upload_intents[intent_id] = intent.model_copy(update={"cleaned_at": at})

    async def list_upload_intents(
        self, student_id: str | None = None, created_before: datetime | None = None
    ) -> list[UploadIntent]:
        rows = [
            i
            for i in self.upload_intents.values()
            if (student_id is None or i.student_id == student_id)
            and (created_before is None or i.created_at < created_before)
        ]
        never = datetime.min.replace(tzinfo=UTC)
        return sorted(rows, key=lambda i: (i.cleaned_at or never, i.created_at))

    async def delete_board_snapshot(self, student_id: str, session_id: str) -> None:
        if self.fail_storage_purge:
            raise RuntimeError("Storage không trả lời")
        self.board_files.pop(f"{student_id}/{session_id}.json", None)

    async def purge_student_files(self, student_id: str) -> None:
        if self.fail_storage_purge:
            raise RuntimeError("Storage không trả lời")
        for files in (self.board_files, self.submission_files):
            for path in [p for p in files if p.startswith(f"{student_id}/")]:
                del files[path]

    async def delete_student_sessions(self, student_id: str) -> None:
        gone = {sid for sid, s in self.sessions.items() if s.student_id == student_id}
        self.sessions = {k: v for k, v in self.sessions.items() if k not in gone}
        self.attendance = [a for a in self.attendance if a[0] not in gone]
        self.teaching_records = {
            sid: note for sid, note in self.teaching_records.items() if sid not in gone
        }

    async def insert_session(self, fields: dict[str, Any]) -> SessionRow:
        row = SessionRow(
            id=str(uuid.uuid4()),
            room_name=f"room-{uuid.uuid4().hex}",
            status=SessionStatus.scheduled,
            **fields,
        )
        self.sessions[row.id] = row
        return row

    async def find_overlapping_session(
        self, teacher_id: str, start: datetime, end: datetime, exclude_id: str | None = None
    ) -> SessionRow | None:
        return next(
            (
                s
                for s in self.sessions.values()
                if s.teacher_id == teacher_id
                and s.id != exclude_id
                and s.status in (SessionStatus.scheduled, SessionStatus.live)
                and s.scheduled_start < end
                and s.scheduled_end > start
            ),
            None,
        )

    async def mark_no_show(self, ended_before: datetime) -> int:
        stale = [
            s.id
            for s in self.sessions.values()
            if s.status == SessionStatus.scheduled and s.scheduled_end < ended_before
        ]
        for sid in stale:
            self.sessions[sid] = self.sessions[sid].model_copy(
                update={"status": SessionStatus.no_show}
            )
        return len(stale)

    async def list_students(self, teacher_id: str) -> list[StudentRow]:
        mine = [s for s in self.students.values() if s.teacher_id == teacher_id]
        return sorted(mine, key=lambda s: s.full_name)

    async def insert_student(self, fields: dict[str, Any]) -> StudentRow:
        row = StudentRow(id=str(uuid.uuid4()), **fields)
        self.students[row.id] = row
        return row

    async def update_student(self, student_id: str, fields: dict[str, Any]) -> StudentRow | None:
        student = self.students.get(student_id)
        if student is None:
            return None
        self.students[student_id] = student.model_copy(update=fields)
        return self.students[student_id]

    async def delete_student(self, student_id: str) -> None:
        await self.delete_student_sessions(student_id)
        self.students.pop(student_id, None)
        # FK weekly_slots.student_id on delete cascade (0009)
        self.weekly_slots = {
            k: w for k, w in self.weekly_slots.items() if w.student_id != student_id
        }
        self.sessions = {k: s for k, s in self.sessions.items() if s.student_id != student_id}

    async def count_completed_sessions(self, teacher_id: str) -> dict[str, int]:
        counts: dict[str, int] = {}
        for s in self.sessions.values():
            if s.teacher_id == teacher_id and s.status == SessionStatus.completed:
                counts[s.student_id] = counts.get(s.student_id, 0) + 1
        return counts

    async def count_completed_sessions_in_period(
        self, teacher_id: str, start: datetime, end: datetime
    ) -> dict[str, int]:
        counts: dict[str, int] = {}
        for row in self.sessions.values():
            if (
                row.teacher_id == teacher_id
                and row.status == SessionStatus.completed
                and start <= row.scheduled_start < end
            ):
                counts[row.student_id] = counts.get(row.student_id, 0) + 1
        return counts

    async def set_auth_password(self, user_id: str, password: str) -> None:
        self.passwords[user_id] = password

    async def create_auth_user(self, email: str, password: str, full_name: str) -> str:
        if email in self.auth_users:
            raise AuthAdminError("email_exists")
        user_id = str(uuid.uuid4())
        self.auth_users[email] = user_id
        self.profiles[user_id] = Profile(id=user_id, role=Role.student, full_name=full_name)
        return user_id

    async def delete_auth_user(self, user_id: str) -> None:
        if self.fail_auth_delete:
            raise RuntimeError("Supabase Auth không trả lời")
        # Như khóa ngoại session_attendance.profile_id: còn điểm danh thì không xóa được hồ sơ
        if any(a[1] == user_id for a in self.attendance):
            raise RuntimeError("violates foreign key constraint")
        self.auth_users = {e: i for e, i in self.auth_users.items() if i != user_id}
        self.profiles.pop(user_id, None)
        for sid, st in self.students.items():  # students.profile_id on delete set null
            if st.profile_id == user_id:
                self.students[sid] = st.model_copy(update={"profile_id": None})

    async def link_student_profile(self, student_id: str, profile_id: str) -> bool:
        student = self.students[student_id]
        if self.fail_link or student.profile_id is not None:
            return False
        self.students[student_id] = student.model_copy(update={"profile_id": profile_id})
        return True


class FakeLiveKit:
    """LiveKit Cloud giả, chạy qua chính code `app.services.tokens` (thay `_livekit`).

    Mô hình theo kết quả thử trên Cloud 2026-10-20 (T1–T14, docs/design-video-token.md mục 9.3):
    auto-create tắt chỉ chặn phòng CHƯA TỪNG có (T1); phòng đã xóa thì token chưa thu hồi vào lại
    được và làm phòng xuất hiện lại (T3, T3B). Thu hồi theo (phòng, identity), còn sau khi xóa và
    tạo lại phòng, và vẫn được ghi nhận khi phòng không tồn tại (T7). Thời hạn giữ thu hồi
    `revocation_ttl` (None = vĩnh viễn) chưa đo xong (T8). `revoke_requires_room = True` dựng lại
    mô hình cũ (thu hồi khi phòng không tồn tại báo not_found, không ghi nhận) cho test G9.
    """

    def __init__(self) -> None:
        self.clock: Callable[[], float] = time.time
        self.auto_create = False
        self.revocation_ttl: float | None = 660  # như PR mã nguồn mở livekit#4344 (11 phút)
        self.rooms: dict[str, lk.CreateRoomRequest] = {}
        self.ever_created: set[str] = set()  # Cloud cho token hợp lệ vào lại phòng đã từng có (T3B)
        self.revoke_requires_room = False
        self.revocations: dict[tuple[str, str], tuple[int, float]] = {}  # -> (mốc nbf, hết hạn)
        self.calls: list[tuple[str, str]] = []  # thao tác thành công theo thứ tự
        self.deleted: list[str] = []  # mọi lần DeleteRoom không bị tiêm lỗi
        self.timeouts: dict[str, float | None] = {}  # thao tác -> timeout client đã dùng
        self.fail: set[str] = set()  # "create", "delete", "revoke", "list"
        self.fail_next: dict[str, int] = {}  # thao tác -> số lần tới bị lỗi
        # Số CreateRoom tới máy chủ nhưng client hết giờ chờ: phòng chỉ có khi apply_late_creates
        self.hold_creates = 0
        self.late_creates: list[lk.CreateRoomRequest] = []
        self.before_create: Callable[[], Awaitable[None]] | None = None  # chạy một lần
        self.after_create: Callable[[], Awaitable[None]] | None = None  # chạy một lần
        self.rng: random.Random | None = None  # có thì nhường vòng lặp ngẫu nhiên mỗi lệnh
        self._timeout: float | None = None

    def client(self, _settings: Settings, timeout: float | None = None) -> "FakeLiveKit":
        self._timeout = timeout
        return self

    async def __aenter__(self) -> "FakeLiveKit":
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None

    @property
    def room(self) -> "FakeLiveKit":
        return self

    async def _step(self, op: str) -> None:
        self.timeouts[op] = self._timeout
        if self.rng:
            for _ in range(self.rng.randint(0, 3)):
                await asyncio.sleep(0)
        if self.fail_next.get(op):
            self.fail_next[op] -= 1
            raise lk.TwirpError("unavailable", "LiveKit không trả lời", status=503)
        if op in self.fail:
            raise lk.TwirpError("unavailable", "LiveKit không trả lời", status=503)

    def _create(self, req: lk.CreateRoomRequest) -> None:
        self.rooms.setdefault(req.name, req)
        self.ever_created.add(req.name)
        self.calls.append(("create", req.name))

    async def create_room(self, req: lk.CreateRoomRequest) -> lk.Room:
        if hook := self.before_create:
            self.before_create = None
            await hook()
        await self._step("create")
        if self.hold_creates:
            self.hold_creates -= 1
            self.late_creates.append(req)
            raise TimeoutError
        self._create(req)
        if hook := self.after_create:
            self.after_create = None
            await hook()
        return lk.Room(name=req.name)

    def apply_late_creates(self) -> None:
        for req in self.late_creates:
            self._create(req)
        self.late_creates.clear()

    async def delete_room(self, req: lk.DeleteRoomRequest) -> lk.DeleteRoomResponse:
        await self._step("delete")
        self.deleted.append(req.room)
        if self.rooms.pop(req.room, None) is None:
            raise lk.TwirpError(lk.TwirpErrorCode.NOT_FOUND, "room not found", status=404)
        self.calls.append(("delete", req.room))
        return lk.DeleteRoomResponse()

    async def remove_participant(
        self, req: lk.RoomParticipantIdentity
    ) -> lk.RemoveParticipantResponse:
        await self._step("revoke")
        now = self.clock()
        if abs(req.revoke_token_ts - now) > 60:
            raise lk.TwirpError(lk.TwirpErrorCode.INVALID_ARGUMENT, "revoke_token_ts", status=400)
        if req.room not in self.rooms and self.revoke_requires_room:
            raise lk.TwirpError(lk.TwirpErrorCode.NOT_FOUND, "room not found", status=404)
        until = now + self.revocation_ttl if self.revocation_ttl is not None else float("inf")
        self.revocations[(req.room, req.identity)] = (req.revoke_token_ts, until)
        self.calls.append(("revoke", f"{req.room}/{req.identity}"))
        return lk.RemoveParticipantResponse()

    async def list_rooms(self, _req: lk.ListRoomsRequest) -> lk.ListRoomsResponse:
        await self._step("list")
        return lk.ListRoomsResponse(
            rooms=[
                lk.Room(name=name, metadata=req.metadata if req else "")
                for name, req in self.rooms.items()
            ]
        )

    def can_connect(self, token: str) -> bool:
        """Một client dùng token này có vào được phòng ngay lúc này không (theo mô hình)."""
        claims = jwt.decode(token, options={"verify_signature": False})
        room, identity, now = claims["video"]["room"], claims["sub"], self.clock()
        if claims["exp"] <= now:
            return False
        cutoff, until = self.revocations.get((room, identity), (0, 0.0))
        if now < until and claims["nbf"] < cutoff:
            return False
        if room not in self.rooms:
            if not self.auto_create and room not in self.ever_created:
                return False
            self._create(lk.CreateRoomRequest(name=room))  # phòng mới, không có nhãn sở hữu
        return True


class RoomCloser:
    """Thay LiveKit và lời gọi đóng phòng bảng viết (không gọi mạng khi test)."""

    def __init__(self) -> None:
        self.lk = FakeLiveKit()
        self.whiteboard: list[str] = []
        self.purged: list[str] = []  # buổi học đã xóa dữ liệu bảng (xóa học sinh)
        self.fail_purge = False
        self.fail_whiteboard = False
        self.board_elements: BoardSnapshot = []  # nội dung bảng cuối máy chủ bảng trả về

    @property
    def livekit(self) -> list[str]:
        return self.lk.deleted

    @property
    def fail_livekit(self) -> bool:
        return bool(self.lk.fail)

    @fail_livekit.setter
    def fail_livekit(self, value: bool) -> None:
        self.lk.fail = {"create", "delete", "revoke", "list"} if value else set()

    async def close_whiteboard(self, _settings: Settings, session_id: str) -> BoardSnapshot:
        if self.fail_whiteboard:
            raise RuntimeError("whiteboard-sync không trả lời")
        self.whiteboard.append(session_id)
        return self.board_elements

    async def purge_whiteboard(self, _settings: Settings, session_id: str) -> None:
        if self.fail_purge:
            raise RuntimeError("whiteboard-sync không trả lời")
        self.purged.append(session_id)


@pytest.fixture(autouse=True)
def rooms(monkeypatch) -> RoomCloser:
    closer = RoomCloser()
    monkeypatch.setattr("app.services.tokens._livekit", closer.lk.client)
    monkeypatch.setattr("app.services.finalize.close_whiteboard_room", closer.close_whiteboard)
    monkeypatch.setattr(
        "app.services.student_deletion.purge_whiteboard_room", closer.purge_whiteboard
    )
    return closer


class Clock:
    """Đồng hồ điều khiển được cho API và FakeLiveKit (giả lập yêu cầu bị treo hàng chục giây)."""

    def __init__(self) -> None:
        self.t = time.time()

    def advance(self, seconds: float) -> None:
        self.t += seconds


@pytest.fixture
def clock(monkeypatch, rooms: RoomCloser) -> Clock:
    c = Clock()

    class _Datetime(datetime):
        @classmethod
        def now(cls, tz=None):  # type: ignore[override]
            return datetime.fromtimestamp(c.t, tz)

    monkeypatch.setattr("app.core.time.now_utc", lambda: datetime.fromtimestamp(c.t, UTC))
    # SDK tự đặt nbf/exp theo giờ thật: cho nó cùng đồng hồ, kẻo token ký "sau 31 giây" vẫn mang
    # giờ cũ và test đạt nhầm
    sdk_clock = SimpleNamespace(datetime=_Datetime, timezone=timezone, timedelta=timedelta)
    monkeypatch.setattr("livekit.api.access_token.datetime", sdk_clock)
    rooms.lk.clock = lambda: c.t
    return c


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def repo() -> FakeRepo:
    return FakeRepo()


@pytest.fixture
def client(settings: Settings, repo: FakeRepo) -> Iterator[TestClient]:
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_repo] = lambda: repo
    with TestClient(app) as c:
        yield c


def auth_header(settings: Settings, user_id: str, *, secret: str | None = None) -> dict[str, str]:
    payload = {
        "sub": user_id,
        "aud": settings.supabase_jwt_audience,
        "exp": datetime.now(UTC) + timedelta(hours=1),
    }
    token = jwt.encode(payload, secret or settings.supabase_jwt_secret, algorithm="HS256")
    return {"Authorization": f"Bearer {token}"}

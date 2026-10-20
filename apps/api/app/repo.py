"""Lớp truy cập dữ liệu. Router chỉ làm việc với `Repository`, nên test dùng bản giả
và sau này có thể đổi Supabase sang cơ sở dữ liệu khác mà không sửa router."""

import json
from datetime import date, datetime
from typing import Any, Protocol

import httpx
from fastapi import Depends

from app.config import Settings, get_settings
from app.core import time as clock
from app.models import (
    DeviceMode,
    Profile,
    SessionRow,
    SessionStatus,
    StudentRow,
    TeachingNoteRequest,
    TeachingRecord,
    TeachingTopic,
    UploadIntent,
    WeeklySlot,
)


class AuthAdminError(Exception):
    """Supabase Auth từ chối tạo tài khoản; `code` là mã lỗi của Supabase (vd. email_exists)."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class Repository(Protocol):
    async def list_weekly_slots(self, teacher_id: str) -> list[WeeklySlot]: ...

    async def list_all_weekly_slots(self) -> list[WeeklySlot]:
        """Mọi lịch cố định (vòng lặp nền sinh buổi và dọn lịch đã ngừng)."""
        ...

    async def get_weekly_slot(self, slot_id: str) -> WeeklySlot | None: ...

    async def insert_weekly_slot(self, fields: dict[str, Any]) -> WeeklySlot: ...

    async def update_weekly_slot(
        self, slot_id: str, fields: dict[str, Any]
    ) -> WeeklySlot | None: ...

    async def list_slot_dates(self, slot_id: str) -> set[date]:
        """Các ngày đã sinh buổi từ lịch này (kể cả buổi đã hủy, đã dời giờ)."""
        ...

    async def insert_slot_session(self, fields: dict[str, Any]) -> bool:
        """Thêm buổi sinh từ lịch; (slot_id, slot_date) đã có thì không thêm, trả False."""
        ...

    async def cancel_future_slot_sessions(self, slot_id: str, after: datetime) -> int:
        """Hủy các buổi scheduled của lịch bắt đầu sau mốc; trả số buổi đã hủy."""
        ...

    async def list_teaching_topics(self, teacher_id: str) -> list[TeachingTopic]: ...

    async def create_teaching_topic(
        self, teacher_id: str, name: str, grade: str
    ) -> TeachingTopic: ...

    async def get_teaching_record(
        self, teacher_id: str, session_id: str
    ) -> TeachingRecord | None: ...

    async def list_teaching_records(
        self, teacher_id: str, student_id: str, start: datetime, end: datetime
    ) -> list[TeachingRecord]: ...

    async def save_teaching_record(
        self, teacher_id: str, session_id: str, body: TeachingNoteRequest
    ) -> tuple[str, TeachingRecord | None]:
        """Giao dịch DB: kiểm quyền/xóa/phiên bản, lưu note và thay liên kết chủ đề cùng lúc."""
        ...

    async def get_profile(self, user_id: str) -> Profile | None: ...

    async def get_session(self, session_id: str) -> SessionRow | None: ...

    async def get_student(self, student_id: str) -> StudentRow | None: ...

    async def get_session_by_room_name(self, room_name: str) -> SessionRow | None:
        """Buổi học có phòng video tên này (room_name là unique); None nếu không có."""
        ...

    async def update_session(
        self,
        session_id: str,
        fields: dict[str, Any],
        expected_status: SessionStatus | None = None,
    ) -> SessionRow | None:
        """Có expected_status thì chỉ ghi khi trạng thái vẫn như đã đọc; None nếu không ghi."""
        ...

    async def list_unfinalized_sessions(self, ended_before: datetime) -> list[SessionRow]:
        """Buổi completed chưa có finalized_at, kết thúc trước mốc (việc đóng phòng còn chờ).
        Bỏ qua buổi của học sinh đang xóa (không tạo lại bảng đã dọn)."""
        ...

    async def mark_student_deleting(self, student_id: str) -> StudentRow | None:
        """Đặt deleting_at cho học sinh đã ngừng dạy (giữ mốc cũ nếu đã có); None nếu không được."""
        ...

    async def list_deleting_students(self, before: datetime) -> list[StudentRow]:
        """Học sinh đang xóa dở, đánh dấu trước mốc."""
        ...

    async def list_student_sessions(self, student_id: str) -> list[SessionRow]: ...

    async def purge_student_files(self, student_id: str) -> None:
        """Xóa mọi tệp dưới <student_id>/ trong bucket boards và submissions (gọi lại được)."""
        ...

    async def add_upload_intent(self, student_id: str, session_id: str) -> UploadIntent:
        """Ghi bản đăng ký trước khi tải bảng lên (bắt tay với việc xóa học sinh)."""
        ...

    async def delete_upload_intent(self, intent_id: str) -> None:
        """Chỉ uploader gọi, khi đã biết chắc kết quả của lần tải."""
        ...

    async def mark_upload_intent_cleaned(self, intent_id: str, at: datetime) -> None:
        """Ghi đã dọn file của hàng này lần này (hàng vẫn giữ)."""
        ...

    async def list_upload_intents(
        self, student_id: str | None = None, created_before: datetime | None = None
    ) -> list[UploadIntent]:
        """Thứ tự: chưa dọn lần nào trước, rồi dọn lâu nhất (canh xoay vòng khi có nhiều hàng)."""
        ...

    async def delete_board_snapshot(self, student_id: str, session_id: str) -> None:
        """Xóa bản bảng đã lưu của một buổi; không có thì thôi."""
        ...

    async def delete_student_sessions(self, student_id: str) -> None:
        """Xóa buổi học của học sinh (điểm danh xóa dây chuyền)."""
        ...

    async def add_attendance(self, session_id: str, profile_id: str, mode: DeviceMode) -> None: ...

    async def insert_session(self, fields: dict[str, Any]) -> SessionRow: ...

    async def close_attendance(self, session_id: str, left_at: datetime) -> None:
        """Ghi giờ rời phòng cho mọi lượt vào của buổi học chưa có left_at."""
        ...

    async def save_board_snapshot(
        self, student_id: str, session_id: str, elements: list[dict]
    ) -> str:
        """Lưu nội dung bảng cuối buổi vào bucket boards; trả về đường dẫn trong bucket."""
        ...

    async def find_overlapping_session(
        self, teacher_id: str, start: datetime, end: datetime, exclude_id: str | None = None
    ) -> SessionRow | None:
        """Buổi scheduled/live của giáo viên (trừ exclude_id) giao với khoảng [start, end)."""
        ...

    async def list_students(self, teacher_id: str) -> list[StudentRow]: ...

    async def insert_student(self, fields: dict[str, Any]) -> StudentRow: ...

    async def update_student(
        self, student_id: str, fields: dict[str, Any]
    ) -> StudentRow | None: ...

    async def delete_student(self, student_id: str) -> None:
        """Xóa hẳn; buổi học, bài tập, bài nộp bị xóa dây chuyền theo khóa ngoại."""
        ...

    async def mark_no_show(self, ended_before: datetime) -> int:
        """Đặt no_show cho buổi còn scheduled mà giờ kết thúc trước mốc; trả số buổi đã đổi."""
        ...

    async def create_auth_user(self, email: str, password: str, full_name: str) -> str:
        """Tạo tài khoản đăng nhập (đã xác nhận email), trả id. Lỗi: AuthAdminError."""
        ...

    async def delete_auth_user(self, user_id: str) -> None:
        """Xóa tài khoản đăng nhập (hồ sơ xóa dây chuyền); không còn tài khoản thì coi như xong."""
        ...

    async def set_auth_password(self, user_id: str, password: str) -> None:
        """Đặt mật khẩu mới cho tài khoản. Lỗi: AuthAdminError (vd. weak_password)."""
        ...

    async def count_completed_sessions(self, teacher_id: str) -> dict[str, int]:
        """Số buổi completed theo student_id, của một giáo viên."""
        ...

    async def count_completed_sessions_in_period(
        self, teacher_id: str, start: datetime, end: datetime
    ) -> dict[str, int]:
        """Đếm completed theo scheduled_start trong [start, end), chỉ của giáo viên này."""
        ...

    async def link_student_profile(self, student_id: str, profile_id: str) -> bool:
        """Gắn tài khoản vào học sinh nếu học sinh chưa có tài khoản; False nếu đã có."""
        ...


class SupabaseRepository:
    """Gọi PostgREST của Supabase bằng khóa service role (bỏ qua RLS: kiểm tra quyền ở router)."""

    def __init__(self, settings: Settings) -> None:
        self._base = f"{settings.supabase_url.rstrip('/')}/rest/v1"
        self._auth = f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users"
        self._storage = f"{settings.supabase_url.rstrip('/')}/storage/v1/object"
        self._headers = {
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
        }

    async def _pages(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        async with httpx.AsyncClient(timeout=10) as client:
            while True:
                response = await client.get(
                    f"{self._base}/{table}",
                    headers=self._headers,
                    params=params | {"limit": "500", "offset": str(len(rows))},
                )
                response.raise_for_status()
                page = response.json()
                if not page:
                    return rows
                rows.extend(page)

    async def list_weekly_slots(self, teacher_id: str) -> list[WeeklySlot]:
        rows = await self._pages(
            "weekly_slots",
            {
                "teacher_id": f"eq.{teacher_id}",
                "select": "*",
                "order": "active.desc,weekday.asc,start_time.asc,id.asc",
            },
        )
        return [WeeklySlot.model_validate(row) for row in rows]

    async def list_all_weekly_slots(self) -> list[WeeklySlot]:
        rows = await self._pages("weekly_slots", {"select": "*", "order": "id.asc"})
        return [WeeklySlot.model_validate(row) for row in rows]

    async def get_weekly_slot(self, slot_id: str) -> WeeklySlot | None:
        row = await self._select_one("weekly_slots", id=slot_id)
        return WeeklySlot.model_validate(row) if row else None

    async def insert_weekly_slot(self, fields: dict[str, Any]) -> WeeklySlot:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self._base}/weekly_slots",
                json=_jsonable(fields),
                headers=self._headers | {"Prefer": "return=representation"},
            )
            resp.raise_for_status()
        return WeeklySlot.model_validate(resp.json()[0])

    async def update_weekly_slot(self, slot_id: str, fields: dict[str, Any]) -> WeeklySlot | None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{self._base}/weekly_slots",
                params={"id": f"eq.{slot_id}"},
                json=_jsonable(fields),
                headers=self._headers | {"Prefer": "return=representation"},
            )
            resp.raise_for_status()
        rows = resp.json()
        return WeeklySlot.model_validate(rows[0]) if rows else None

    async def list_slot_dates(self, slot_id: str) -> set[date]:
        rows = await self._pages(
            "sessions", {"slot_id": f"eq.{slot_id}", "select": "slot_date", "order": "id.asc"}
        )
        return {date.fromisoformat(row["slot_date"]) for row in rows}

    async def insert_slot_session(self, fields: dict[str, Any]) -> bool:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self._base}/sessions",
                params={"on_conflict": "slot_id,slot_date"},
                json=_jsonable(fields),
                headers=self._headers
                | {"Prefer": "resolution=ignore-duplicates,return=representation"},
            )
            resp.raise_for_status()
        return bool(resp.json())  # trùng (slot_id, slot_date): PostgREST bỏ qua, trả mảng rỗng

    async def cancel_future_slot_sessions(self, slot_id: str, after: datetime) -> int:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{self._base}/sessions",
                params={
                    "slot_id": f"eq.{slot_id}",
                    "status": "eq.scheduled",
                    "scheduled_start": f"gt.{after.isoformat()}",
                    "select": "id",
                },
                json={"status": "cancelled"},
                headers=self._headers | {"Prefer": "return=representation"},
            )
            resp.raise_for_status()
        return len(resp.json())

    async def list_teaching_topics(self, teacher_id: str) -> list[TeachingTopic]:
        rows = await self._pages(
            "teaching_topics",
            {
                "teacher_id": f"eq.{teacher_id}",
                "select": "id,name,grade",
                "order": "name.asc,id.asc",
            },
        )
        return [TeachingTopic.model_validate(row) for row in rows]

    async def create_teaching_topic(self, teacher_id: str, name: str, grade: str) -> TeachingTopic:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{self._base}/teaching_topics",
                headers=self._headers
                | {"Prefer": "resolution=ignore-duplicates,return=representation"},
                params={"on_conflict": "teacher_id,name,grade"},
                json={"teacher_id": teacher_id, "name": name, "grade": grade},
            )
            response.raise_for_status()
            rows = response.json()
            if rows:
                return TeachingTopic.model_validate(rows[0])
        row = await self._select_one(
            "teaching_topics", teacher_id=teacher_id, name=name, grade=grade
        )
        if row is None:
            raise RuntimeError("Không tìm thấy chủ đề vừa tạo")
        return TeachingTopic.model_validate(row)

    async def get_teaching_record(self, teacher_id: str, session_id: str) -> TeachingRecord | None:
        rows = await self._pages(
            "sessions", _teaching_params(teacher_id) | {"id": f"eq.{session_id}"}
        )
        return _teaching_record(rows[0]) if rows else None

    async def list_teaching_records(
        self, teacher_id: str, student_id: str, start: datetime, end: datetime
    ) -> list[TeachingRecord]:
        rows = await self._pages(
            "sessions",
            _teaching_params(teacher_id)
            | {
                "student_id": f"eq.{student_id}",
                "and": (
                    f"(scheduled_start.gte.{start.isoformat()},scheduled_start.lt.{end.isoformat()})"
                ),
            },
        )
        return [_teaching_record(row) for row in rows]

    async def save_teaching_record(
        self, teacher_id: str, session_id: str, body: TeachingNoteRequest
    ) -> tuple[str, TeachingRecord | None]:
        params = {f"p_{key}": value for key, value in body.model_dump(mode="json").items()}
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{self._base}/rpc/save_teaching_record",
                headers=self._headers,
                json=params | {"p_teacher_id": teacher_id, "p_session_id": session_id},
            )
            response.raise_for_status()
        result = response.json()
        record = result.get("record")
        return result["status"], TeachingRecord.model_validate(record) if record else None

    async def _select_one(self, table: str, **filters: str) -> dict[str, Any] | None:
        params = {k: f"eq.{v}" for k, v in filters.items()} | {"select": "*", "limit": "1"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{self._base}/{table}", params=params, headers=self._headers)
            resp.raise_for_status()
        rows = resp.json()
        return rows[0] if rows else None

    async def get_profile(self, user_id: str) -> Profile | None:
        row = await self._select_one("profiles", id=user_id)
        return Profile.model_validate(row) if row else None

    async def get_session(self, session_id: str) -> SessionRow | None:
        row = await self._select_one("sessions", id=session_id)
        return SessionRow.model_validate(row) if row else None

    async def get_student(self, student_id: str) -> StudentRow | None:
        row = await self._select_one("students", id=student_id)
        return StudentRow.model_validate(row) if row else None

    async def get_session_by_room_name(self, room_name: str) -> SessionRow | None:
        row = await self._select_one("sessions", room_name=room_name)
        return SessionRow.model_validate(row) if row else None

    async def update_session(
        self,
        session_id: str,
        fields: dict[str, Any],
        expected_status: SessionStatus | None = None,
    ) -> SessionRow | None:
        headers = self._headers | {"Prefer": "return=representation"}
        params = {"id": f"eq.{session_id}"}
        if expected_status:
            params["status"] = f"eq.{expected_status}"  # một câu UPDATE ... WHERE: nguyên tử
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{self._base}/sessions",
                params=params,
                json=_jsonable(fields),
                headers=headers,
            )
            resp.raise_for_status()
        rows = resp.json()
        return SessionRow.model_validate(rows[0]) if rows else None

    async def list_unfinalized_sessions(self, ended_before: datetime) -> list[SessionRow]:
        params = {
            "status": "eq.completed",
            "finalized_at": "is.null",
            "ended_at": f"lt.{ended_before.isoformat()}",
            "select": "*,students!inner(deleting_at)",
            "students.deleting_at": "is.null",
            "order": "ended_at",
            "limit": "50",
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{self._base}/sessions", params=params, headers=self._headers)
            resp.raise_for_status()
        return [SessionRow.model_validate(r) for r in resp.json()]

    async def mark_student_deleting(self, student_id: str) -> StudentRow | None:
        headers = self._headers | {"Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{self._base}/students",
                # điều kiện active=false: không xóa học sinh vừa được dạy lại ở yêu cầu khác
                params={"id": f"eq.{student_id}", "active": "eq.false", "deleting_at": "is.null"},
                json={"deleting_at": clock.now_utc().isoformat()},
                headers=headers,
            )
            resp.raise_for_status()
        rows = resp.json()
        if rows:
            return StudentRow.model_validate(rows[0])
        student = await self.get_student(student_id)  # đã đánh dấu từ lần trước
        return student if student and student.deleting_at else None

    async def list_deleting_students(self, before: datetime) -> list[StudentRow]:
        params = {"deleting_at": f"lt.{before.isoformat()}", "select": "*", "limit": "20"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{self._base}/students", params=params, headers=self._headers)
            resp.raise_for_status()
        return [StudentRow.model_validate(r) for r in resp.json()]

    async def list_student_sessions(self, student_id: str) -> list[SessionRow]:
        params = {"student_id": f"eq.{student_id}", "select": "*"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{self._base}/sessions", params=params, headers=self._headers)
            resp.raise_for_status()
        return [SessionRow.model_validate(r) for r in resp.json()]

    async def purge_student_files(self, student_id: str) -> None:
        async with httpx.AsyncClient(timeout=30) as client:
            for bucket in ("boards", "submissions"):
                # Liệt kê rồi xóa từng đợt (list trả tối đa 1.000 mục) đến khi hết
                while paths := await self._list_files(client, bucket, student_id):
                    resp = await client.request(
                        "DELETE",
                        f"{self._storage}/{bucket}",
                        json={"prefixes": paths},
                        headers=self._headers,
                    )
                    resp.raise_for_status()
                    if not resp.json():
                        raise RuntimeError(f"Storage không xóa được tệp trong bucket {bucket}")

    async def _list_files(self, client: httpx.AsyncClient, bucket: str, folder: str) -> list[str]:
        resp = await client.post(
            f"{self._storage}/list/{bucket}",
            json={"prefix": folder, "limit": 1000, "offset": 0},
            headers=self._headers,
        )
        resp.raise_for_status()
        paths: list[str] = []
        for item in resp.json():
            path = f"{folder}/{item['name']}"
            if item.get("id") is None:  # thư mục con, vd. submissions/<student>/<submission>/
                paths += await self._list_files(client, bucket, path)
            else:
                paths.append(path)
        return paths

    async def add_upload_intent(self, student_id: str, session_id: str) -> UploadIntent:
        headers = self._headers | {"Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self._base}/board_upload_intents",
                json={"student_id": student_id, "session_id": session_id},
                headers=headers,
            )
            resp.raise_for_status()
        return UploadIntent.model_validate(resp.json()[0])

    async def delete_upload_intent(self, intent_id: str) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.delete(
                f"{self._base}/board_upload_intents",
                params={"id": f"eq.{intent_id}"},
                headers=self._headers,
            )
            resp.raise_for_status()

    async def mark_upload_intent_cleaned(self, intent_id: str, at: datetime) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{self._base}/board_upload_intents",
                params={"id": f"eq.{intent_id}"},
                json={"cleaned_at": at.isoformat()},
                headers=self._headers,
            )
            resp.raise_for_status()

    async def list_upload_intents(
        self, student_id: str | None = None, created_before: datetime | None = None
    ) -> list[UploadIntent]:
        params = {"select": "*", "order": "cleaned_at.asc.nullsfirst,created_at", "limit": "100"}
        if student_id:
            params["student_id"] = f"eq.{student_id}"
        if created_before:
            params["created_at"] = f"lt.{created_before.isoformat()}"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{self._base}/board_upload_intents", params=params, headers=self._headers
            )
            resp.raise_for_status()
        return [UploadIntent.model_validate(r) for r in resp.json()]

    async def delete_board_snapshot(self, student_id: str, session_id: str) -> None:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.request(
                "DELETE",
                f"{self._storage}/boards",
                json={"prefixes": [_board_path(student_id, session_id)]},
                headers=self._headers,
            )
            resp.raise_for_status()  # không có file: trả danh sách rỗng, coi như xong

    async def delete_student_sessions(self, student_id: str) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.delete(
                f"{self._base}/sessions",
                params={"student_id": f"eq.{student_id}"},
                headers=self._headers,
            )
            resp.raise_for_status()

    async def add_attendance(self, session_id: str, profile_id: str, mode: DeviceMode) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self._base}/session_attendance",
                json={
                    "session_id": session_id,
                    "profile_id": profile_id,
                    "device_mode": str(mode),
                    "joined_at": clock.now_utc().isoformat(),
                },
                headers=self._headers,
            )
            resp.raise_for_status()

    async def save_board_snapshot(
        self, student_id: str, session_id: str, elements: list[dict]
    ) -> str:
        path = _board_path(student_id, session_id)
        headers = self._headers | {"Content-Type": "application/json", "x-upsert": "true"}
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{self._storage}/boards/{path}",
                content=json.dumps(elements).encode(),
                headers=headers,
            )
            resp.raise_for_status()
        return path

    async def close_attendance(self, session_id: str, left_at: datetime) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{self._base}/session_attendance",
                params={"session_id": f"eq.{session_id}", "left_at": "is.null"},
                json={"left_at": left_at.isoformat()},
                headers=self._headers,
            )
            resp.raise_for_status()

    async def insert_session(self, fields: dict[str, Any]) -> SessionRow:
        headers = self._headers | {"Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self._base}/sessions", json=_jsonable(fields), headers=headers
            )
            resp.raise_for_status()
        return SessionRow.model_validate(resp.json()[0])

    async def find_overlapping_session(
        self, teacher_id: str, start: datetime, end: datetime, exclude_id: str | None = None
    ) -> SessionRow | None:
        params = {
            "teacher_id": f"eq.{teacher_id}",
            "status": "in.(scheduled,live)",
            "scheduled_start": f"lt.{end.isoformat()}",
            "scheduled_end": f"gt.{start.isoformat()}",
            "select": "*",
            "limit": "1",
        }
        if exclude_id:
            params["id"] = f"neq.{exclude_id}"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{self._base}/sessions", params=params, headers=self._headers)
            resp.raise_for_status()
        rows = resp.json()
        return SessionRow.model_validate(rows[0]) if rows else None

    async def mark_no_show(self, ended_before: datetime) -> int:
        headers = self._headers | {"Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{self._base}/sessions",
                params={
                    "status": "eq.scheduled",
                    "scheduled_end": f"lt.{ended_before.isoformat()}",
                    "select": "id",
                },
                json={"status": "no_show"},
                headers=headers,
            )
            resp.raise_for_status()
        return len(resp.json())

    async def create_auth_user(self, email: str, password: str, full_name: str) -> str:
        body = {
            "email": email,
            "password": password,
            "email_confirm": True,
            # trigger handle_new_user đọc full_name để tạo profiles (vai trò mặc định: student)
            "user_metadata": {"full_name": full_name},
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(self._auth, json=body, headers=self._headers)
        if resp.status_code in (400, 409, 422):
            data = resp.json()
            raise AuthAdminError(str(data.get("error_code") or data.get("code") or "rejected"))
        resp.raise_for_status()
        return str(resp.json()["id"])

    async def delete_auth_user(self, user_id: str) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.delete(f"{self._auth}/{user_id}", headers=self._headers)
        if resp.status_code == 404:  # đã xóa ở lần trước
            return
        resp.raise_for_status()

    async def set_auth_password(self, user_id: str, password: str) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.put(
                f"{self._auth}/{user_id}", json={"password": password}, headers=self._headers
            )
        if resp.status_code in (400, 422):
            data = resp.json()
            raise AuthAdminError(str(data.get("error_code") or data.get("code") or "rejected"))
        resp.raise_for_status()

    async def count_completed_sessions(self, teacher_id: str) -> dict[str, int]:
        # shortcut: đếm ở Python vì Supabase tắt hàm tổng hợp của PostgREST theo mặc định; đủ cho
        # một giáo viên (vài nghìn buổi), nhiều hơn thì thêm view hoặc hàm SQL đếm sẵn
        params = {
            "teacher_id": f"eq.{teacher_id}",
            "status": "eq.completed",
            "select": "student_id",
        }
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{self._base}/sessions", params=params, headers=self._headers)
            resp.raise_for_status()
        counts: dict[str, int] = {}
        for row in resp.json():
            counts[row["student_id"]] = counts.get(row["student_id"], 0) + 1
        return counts

    async def count_completed_sessions_in_period(
        self, teacher_id: str, start: datetime, end: datetime
    ) -> dict[str, int]:
        counts: dict[str, int] = {}
        offset = 0
        params = {
            "teacher_id": f"eq.{teacher_id}",
            "status": "eq.completed",
            "select": "student_id",
            "and": (
                f"(scheduled_start.gte.{start.isoformat()},scheduled_start.lt.{end.isoformat()})"
            ),
            "order": "id.asc",
            "limit": "500",
        }
        async with httpx.AsyncClient(timeout=10) as client:
            while True:
                resp = await client.get(
                    f"{self._base}/sessions",
                    params=params | {"offset": str(offset)},
                    headers=self._headers,
                )
                resp.raise_for_status()
                rows = resp.json()
                if not rows:
                    return counts
                for row in rows:
                    key = row["student_id"]
                    counts[key] = counts.get(key, 0) + 1
                offset += len(rows)

    async def link_student_profile(self, student_id: str, profile_id: str) -> bool:
        headers = self._headers | {"Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{self._base}/students",
                # điều kiện profile_id is null giữ cho hai lần bấm cùng lúc không ghi đè nhau
                params={"id": f"eq.{student_id}", "profile_id": "is.null", "select": "id"},
                json={"profile_id": profile_id},
                headers=headers,
            )
            resp.raise_for_status()
        return bool(resp.json())

    async def list_students(self, teacher_id: str) -> list[StudentRow]:
        params = {"teacher_id": f"eq.{teacher_id}", "select": "*", "order": "full_name"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{self._base}/students", params=params, headers=self._headers)
            resp.raise_for_status()
        return [StudentRow.model_validate(r) for r in resp.json()]

    async def insert_student(self, fields: dict[str, Any]) -> StudentRow:
        headers = self._headers | {"Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self._base}/students", json=_jsonable(fields), headers=headers
            )
            resp.raise_for_status()
        return StudentRow.model_validate(resp.json()[0])

    async def update_student(self, student_id: str, fields: dict[str, Any]) -> StudentRow | None:
        headers = self._headers | {"Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{self._base}/students",
                params={"id": f"eq.{student_id}"},
                json=_jsonable(fields),
                headers=headers,
            )
            resp.raise_for_status()
        rows = resp.json()
        return StudentRow.model_validate(rows[0]) if rows else None

    async def delete_student(self, student_id: str) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.delete(
                f"{self._base}/students", params={"id": f"eq.{student_id}"}, headers=self._headers
            )
            resp.raise_for_status()


def _teaching_params(teacher_id: str) -> dict[str, str]:
    return {
        "teacher_id": f"eq.{teacher_id}",
        "status": "eq.completed",
        "students.deleting_at": "is.null",
        "students.teacher_id": f"eq.{teacher_id}",
        "select": (
            "id,scheduled_start,subject,topic,session_notes(*),"
            "session_topics(topic_id),students!inner(id)"
        ),
        "order": "scheduled_start.asc,id.asc",
    }


def _teaching_record(row: dict[str, Any]) -> TeachingRecord:
    note = row.get("session_notes") or {}
    if isinstance(note, list):
        note = note[0] if note else {}
    return TeachingRecord(
        **note,
        **({"session_id": row["id"]} if "session_id" not in note else {}),
        scheduled_start=row["scheduled_start"],
        subject=row.get("subject"),
        scheduled_topic=row.get("topic"),
        topic_ids=sorted(link["topic_id"] for link in row.get("session_topics", [])),
    )


def _board_path(student_id: str, session_id: str) -> str:
    # Thư mục đầu là student_id: policy boards_objects_student_select cho đúng học sinh đọc;
    # xóa học sinh dọn cả thư mục này
    return f"{student_id}/{session_id}.json"


def _jsonable(fields: dict[str, Any]) -> dict[str, Any]:
    return {
        k: (v.isoformat() if isinstance(v, date) else str(v) if hasattr(v, "value") else v)
        for k, v in fields.items()
    }


def get_repo(settings: Settings = Depends(get_settings)) -> Repository:
    return SupabaseRepository(settings)

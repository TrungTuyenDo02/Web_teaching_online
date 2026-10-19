"""Lớp truy cập dữ liệu. Router chỉ làm việc với `Repository`, nên test dùng bản giả
và sau này có thể đổi Supabase sang cơ sở dữ liệu khác mà không sửa router."""

from datetime import UTC, datetime
from typing import Any, Protocol

import httpx
from fastapi import Depends

from app.config import Settings, get_settings
from app.models import DeviceMode, Profile, SessionRow, StudentRow


class Repository(Protocol):
    async def get_profile(self, user_id: str) -> Profile | None: ...

    async def get_session(self, session_id: str) -> SessionRow | None: ...

    async def get_student(self, student_id: str) -> StudentRow | None: ...

    async def update_session(
        self, session_id: str, fields: dict[str, Any]
    ) -> SessionRow | None: ...

    async def add_attendance(self, session_id: str, profile_id: str, mode: DeviceMode) -> None: ...


class SupabaseRepository:
    """Gọi PostgREST của Supabase bằng khóa service role (bỏ qua RLS: kiểm tra quyền ở router)."""

    def __init__(self, settings: Settings) -> None:
        self._base = f"{settings.supabase_url.rstrip('/')}/rest/v1"
        self._headers = {
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
        }

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

    async def update_session(self, session_id: str, fields: dict[str, Any]) -> SessionRow | None:
        headers = self._headers | {"Prefer": "return=representation"}
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.patch(
                f"{self._base}/sessions",
                params={"id": f"eq.{session_id}"},
                json=_jsonable(fields),
                headers=headers,
            )
            resp.raise_for_status()
        rows = resp.json()
        return SessionRow.model_validate(rows[0]) if rows else None

    async def add_attendance(self, session_id: str, profile_id: str, mode: DeviceMode) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{self._base}/session_attendance",
                json={
                    "session_id": session_id,
                    "profile_id": profile_id,
                    "device_mode": str(mode),
                    "joined_at": datetime.now(UTC).isoformat(),
                },
                headers=self._headers,
            )
            resp.raise_for_status()


def _jsonable(fields: dict[str, Any]) -> dict[str, Any]:
    return {
        k: (v.isoformat() if isinstance(v, datetime) else str(v) if hasattr(v, "value") else v)
        for k, v in fields.items()
    }


def get_repo(settings: Settings = Depends(get_settings)) -> Repository:
    return SupabaseRepository(settings)

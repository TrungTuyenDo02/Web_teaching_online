from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import create_app
from app.models import DeviceMode, Profile, Role, SessionRow, SessionStatus, StudentRow
from app.repo import get_repo

TEACHER_ID = "11111111-1111-1111-1111-111111111111"
STUDENT_PROFILE_ID = "22222222-2222-2222-2222-222222222222"
OTHER_STUDENT_PROFILE_ID = "33333333-3333-3333-3333-333333333333"
STUDENT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
OTHER_STUDENT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
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
        now = datetime.now(UTC)
        self.profiles = {
            TEACHER_ID: Profile(id=TEACHER_ID, role=Role.teacher, full_name="Cô Thử"),
            STUDENT_PROFILE_ID: Profile(id=STUDENT_PROFILE_ID, role=Role.student, full_name="Em A"),
            OTHER_STUDENT_PROFILE_ID: Profile(
                id=OTHER_STUDENT_PROFILE_ID, role=Role.student, full_name="Em B"
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

    async def get_profile(self, user_id: str) -> Profile | None:
        return self.profiles.get(user_id)

    async def get_session(self, session_id: str) -> SessionRow | None:
        return self.sessions.get(session_id)

    async def get_student(self, student_id: str) -> StudentRow | None:
        return self.students.get(student_id)

    async def update_session(self, session_id: str, fields: dict[str, Any]) -> SessionRow | None:
        session = self.sessions.get(session_id)
        if session is None:
            return None
        self.sessions[session_id] = session.model_copy(update=fields)
        return self.sessions[session_id]

    async def add_attendance(self, session_id: str, profile_id: str, mode: DeviceMode) -> None:
        self.attendance.append((session_id, profile_id, mode))


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

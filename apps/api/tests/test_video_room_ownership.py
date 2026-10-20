"""Dọn phòng tạo muộn sau xóa dữ liệu mà không xóa nhầm ứng dụng/môi trường khác."""

import asyncio
import json
from datetime import timedelta

import pytest
from livekit import api as lk

from app.models import SessionStatus
from app.services import tokens
from tests.test_video_room import ROOM, TEACHER, join_status, sweep


async def create(settings, name):
    await tokens.ensure_livekit_room(settings, name, timedelta(minutes=10))


def test_sweep_deletes_only_owned_orphans_and_can_run_again(settings, repo, rooms):
    async def scenario():
        await create(settings, "owned-orphan")
        rooms.lk.rooms["legacy-orphan"] = lk.CreateRoomRequest(name="legacy-orphan")
        assert rooms.lk.rooms["owned-orphan"].metadata
        assert await sweep(repo, settings) == 1
        assert set(rooms.lk.rooms) == {"legacy-orphan"}
        assert await sweep(repo, settings) == 0

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "other_config",
    [
        {"app_env": "staging"},
        {"supabase_url": "https://other.supabase.co"},
        {"livekit_url": "wss://other.livekit.cloud"},
        {"livekit_api_secret": "other-project-secret"},
    ],
)
def test_sweep_preserves_other_environment_or_project(settings, repo, rooms, other_config):
    async def scenario():
        await create(settings.model_copy(update=other_config), "foreign-orphan")
        assert await sweep(repo, settings) == 0

    asyncio.run(scenario())
    assert "foreign-orphan" in rooms.lk.rooms


@pytest.mark.parametrize("change", ["copy_name", "tamper", "bad_json", "json_list", "large"])
def test_metadata_must_be_valid_signed_and_bound_to_room(settings, repo, rooms, change):
    async def scenario():
        await create(settings, "original")
        req = rooms.lk.rooms.pop("original")
        if change == "copy_name":
            req.name = "copy"
        elif change == "tamper":
            data = json.loads(req.metadata)
            data["signature"] = "0" * 64
            req.metadata = json.dumps(data)
        elif change == "bad_json":
            req.metadata = "{"
        elif change == "json_list":
            req.metadata = "[]"
        else:
            req.metadata = "x" * 10_000
        rooms.lk.rooms[req.name] = req
        assert await sweep(repo, settings) == 0

    asyncio.run(scenario())
    assert len(rooms.lk.rooms) == 1


def test_database_failure_does_not_turn_managed_live_room_into_orphan(
    settings, repo, rooms, monkeypatch
):
    async def unavailable(_name):
        raise RuntimeError("Database chưa trả lời")

    async def scenario():
        await create(settings, ROOM)
        monkeypatch.setattr(repo, "get_session_by_room_name", unavailable)
        assert await sweep(repo, settings) == 0

    asyncio.run(scenario())
    assert ROOM in rooms.lk.rooms


def test_owned_orphan_delete_failure_is_retried(settings, repo, rooms):
    async def scenario():
        await create(settings, "orphan")
        rooms.lk.fail = {"delete"}
        assert await sweep(repo, settings) == 0
        assert "orphan" in rooms.lk.rooms
        rooms.lk.fail.clear()
        assert await sweep(repo, settings) == 1
        assert "orphan" not in rooms.lk.rooms

    asyncio.run(scenario())


def test_teacher_loses_start_race_compensates_created_room(settings, repo, rooms):
    def cancel_before_start():
        from tests.conftest import SESSION_ID

        repo.sessions[SESSION_ID] = repo.sessions[SESSION_ID].model_copy(
            update={"status": SessionStatus.cancelled}
        )

    repo.before_next_update = cancel_before_start
    assert asyncio.run(join_status(repo, settings, TEACHER)) == 409
    assert ROOM not in rooms.lk.rooms
    assert repo.open_attendance() == []

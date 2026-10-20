"""Chạy kịch bản T1–T14 (scripts/livekit_dev_check.py) offline trên FakeLiveKit.

Chỉ kiểm kịch bản không hỏng và đọc kết quả đúng chiều theo MÔ HÌNH; không thay cho chạy trên dự
án LiveKit dev (kết quả thật ghi ở docs/design-video-token.md mục 9.3).
"""

import asyncio
import sys
from types import SimpleNamespace

import pytest

from scripts import livekit_dev_check as dc

ROOM = "devcheck-test"
REJECTED = "bị từ chối"


class _Conn:
    connection_state = "connected"

    def on(self, *_args) -> None:
        return None

    async def disconnect(self) -> None:
        return None


@pytest.fixture
def offline(monkeypatch, rooms, clock, settings):
    lkf = rooms.lk

    async def connect(_settings, token):
        return _Conn() if lkf.can_connect(token) else f"{REJECTED}: (giả lập)"

    async def sleep(seconds, result=None):
        clock.advance(seconds)
        await asyncio.sleep(0)
        return result

    monkeypatch.setattr(dc, "_connect", connect)
    monkeypatch.setattr(dc, "asyncio", SimpleNamespace(sleep=sleep, gather=asyncio.gather))
    monkeypatch.setattr(
        dc, "time", SimpleNamespace(time=lambda: clock.t, monotonic=lambda: clock.t)
    )

    def run(step, minutes=(1, 12)):
        args = SimpleNamespace(minutes=list(minutes))
        return asyncio.run(dc.STEPS[step](settings, ROOM, args))

    return run


def test_t1_room_not_created_is_rejected(offline):
    assert REJECTED in offline("T1")


def test_t3_reproduces_cloud_old_token_rejoins_deleted_room(offline):
    out = offline("T3")  # mô hình theo Cloud 2026-10-20: không đạt như trên Cloud
    assert "nối lại token cũ sau 2 s: VÀO ĐƯỢC" in out


def test_t3b_reproduces_cloud_room_reappears(offline):
    out = offline("T3B")
    assert "token cũ: VÀO ĐƯỢC" in out and "phòng bị tạo lại: True" in out


def test_t5_token_signed_just_before_revoke_is_rejected_new_token_works(offline):
    out = offline("T5")
    assert f"token cũ: {REJECTED}" in out and "token mới: VÀO ĐƯỢC" in out


def test_t6_identity_that_never_joined_is_revoked(offline):
    assert f"token B: {REJECTED}" in offline("T6")


def test_t7_revocation_survives_room_recreation_in_model(offline):
    out = offline("T7")
    assert "thu hồi A: ok" in out and f"token cũ A: {REJECTED}" in out
    assert "token cũ B (thu hồi lúc phòng không tồn tại):" in out


def test_t8_reports_when_revocation_expires_in_model(offline, rooms):
    out = offline("T8", minutes=(1, 12))  # mô hình giữ thu hồi 660 s
    assert f"+1 phút: {REJECTED}" in out and "+12 phút: VÀO ĐƯỢC" in out


def test_t8b_keeps_b_in_room_and_stops_at_first_rejoin(offline):
    out = offline("T8B", minutes=(1, 12, 30))  # mô hình giữ thu hồi 660 s
    assert f"+1 phút: {REJECTED}" in out and "+12 phút: VÀO ĐƯỢC" in out
    assert "(B: connected)" in out and "+30 phút" not in out


def test_t15_reports_rooms_still_open_in_model(offline, rooms):
    out = offline("T15", minutes=(5,))  # mô hình không tự đóng phòng
    assert "không ai vào: còn sau 15 phút" in out and "rồi rời: còn sau 15 phút" in out
    assert f"{ROOM}-roi" not in rooms.lk.rooms  # phòng thứ hai được dọn


def test_t11_t12_room_listing(offline):
    assert "ListRooms thấy phòng" in offline("T11")
    out = offline("T12")
    assert "ListRooms thấy phòng = True" in out and "vào được: VÀO ĐƯỢC" in out


def test_t14_ownership_metadata_round_trip(offline, rooms):
    out = offline("T14")
    assert "phòng do API tạo: managed=True" in out and "phòng tạo tay: managed=False" in out


@pytest.mark.parametrize("production, url", [(True, None), (False, "wss://other.livekit.cloud")])
def test_main_refuses_production_or_other_project(monkeypatch, settings, production, url):
    settings = settings.model_copy(
        update={"app_env": "production" if production else "development"}
    )
    monkeypatch.setattr(dc, "get_settings", lambda: settings)
    argv = ["livekit_dev_check", "--dev-url", url or settings.livekit_url, "T1"]
    monkeypatch.setattr(sys, "argv", argv)
    with pytest.raises(SystemExit, match="Dừng"):
        asyncio.run(dc.main())

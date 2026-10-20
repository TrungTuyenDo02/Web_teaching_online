"""Join/end chạy xen kẽ ngẫu nhiên có tiêm lỗi; mỗi seed tái hiện được.

Mô phỏng nhiều tiến trình bằng một vòng lặp asyncio: FakeRepo và FakeLiveKit nhường vòng lặp
ngẫu nhiên theo seed; ghi có điều kiện của FakeRepo là nguyên tử (như một câu UPDATE ... WHERE).
Bất biến chỉ đúng theo mô hình LiveKit trong FakeLiveKit, không thay được thử nhiều tiến trình thật
hay LiveKit Cloud thật. Tái hiện một seed: `run_seed(<seed>, make_settings())`.
"""

import asyncio
import random
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException

from app.models import DeviceMode, SessionStatus
from app.services import finalize
from tests.conftest import SESSION_ID, FakeLiveKit, FakeRepo, make_settings
from tests.test_video_room import ROOM, STUDENT, TEACHER, end, join

SEEDS = range(400)
FAULTS = ["none", "late_create", "delete_fails", "revoke_fails", "join_dies"]


async def _scenario(rng: random.Random, settings, repo: FakeRepo, lkf: FakeLiveKit) -> str:
    tokens = [(await join(repo, settings, TEACHER)).livekit.token]  # giáo viên mở lớp
    fault = rng.choice(FAULTS)
    if fault == "late_create":
        lkf.hold_creates = 1
    elif fault == "delete_fails":
        lkf.fail_next["delete"] = rng.randint(1, 2)
    elif fault == "revoke_fails":
        lkf.fail_next["revoke"] = rng.randint(1, 2)
    elif fault == "join_dies":

        async def die():
            await asyncio.Event().wait()

        lkf.after_create = die

    async def joiner(user, mode):
        try:
            resp = await join(repo, settings, user, mode)
        except HTTPException:
            return
        if resp.livekit:
            tokens.append(resp.livekit.token)

    jobs = [
        joiner(STUDENT, DeviceMode.main),
        joiner(TEACHER, DeviceMode.main),  # thiết bị thứ hai của giáo viên
        joiner(TEACHER, DeviceMode.board),
        end(repo, settings),
        end(repo, settings),
        finalize.sweep_livekit_rooms(repo, settings),
    ]
    rng.shuffle(jobs)
    tasks = [asyncio.create_task(j) for j in jobs]
    for _ in range(200):  # mọi tác vụ chạy hết, trừ join "chết" đang treo
        await asyncio.sleep(0)
    for task in tasks:
        task.cancel()  # tiến trình chết: không chạy nốt
    await asyncio.gather(*tasks, return_exceptions=True)

    # Vòng lặp nền làm nốt finalize (thử lại nhiều lần đến khi xong), rồi CreateRoom muộn tới
    lkf.rng = repo.rng = None
    later = datetime.now(UTC) + timedelta(minutes=2)
    for _ in range(3):
        await finalize.retry_pending(repo, settings, later)
    lkf.apply_late_creates()

    assert repo.sessions[SESSION_ID].status == SessionStatus.completed, fault
    assert repo.sessions[SESSION_ID].finalized_at is not None, fault
    # P1 theo mô hình, auto-create tắt: phòng (kể cả phòng mồ côi do tạo muộn) chặn bằng thu hồi
    assert not [t for t in tokens if lkf.can_connect(t)], fault
    # Auto-create BẬT (phòng tạo lại được): chỉ còn thu hồi chặn. Trừ G9: thu hồi lỗi mà phòng đã
    # xóa thì lần thử lại không ghi nhận được (test_known_gap_revoke_retried_...), chỉ còn L1
    before = dict(lkf.rooms)
    lkf.auto_create = True
    leaked = [t for t in tokens if lkf.can_connect(t)]
    lkf.auto_create, lkf.rooms = False, before  # bỏ phòng can_connect vừa tự tạo
    assert not leaked or fault == "revoke_fails", fault
    # P2: một lần dọn là hết phòng; không còn lượt điểm danh mở
    await finalize.sweep_livekit_rooms(repo, settings)
    assert ROOM not in lkf.rooms, fault
    assert repo.open_attendance() == [], fault
    return fault


def run_seed(seed: int, settings) -> str:
    rng = random.Random(seed)
    repo, lkf = FakeRepo(), FakeLiveKit()
    repo.rng = lkf.rng = rng
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("app.services.tokens._livekit", lkf.client)
        return asyncio.run(_scenario(rng, settings, repo, lkf))


@pytest.mark.parametrize("chunk", range(4))
def test_random_interleavings_keep_old_tokens_out_and_rooms_closed(chunk):
    settings = make_settings()
    seen: set[str] = set()
    for seed in SEEDS[chunk::4]:
        try:
            seen.add(run_seed(seed, settings))
        except AssertionError as exc:
            raise AssertionError(f"seed {seed}: {exc}") from exc
    assert seen == set(FAULTS)  # mỗi phần đều gặp đủ các kiểu lỗi

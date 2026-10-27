"""Thử T1–T16 (docs/design-video-token.md mục 9.3) trên dự án LiveKit DEV, không production.

Chưa chạy lần nào. Chỉ chạy khi chủ dự án cho phép và đã có dự án LiveKit dev riêng.

Chuẩn bị:
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` trong `.env` là của dự án DEV.
- Đã tắt "auto-create room" của dự án dev (T1–T13 giả định vậy), ghi lại ngày giờ.
- Client giả làm người vào phòng: `pip install livekit` trong một venv tạm (không thêm vào
  requirements của API).
- DỪNG API dev (vòng lặp nền) đang dùng cùng dự án LiveKit: phòng `devcheck-*` do
  `ensure_livekit_room` tạo mang nhãn sở hữu hợp lệ mà không khớp buổi học nào, nên vòng lặp dọn
  sẽ xóa chúng giữa chừng (sai T2, T8, T12, T14).

Chạy từ `apps/api`:
    python -m scripts.livekit_dev_check --dev-url wss://<du-an-dev>.livekit.cloud T1 T2 T3
    python -m scripts.livekit_dev_check --dev-url ... T8 --minutes 1 6 12 30 60
    python -m scripts.livekit_dev_check --dev-url ... T8B --minutes 1 6 12 20 30 45 60
    python -m scripts.livekit_dev_check --dev-url ... T15 --minutes 60
    python -m scripts.livekit_dev_check --dev-url ... T16 --minutes 1 6 12 16 20

Mỗi bước dùng phòng tạm `devcheck-<hex>` và danh tính giả `devcheck-a`/`devcheck-b`, không dùng
dữ liệu học sinh, xóa phòng khi xong. In kết quả để chép vào bảng trong docs/acceptance.md.
T4 (tắt mạng client) và T10 (token máy chủ cấp lại sau hơn 10 phút) làm tay, xem cuối file.
"""

import argparse
import asyncio
import secrets
import time
from datetime import UTC, datetime, timedelta

from livekit import api as lk

from app.config import get_settings
from app.services import tokens

A, B = "devcheck-a", "devcheck-b"


def _old_token(settings, room: str, identity: str) -> str:
    """Token như /join cấp (nbf lùi về lúc đọc trạng thái − 1 phút). Token ký ngay trước khi thu
    hồi mà không lùi nbf thường cùng giây với mốc (so sánh `nbf < mốc`) nên lọt, báo nhầm."""
    return _token(settings, room, identity, datetime.fromtimestamp(time.time(), UTC))


def _token(settings, room: str, identity: str, not_before: datetime | None = None) -> str:
    return tokens.make_livekit_token(
        settings,
        identity=identity,
        name=identity,
        room_name=room,
        min_ttl=timedelta(hours=2),
        not_before=not_before,
    )


async def _connect(settings, token: str):
    """Trả về rtc.Room nếu vào được, ngược lại là chuỗi lỗi."""
    from livekit import rtc  # client chỉ cần cho script này

    room = rtc.Room()
    # Bị từ chối (vd. 404 phòng không tồn tại) thì SDK tự thử lại mãi: giới hạn thời gian chờ
    options = rtc.RoomOptions(auto_subscribe=False, connect_timeout=15)
    try:
        await asyncio.wait_for(room.connect(settings.livekit_url, token, options), 30)
    except Exception as exc:  # ghi nguyên văn lỗi LiveKit trả về
        await room.disconnect()
        return f"bị từ chối: {exc!r}"
    return room


async def _try(settings, token: str) -> str:
    room = await _connect(settings, token)
    if isinstance(room, str):
        return room
    await room.disconnect()
    return "VÀO ĐƯỢC"


async def _revoke(settings, room: str, identity: str, ts: int | None = None) -> str:
    req = lk.RoomParticipantIdentity(
        room=room, identity=identity, revoke_token_ts=ts or int(time.time())
    )
    async with tokens._livekit(settings) as client:
        try:
            await client.room.remove_participant(req)
        except lk.TwirpError as exc:
            return f"lỗi {exc.code}: {exc.message}"
    return "ok"


async def _rooms(settings) -> list[str]:
    return await tokens.list_livekit_room_names(settings)


async def _listed(settings, room: str, present: bool, timeout: float = 20) -> tuple[bool, float]:
    """ListRooms trên Cloud trễ vài giây (T11 đo 5,7 s): chờ tới khi khớp `present` hoặc hết giờ.
    Trả về (trạng thái cuối, số giây đã chờ)."""
    t0 = time.monotonic()
    while True:
        now = room in await _rooms(settings)
        if now == present or time.monotonic() - t0 > timeout:
            return now, time.monotonic() - t0
        await asyncio.sleep(0.5)


async def t1(s, room, _):
    return f"vào phòng chưa tạo: {await _try(s, _token(s, room, A))} (mong đợi: bị từ chối)"


async def t2(s, room, _):
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))
    a = await _connect(s, _token(s, room, A))
    if isinstance(a, str):
        return f"sau ensure: {a} (mong đợi: vào được)"
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))
    await asyncio.sleep(2)
    still = a.connection_state
    await a.disconnect()
    return f"sau ensure vào được; ensure lần hai, trạng thái A: {still} (mong đợi: vẫn kết nối)"


async def t3(s, room, _):
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))
    token = _token(s, room, A)
    a = await _connect(s, token)
    reasons: list[str] = []
    if not isinstance(a, str):
        a.on("disconnected", lambda reason: reasons.append(str(reason)))
    await tokens.close_livekit_room(s, room)
    await asyncio.sleep(2)
    again = await _try(s, token)
    listed, waited = await _listed(s, room, present=False)
    return (
        f"ngắt: {reasons}; nối lại token cũ sau 2 s: {again}; "
        f"phòng còn sau {waited:.1f} s: {listed}"
    )


async def t3b(s, room, _):
    """Như T3 nhưng chỉ thử token cũ khi ListRooms đã hết thấy phòng (tách trễ xóa khỏi tự tạo)."""
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))
    token = _token(s, room, A)
    a = await _connect(s, token)
    if not isinstance(a, str):
        await a.disconnect()
    await tokens.close_livekit_room(s, room)
    listed, waited = await _listed(s, room, present=False)
    again = await _try(s, token)
    after, _ = await _listed(s, room, present=True, timeout=10)
    return (
        f"ListRooms hết thấy phòng: {not listed} sau {waited:.1f} s; token cũ: {again} "
        f"(mong đợi: bị từ chối); phòng bị tạo lại: {after}"
    )


async def t5(s, room, _):
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))
    old = _old_token(s, room, A)
    a = await _connect(s, old)
    revoked = await _revoke(s, room, A)
    await asyncio.sleep(2)
    if not isinstance(a, str):
        await a.disconnect()
    await asyncio.sleep(1.5)  # token mới phải có nbf (giây) sau mốc thu hồi
    return (
        f"thu hồi: {revoked}; token cũ: {await _try(s, old)} (mong đợi: bị từ chối); "
        f"token mới: {await _try(s, _token(s, room, A))} (mong đợi: vào được)"
    )


async def t6(s, room, _):
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))
    never = _old_token(s, room, B)
    return f"thu hồi B chưa từng vào: {await _revoke(s, room, B)}; token B: {await _try(s, never)}"


async def t7(s, room, _):
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))
    old = _old_token(s, room, A)
    old_b = _old_token(s, room, B)
    revoked = await _revoke(s, room, A)
    await tokens.close_livekit_room(s, room)
    await _listed(s, room, present=False)
    missing = await _revoke(s, room, B)  # phòng không tồn tại
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))
    await _listed(s, room, present=True)
    return (
        f"thu hồi A: {revoked}; thu hồi B khi phòng không tồn tại: {missing}; "
        f"sau tạo lại, token cũ A: {await _try(s, old)} (mong đợi: bị từ chối); "
        f"token cũ B (thu hồi lúc phòng không tồn tại): {await _try(s, old_b)} (G9: ghi lại)"
    )


async def t8(s, room, args):
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=max(args.minutes) + 10))
    old = _old_token(s, room, A)
    await _revoke(s, room, A)
    await tokens.close_livekit_room(s, room)
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=max(args.minutes) + 10))
    start, lines = time.monotonic(), []
    for minute in sorted(args.minutes):
        await asyncio.sleep(max(0, start + minute * 60 - time.monotonic()))
        lines.append(f"+{minute} phút: {await _try(s, old)}")
    return "; ".join(lines) + " (ghi lại lúc thu hồi hết hiệu lực, nếu có)"


async def t8b(s, room, args):
    """Như T8 nhưng B ở trong phòng suốt lúc đo: T8 thấy phòng trống tự đóng sau 6–12 phút nên
    không đo được thời hạn thu hồi (G2)."""
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=max(args.minutes) + 10))
    old = _old_token(s, room, A)
    keeper = await _connect(s, _token(s, room, B))
    if isinstance(keeper, str):
        return f"B giữ phòng: {keeper} (cần vào được mới đo được)"
    await _revoke(s, room, A)
    start, lines = time.monotonic(), []
    try:
        for minute in sorted(args.minutes):
            await asyncio.sleep(max(0, start + minute * 60 - time.monotonic()))
            result = await _try(s, old)
            lines.append(f"+{minute} phút: {result} (B: {keeper.connection_state})")
            if result == "VÀO ĐƯỢC":
                break  # thu hồi đã hết hiệu lực, các mốc sau không cần
    finally:
        await keeper.disconnect()
    return "; ".join(lines) + " (mốc VÀO ĐƯỢC đầu tiên = thu hồi hết hiệu lực)"


async def t16(s, room, args):
    """L4 (mục 9.4) trên Cloud: B giữ phòng như T8b; thu hồi A bằng đúng hàm của vòng lặp nền,
    lặp lại mỗi 2 phút, rồi thử token cũ ở từng mốc. Đạt khi mọi mốc bị từ chối, kể cả sau 12
    phút (T8b: một lần thu hồi hết hiệu lực trong khoảng 6–12 phút)."""
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=max(args.minutes) + 10))
    old = _old_token(s, room, A)
    keeper = await _connect(s, _token(s, room, B))
    if isinstance(keeper, str):
        return f"B giữ phòng: {keeper} (cần vào được mới đo được)"
    revokes = 0

    async def revoke_forever():
        nonlocal revokes
        while True:
            await tokens.revoke_livekit_tokens(s, room, [A])
            revokes += 1
            await asyncio.sleep(120)

    loop = asyncio.create_task(revoke_forever())
    start, lines = time.monotonic(), []
    try:
        for minute in sorted(args.minutes):
            await asyncio.sleep(max(0, start + minute * 60 - time.monotonic()))
            result = await _try(s, old)
            lines.append(
                f"+{minute} phút: {result} (đã thu hồi {revokes} lần, B: {keeper.connection_state})"
            )
    finally:
        loop.cancel()
        await keeper.disconnect()
    return "; ".join(lines) + " (mong đợi: mọi mốc bị từ chối)"


async def t15(s, room, args):
    """Phòng `ensure` giữ max(minutes) phút: phòng không ai vào và phòng có người vào 30 s rồi
    rời. Ghi lúc mỗi phòng tự đóng, theo dõi thêm 10 phút sau hạn đặt."""
    keep = max(args.minutes)
    left = f"{room}-roi"
    t0 = time.monotonic()
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=keep))
    await tokens.ensure_livekit_room(s, left, timedelta(minutes=keep))
    closed: dict[str, float] = {}
    try:
        visitor = await _connect(s, _token(s, left, A))
        if isinstance(visitor, str):
            return f"vào phòng thứ hai: {visitor} (cần vào được mới đo được)"
        await asyncio.sleep(30)
        await visitor.disconnect()
        while len(closed) < 2 and time.monotonic() - t0 < (keep + 10) * 60:
            await asyncio.sleep(30)
            try:
                names = await _rooms(s)
            except Exception:  # lỗi mạng một lần không làm mất cả phép đo dài
                continue
            for name in (room, left):
                if name not in names and name not in closed:
                    closed[name] = (time.monotonic() - t0) / 60
    finally:
        await tokens.close_livekit_room(s, left)

    def when(name: str) -> str:
        if name in closed:
            return f"tự đóng sau ~{closed[name]:.1f} phút"
        return f"còn sau {keep + 10} phút"

    return (
        f"đặt giữ {keep} phút; không ai vào: {when(room)}; "
        f"có người vào 30 s rồi rời: {when(left)} (ListRooms đọc mỗi 30 s, trễ vài giây)"
    )


async def t9(s, room, _):
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))
    result = await _revoke(s, room, A, int(time.time()) + 30)
    await asyncio.sleep(2)
    inside = await _try(s, _token(s, room, A))  # ký trong 30 s sau mốc
    return f"mốc +30 s: {result}; token ký sau đó 2 s: {inside}"


async def t11(s, room, _):
    t0 = time.monotonic()
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))
    for _ in range(20):
        if room in await _rooms(s):
            return f"ListRooms thấy phòng sau {time.monotonic() - t0:.2f} s"
        await asyncio.sleep(0.5)
    return "ListRooms chưa thấy phòng sau 10 s"


async def t12(s, room, _):
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))

    async def create_soon():
        await asyncio.sleep(0.05)
        await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))

    # Hai "tiến trình" (hai client riêng): xóa và tạo gần như cùng lúc, tạo hoàn tất sau
    await asyncio.gather(tokens.close_livekit_room(s, room), create_soon())
    listed, waited = await _listed(s, room, present=True)
    joined = await _try(s, _token(s, room, A))  # không dựa riêng vào ListRooms
    return (
        f"sau xóa rồi tạo: ListRooms thấy phòng = {listed} ({waited:.1f} s), "
        f"vào được: {joined} (mong đợi: True, vào được)"
    )


async def t13(s, room, _):
    async with tokens._livekit(s) as client:
        await client.room.create_room(lk.CreateRoomRequest(name=room, empty_timeout=60))
    await asyncio.sleep(90)
    listed, _ = await _listed(s, room, present=False)
    return f"sau 90 s không ai vào: phòng còn = {listed} (mong đợi: False)"


async def t14(s, room, _):
    await tokens.ensure_livekit_room(s, room, timedelta(minutes=10))
    manual = f"{room}-tay"
    async with tokens._livekit(s) as client:
        await client.room.create_room(lk.CreateRoomRequest(name=manual, empty_timeout=60))
    try:
        await _listed(s, room, present=True)
        await _listed(s, manual, present=True)
        found = {r.name: r.managed for r in await tokens.list_livekit_rooms(s)}
    finally:
        await tokens.close_livekit_room(s, manual)
    return (
        f"phòng do API tạo: managed={found.get(room)} (mong đợi: True, metadata qua Cloud còn "
        f"nguyên); phòng tạo tay: managed={found.get(manual)} (mong đợi: False)"
    )


STEPS = {"T1": t1, "T2": t2, "T3": t3, "T3B": t3b, "T5": t5, "T6": t6, "T7": t7, "T8": t8, "T9": t9}
STEPS |= {"T8B": t8b, "T11": t11, "T12": t12, "T13": t13, "T14": t14, "T15": t15, "T16": t16}


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--dev-url", required=True, help="phải trùng LIVEKIT_URL (chốt chặn)")
    parser.add_argument("--minutes", type=int, nargs="*", default=[1, 6, 12, 30, 60])
    parser.add_argument("steps", nargs="+", choices=sorted(STEPS))
    args = parser.parse_args()
    settings = get_settings()
    if settings.is_production or args.dev_url != settings.livekit_url:
        raise SystemExit("Dừng: chỉ chạy trên dự án LiveKit dev, --dev-url phải trùng LIVEKIT_URL")
    print(f"{datetime.now(UTC).isoformat()} dự án {settings.livekit_url}")
    for step in args.steps:
        room = f"devcheck-{secrets.token_hex(6)}"
        try:
            print(f"{step}: {await STEPS[step](settings, room, args)}", flush=True)
        except Exception as exc:
            print(f"{step}: LỖI {exc!r}", flush=True)
        finally:
            await tokens.close_livekit_room(settings, room)


if __name__ == "__main__":
    asyncio.run(main())

# Làm tay:
# T4: web dev, vào phòng bằng hai máy; tắt Wi-Fi máy A 30 s rồi bật: A phải tự nối lại (phòng còn).
# T10: giữ một client nối hơn 10 phút (máy chủ cấp lại token), rồi GV kết thúc buổi trên web; tắt
#      mạng client 10 s rồi bật: client không được vào lại. Ghi lại nếu SDK không tự nối lại sau
#      ROOM_DELETED (khi đó token cấp lại chỉ còn trong bộ nhớ client, cần thử bằng công cụ khác).

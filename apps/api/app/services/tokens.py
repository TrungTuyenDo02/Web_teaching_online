import hashlib
import hmac
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

import aiohttp
import httpx
import jwt
from livekit import api as lk

from app.config import Settings
from app.core import time as clock
from app.models import DeviceMode, Role

# Lệch đồng hồ tối đa giữa các tiến trình API (bằng đệm một phút LiveKit tự dùng khi thu hồi)
CLOCK_SKEW = timedelta(minutes=1)
# Dưới 5 s thì SDK chỉ gửi một lần, không tự phát lại CreateRoom (giảm phòng tạo muộn)
CREATE_ROOM_TIMEOUT = 4.0


def make_livekit_token(
    settings: Settings,
    *,
    identity: str,
    name: str,
    room_name: str,
    min_ttl: timedelta = timedelta(0),
    not_before: datetime | None = None,
) -> str:
    """Token vào đúng một phòng video. Sống ít nhất min_ttl (đến hết khung giờ vào phòng).

    not_before: lúc đọc trạng thái buổi để quyết định cấp token. nbf lùi về mốc đó (trừ lệch đồng
    hồ), nên lần thu hồi lúc kết thúc (mốc = giờ đóng phòng, sau lần đọc ấy) vẫn chặn token này dù
    yêu cầu bị treo và ký muộn.
    """
    grants = lk.VideoGrants(
        room_join=True,
        room=room_name,
        can_publish=True,
        can_subscribe=True,
        can_publish_data=False,
    )
    token = (
        lk.AccessToken(settings.livekit_api_key, settings.livekit_api_secret)
        .with_identity(identity)
        .with_name(name)
        .with_grants(grants)
        .with_ttl(max(timedelta(seconds=settings.livekit_token_ttl_seconds), min_ttl))
    )
    if not_before is None:
        return token.to_jwt()
    # SDK luôn đặt nbf = lúc ký: ký lại cùng claim, cùng khóa, chỉ đổi nbf
    claims = jwt.decode(token.to_jwt(), options={"verify_signature": False})
    claims["nbf"] = int((not_before - CLOCK_SKEW).timestamp())
    return jwt.encode(claims, settings.livekit_api_secret, algorithm="HS256")


def make_whiteboard_token(
    settings: Settings,
    *,
    user_id: str,
    session_id: str,
    role: Role,
    mode: DeviceMode,
    min_ttl: timedelta = timedelta(0),
) -> str:
    """Token cho máy chủ bảng viết (cùng khóa bí mật). Sống ít nhất min_ttl để nối lại được."""
    now = clock.now_utc()
    ttl = max(timedelta(seconds=settings.whiteboard_token_ttl_seconds), min_ttl)
    payload = {
        "sub": user_id,
        "sid": session_id,
        "role": str(role),
        "mode": str(mode),
        "iat": now,
        "exp": now + ttl,
    }
    return jwt.encode(payload, settings.whiteboard_jwt_secret, algorithm="HS256")


def make_whiteboard_close_token(settings: Settings, *, session_id: str, act: str = "close") -> str:
    """Token chỉ dùng để đóng (act=close) hoặc xóa dữ liệu (act=purge) một phòng bảng viết;
    không có sub/role nên không vào phòng được."""
    now = clock.now_utc()
    payload = {"sid": session_id, "act": act, "iat": now, "exp": now + timedelta(seconds=60)}
    return jwt.encode(payload, settings.whiteboard_jwt_secret, algorithm="HS256")


async def close_whiteboard_room(settings: Settings, session_id: str) -> list[dict]:
    """Báo máy chủ bảng ngắt mọi thiết bị, chặn token cũ; trả về nội dung bảng cuối cùng."""
    token = make_whiteboard_close_token(settings, session_id=session_id)
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{settings.whiteboard_internal_url.rstrip('/')}/rooms/{session_id}/close",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()
    return resp.json().get("elements", [])


async def purge_whiteboard_room(settings: Settings, session_id: str) -> None:
    """Xóa nội dung bảng của buổi trên máy chủ bảng (xóa học sinh); máy chủ vẫn chặn token cũ."""
    token = make_whiteboard_close_token(settings, session_id=session_id, act="purge")
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{settings.whiteboard_internal_url.rstrip('/')}/rooms/{session_id}/purge",
            headers={"Authorization": f"Bearer {token}"},
        )
        resp.raise_for_status()


def _livekit(settings: Settings, timeout: float | None = None) -> lk.LiveKitAPI:
    """Client API phòng LiveKit (test thay bằng bản giả ở đây)."""
    return lk.LiveKitAPI(
        settings.livekit_url,
        settings.livekit_api_key,
        settings.livekit_api_secret,
        timeout=aiohttp.ClientTimeout(total=timeout) if timeout else None,
    )


@dataclass(frozen=True)
class VideoRoom:
    name: str
    managed: bool


def _room_metadata(settings: Settings, room_name: str) -> str:
    """Nhãn sở hữu gắn với tên phòng và môi trường; không chứa hồ sơ hay thông tin học sinh.

    Chữ ký dùng khóa LiveKit hiện có, không phải token đăng nhập. Đổi khóa/môi trường thì nhãn
    cũ không được nhận để xóa tự động; phòng không rõ chủ sở hữu luôn được giữ lại.
    """
    if not settings.livekit_api_secret or not settings.supabase_url or not settings.livekit_url:
        return ""
    scope = json.dumps(
        [
            settings.app_env.lower(),
            settings.supabase_url.rstrip("/"),
            settings.livekit_url.rstrip("/"),
        ]
    )
    data = {
        "app": "gia-su-online",
        "version": 1,
        "scope": hashlib.sha256(scope.encode()).hexdigest(),
        "room": room_name,
    }
    payload = json.dumps(data, sort_keys=True).encode()
    data["signature"] = hmac.new(
        settings.livekit_api_secret.encode(), b"video-room-ownership\0" + payload, hashlib.sha256
    ).hexdigest()
    return json.dumps(data, sort_keys=True)


async def list_livekit_rooms(settings: Settings) -> list[VideoRoom]:
    """Liệt kê phòng và xác minh nhãn sở hữu; không lộ metadata ra ngoài lớp LiveKit."""
    async with _livekit(settings) as client:
        rooms = (await client.room.list_rooms(lk.ListRoomsRequest())).rooms
    result = []
    for room in rooms:
        expected = _room_metadata(settings, room.name)
        managed = (
            bool(expected)
            and len(room.metadata) <= 4096
            and hmac.compare_digest(room.metadata.encode(), expected.encode())
        )
        result.append(VideoRoom(name=room.name, managed=managed))
    return result


async def list_livekit_room_names(settings: Settings) -> list[str]:
    """Tên các phòng đang mở trên dự án LiveKit."""
    return [room.name for room in await list_livekit_rooms(settings)]


async def count_livekit_rooms(settings: Settings) -> int:
    """Chỉ đọc: số phòng đang mở. Dùng để kiểm tra URL và cặp khóa LiveKit (preflight)."""
    return len(await list_livekit_room_names(settings))


async def ensure_livekit_room(settings: Settings, room_name: str, keep_open: timedelta) -> None:
    """Tạo phòng video (có rồi thì thôi). Dự án LiveKit tắt auto-create nên chỉ API tạo phòng.

    Phòng trống hay mọi người cùng rớt mạng vẫn giữ đến hết khung giờ để SDK nối lại được.
    """
    seconds = max(1, int(keep_open.total_seconds()))
    req = lk.CreateRoomRequest(
        name=room_name,
        empty_timeout=seconds,
        departure_timeout=seconds,
        metadata=_room_metadata(settings, room_name),
    )
    async with _livekit(settings, CREATE_ROOM_TIMEOUT) as client:
        await client.room.create_room(req)


def _not_found(exc: Exception) -> bool:
    return isinstance(exc, lk.TwirpError) and exc.code == lk.TwirpErrorCode.NOT_FOUND


async def close_livekit_room(
    settings: Settings, room_name: str, identities: Sequence[str] = ()
) -> None:
    """Thu hồi token video của identities (LiveKit Cloud) rồi xóa phòng: LiveKit ngắt mọi người
    (ROOM_DELETED). Thu hồi lỗi vẫn xóa phòng, rồi báo lỗi để người gọi thử lại sau.

    Mốc thu hồi = giờ hiện tại (Cloud chỉ nhận trong ±60 s): mọi token cấp trước đó, kể cả token
    ký muộn có nbf lùi về lúc đọc trạng thái (make_livekit_token), bị từ chối khi nối lại.
    """
    revoke_at = int(clock.now_utc().timestamp())
    failure: Exception | None = None
    async with _livekit(settings) as client:
        for identity in identities:
            req = lk.RoomParticipantIdentity(
                room=room_name, identity=identity, revoke_token_ts=revoke_at
            )
            try:
                await client.room.remove_participant(req)
            except Exception as exc:
                # not_found: phòng không còn (đã xóa hoặc tự đóng), không còn gì để thu hồi ở đây
                if not _not_found(exc):
                    failure = failure or exc
        try:
            await client.room.delete_room(lk.DeleteRoomRequest(room=room_name))
        except Exception as exc:
            if not _not_found(exc):  # phòng đã tự đóng khi hết người: bỏ qua
                raise
    if failure:
        raise failure

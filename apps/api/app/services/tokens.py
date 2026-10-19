from datetime import UTC, datetime, timedelta

import jwt
from livekit import api as lk

from app.config import Settings
from app.models import DeviceMode, Role


def make_livekit_token(
    settings: Settings,
    *,
    identity: str,
    name: str,
    room_name: str,
) -> str:
    """Token vào đúng một phòng video, chỉ cho phép vào phòng đó."""
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
        .with_ttl(timedelta(seconds=settings.livekit_token_ttl_seconds))
    )
    return token.to_jwt()


def make_whiteboard_token(
    settings: Settings,
    *,
    user_id: str,
    session_id: str,
    role: Role,
    mode: DeviceMode,
) -> str:
    """Token ngắn hạn cho máy chủ đồng bộ bảng viết. Máy chủ kiểm tra bằng cùng khóa bí mật."""
    now = datetime.now(UTC)
    payload = {
        "sub": user_id,
        "sid": session_id,
        "role": str(role),
        "mode": str(mode),
        "iat": now,
        "exp": now + timedelta(seconds=settings.whiteboard_token_ttl_seconds),
    }
    return jwt.encode(payload, settings.whiteboard_jwt_secret, algorithm="HS256")

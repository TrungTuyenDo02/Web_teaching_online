from functools import lru_cache

import jwt
from fastapi import Depends, Header, HTTPException, status
from pydantic import BaseModel

from app.config import Settings, get_settings


class AuthUser(BaseModel):
    id: str
    email: str | None = None


@lru_cache
def _jwks_client(url: str) -> jwt.PyJWKClient:
    # PyJWKClient tự lưu khóa trong bộ nhớ, chỉ tải lại khi gặp kid lạ
    return jwt.PyJWKClient(url, cache_keys=True, lifespan=3600, timeout=10)


def _decode(token: str, settings: Settings) -> dict:
    """Dự án Supabase mới ký ES256 (khóa công khai lấy từ JWKS); dự án cũ ký HS256.

    Chọn khóa theo thuật toán trong header, nhưng mỗi nhánh chỉ chấp nhận đúng loại thuật toán
    của nó, nên kẻ gian không thể đổi header để ép dùng khóa công khai làm bí mật HMAC.
    """
    alg = jwt.get_unverified_header(token).get("alg")
    if alg == "HS256":
        if not settings.supabase_jwt_secret:
            raise jwt.InvalidTokenError("HS256 chưa được cấu hình")
        key, algorithms = settings.supabase_jwt_secret, ["HS256"]
    else:
        jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        key, algorithms = _jwks_client(jwks_url).get_signing_key_from_jwt(token), ["ES256", "RS256"]
    return jwt.decode(token, key, algorithms=algorithms, audience=settings.supabase_jwt_audience)


def get_current_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> AuthUser:
    """Xác thực JWT do Supabase Auth cấp. Vai trò luôn lấy từ bảng profiles, không tin claim."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Thiếu token đăng nhập")
    if not settings.supabase_url:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Máy chủ chưa cấu hình xác thực")

    token = authorization[7:].strip()
    try:
        payload = _decode(token, settings)
    except (jwt.PyJWTError, jwt.PyJWKClientError) as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Token không hợp lệ hoặc đã hết hạn"
        ) from exc

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token thiếu thông tin người dùng")
    return AuthUser(id=str(sub), email=payload.get("email"))

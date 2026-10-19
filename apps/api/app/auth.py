import jwt
from fastapi import Depends, Header, HTTPException, status
from pydantic import BaseModel

from app.config import Settings, get_settings


class AuthUser(BaseModel):
    id: str
    email: str | None = None


def get_current_user(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> AuthUser:
    """Xác thực JWT do Supabase Auth cấp (HS256).

    Lưu ý: dự án Supabase mới có thể dùng khóa bất đối xứng (JWKS). Khi đó thay phần decode
    bằng PyJWKClient; vai trò (giáo viên/học sinh) luôn lấy từ bảng profiles, không tin claim.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Thiếu token đăng nhập")
    if not settings.supabase_jwt_secret:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Máy chủ chưa cấu hình xác thực")

    token = authorization[7:].strip()
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience=settings.supabase_jwt_audience,
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Token không hợp lệ hoặc đã hết hạn"
        ) from exc

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token thiếu thông tin người dùng")
    return AuthUser(id=str(sub), email=payload.get("email"))

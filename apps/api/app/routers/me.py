from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import AuthUser, get_current_user
from app.models import MeResponse
from app.repo import Repository, get_repo

router = APIRouter(prefix="/api", tags=["me"])


@router.get("/me", response_model=MeResponse)
async def me(user: AuthUser = Depends(get_current_user), repo: Repository = Depends(get_repo)):
    profile = await repo.get_profile(user.id)
    if profile is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Tài khoản chưa có hồ sơ")
    return MeResponse(id=profile.id, role=profile.role, full_name=profile.full_name)

from fastapi import APIRouter, Depends, HTTPException

from app.auth import AuthUser, get_current_user
from app.models import MonthlySessionReport
from app.repo import Repository, get_repo
from app.routers.sessions import require_teacher
from app.services.reports import InvalidReportMonth, monthly_sessions

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/sessions", response_model=MonthlySessionReport)
async def monthly_session_report(
    month: str | None = None,
    user: AuthUser = Depends(get_current_user),
    repo: Repository = Depends(get_repo),
) -> MonthlySessionReport:
    """Giáo viên xem số buổi completed theo tháng giờ Việt Nam, chỉ học sinh của mình.

    Đếm theo ngày bắt đầu đã xếp lịch; không thay đổi điều kiện completed hay giữ dữ liệu đã xóa.
    Không truyền ghi chú/phụ huynh trong báo cáo. Bỏ month thì lấy tháng hiện tại ở Việt Nam.
    """
    profile = await require_teacher(user, repo, "Chỉ giáo viên được xem báo cáo")
    try:
        return await monthly_sessions(repo, profile.id, month)
    except InvalidReportMonth as exc:
        raise HTTPException(422, str(exc)) from None

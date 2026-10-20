"""Thời gian hệ thống: lưu UTC, ngày nghiệp vụ theo giờ Việt Nam (UTC+07).

Không diễn giải ngày bằng LLM. Biểu thức chưa đủ rõ phải được người dùng làm rõ.
"""

import re
from datetime import UTC, date, datetime, timedelta, timezone

VIETNAM_TZ = timezone(timedelta(hours=7), name="Asia/Ho_Chi_Minh")
_WEEKDAYS = {
    "thứ hai": 0,
    "thứ 2": 0,
    "thứ ba": 1,
    "thứ 3": 1,
    "thứ tư": 2,
    "thứ 4": 2,
    "thứ năm": 3,
    "thứ 5": 3,
    "thứ sáu": 4,
    "thứ 6": 4,
    "thứ bảy": 5,
    "thứ 7": 5,
    "chủ nhật": 6,
}


def now_utc() -> datetime:
    return datetime.now(UTC)


def as_vietnam(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Thời điểm phải có múi giờ")
    return value.astimezone(VIETNAM_TZ)


def vietnam_to_utc(day: date, hour: int, minute: int) -> datetime:
    """Giờ đồng hồ ở Việt Nam của một ngày → thời điểm UTC (Việt Nam không đổi giờ theo mùa)."""
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=VIETNAM_TZ).astimezone(UTC)


def month_bounds_utc(year: int, month: int) -> tuple[datetime, datetime]:
    """Khoảng nửa mở [đầu tháng, đầu tháng sau) theo giờ Việt Nam, trả về UTC."""
    start = datetime(year, month, 1, tzinfo=VIETNAM_TZ)
    end = datetime(year + (month == 12), month % 12 + 1, 1, tzinfo=VIETNAM_TZ)
    return start.astimezone(UTC), end.astimezone(UTC)


def resolve_date(expression: str, reference: datetime) -> date:
    """Hỗ trợ ngày ISO, hôm nay/mai/kia, thứ cụ thể của tuần này/tuần sau.

    Thiếu tuần (vd. 'thứ Ba') hoặc diễn đạt chưa hỗ trợ thì từ chối, không đoán.
    Kết quả có thể ở quá khứ: quy tắc cho phép xếp buổi nằm ở lớp nghiệp vụ/API.
    """
    today = as_vietnam(reference).date()
    value = " ".join(expression.lower().strip().split())
    offsets = {"hôm nay": 0, "ngày mai": 1, "mai": 1, "ngày kia": 2}
    if value in offsets:
        return today + timedelta(days=offsets[value])
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return date.fromisoformat(value)
    for week, offset in (("tuần này", 0), ("tuần sau", 7)):
        if value.endswith(" " + week):
            weekday = _WEEKDAYS.get(value.removesuffix(" " + week))
            if weekday is not None:
                return today - timedelta(days=today.weekday()) + timedelta(days=offset + weekday)
    raise ValueError("Cần ngày cụ thể hoặc thứ kèm 'tuần này'/'tuần sau'")

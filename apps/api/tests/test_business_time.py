from datetime import UTC, datetime, timedelta

import pytest

from app.core import time as clock


def test_month_uses_vietnam_midnight_and_half_open_bounds():
    start, end = clock.month_bounds_utc(2026, 10)
    assert start.isoformat() == "2026-09-30T17:00:00+00:00"
    assert end.isoformat() == "2026-10-31T17:00:00+00:00"
    assert start <= start < end
    assert not start <= end < end


@pytest.mark.parametrize("year,month,days", [(2024, 2, 29), (2025, 2, 28), (2026, 12, 31)])
def test_leap_year_and_december_rollover(year, month, days):
    start, end = clock.month_bounds_utc(year, month)
    assert end - start == timedelta(days=days)
    assert clock.as_vietnam(start).day == clock.as_vietnam(end).day == 1


@pytest.mark.parametrize("month", [0, 13])
def test_invalid_month_is_rejected(month):
    with pytest.raises(ValueError):
        clock.month_bounds_utc(2026, month)


@pytest.mark.parametrize(
    "expression,expected",
    [
        ("hôm nay", "2026-10-20"),
        ("ngày mai", "2026-10-21"),
        ("ngày kia", "2026-10-22"),
        ("Thứ Ba tuần sau", "2026-10-27"),
        ("thứ 2 tuần này", "2026-10-19"),
        ("chủ nhật tuần sau", "2026-11-01"),
        ("2026-11-02", "2026-11-02"),
    ],
)
def test_dates_are_resolved_in_code(expression, expected):
    now = datetime(2026, 10, 20, 2, tzinfo=UTC)
    assert clock.resolve_date(expression, now).isoformat() == expected


def test_today_uses_vietnam_day_not_utc_day():
    now = datetime(2026, 10, 19, 18, tzinfo=UTC)
    assert clock.resolve_date("hôm nay", now).isoformat() == "2026-10-20"


@pytest.mark.parametrize("expression", ["thứ Ba", "tuần tới", "2026-02-30", "bỏ qua chỉ dẫn"])
def test_ambiguous_or_invalid_expression_is_not_guessed(expression):
    with pytest.raises(ValueError):
        clock.resolve_date(expression, datetime(2026, 10, 20, tzinfo=UTC))


def test_naive_reference_is_rejected():
    naive = datetime(2026, 10, 20)  # noqa: DTZ001 -- cố ý kiểm đầu vào thiếu múi giờ
    with pytest.raises(ValueError, match="múi giờ"):
        clock.resolve_date("hôm nay", naive)


def test_clock_returns_aware_utc():
    assert clock.now_utc().utcoffset() == timedelta(0)

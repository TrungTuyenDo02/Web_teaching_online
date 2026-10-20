import pytest

from scripts.check_time_usage import violations


@pytest.mark.parametrize(
    "source",
    [
        "from datetime import datetime; datetime.now()",
        "from datetime import datetime as D; D.now()",
        "import datetime as dt; dt.datetime.now()",
        "from datetime import date as d; d.today()",
        "import datetime; datetime.datetime.utcnow()",
    ],
)
def test_guard_rejects_direct_clocks_and_aliases(source):
    assert violations(source) == [1]


def test_guard_allows_application_clock_and_duration_operations():
    assert violations("clock.now_utc(); datetime.fromisoformat(value); time.monotonic()") == []

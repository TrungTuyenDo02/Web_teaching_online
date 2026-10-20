import importlib.util
import json
from pathlib import Path

import pytest

EVAL_DIR = Path(__file__).resolve().parents[3] / "evals"
_spec = importlib.util.spec_from_file_location("platform_evals", EVAL_DIR / "run.py")
runner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(runner)


def test_real_e0_dataset_passes():
    rows = runner.evaluate(EVAL_DIR / "suites/deterministic/cases.jsonl")
    assert len(rows) == 10 and all(row["passed"] for row in rows)


@pytest.mark.parametrize("content", ["", "{", "[]", '{"id":"a"}', '{"id":"a"}\n{"id":"a"}'])
def test_empty_malformed_or_unsupported_dataset_does_not_pass(tmp_path, content):
    path = tmp_path / "cases.jsonl"
    path.write_text(content, encoding="utf-8")
    with pytest.raises((ValueError, KeyError)):
        runner.evaluate(path)


def test_incorrect_expected_result_fails(tmp_path):
    case = {
        "id": "wrong",
        "operation": "resolve_date",
        "input": {"expression": "hôm nay", "reference": "2026-10-20T09:00:00+07:00"},
        "expected": "2026-10-21",
    }
    path = tmp_path / "cases.jsonl"
    path.write_text(json.dumps(case), encoding="utf-8")
    assert runner.evaluate(path) == [{"id": "wrong", "passed": False}]


def test_duplicate_valid_cases_are_rejected(tmp_path):
    original = (
        (EVAL_DIR / "suites/deterministic/cases.jsonl").read_text(encoding="utf-8").splitlines()[0]
    )
    path = tmp_path / "cases.jsonl"
    path.write_text(original + "\n" + original, encoding="utf-8")
    with pytest.raises(ValueError, match="trùng id"):
        runner.evaluate(path)


def test_cli_reports_success_and_uses_nonzero_for_missing_runner(tmp_path, monkeypatch):
    report_dir = tmp_path / "reports"
    monkeypatch.setattr("sys.argv", ["evals.run", "--suite", "E0", "--report-dir", str(report_dir)])
    assert runner.main() == 0
    report = json.loads(next(report_dir.glob("*.json")).read_text(encoding="utf-8"))
    assert report["mode"] == "offline" and report["model"] is None
    assert report["passed"] == report["total"] == 10
    monkeypatch.setattr("sys.argv", ["evals.run", "--suite", "E3"])
    assert runner.main() == 2

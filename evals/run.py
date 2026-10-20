"""Chạy eval xác định, không khóa API, không mạng; chưa triển khai phải báo not_run.

Chạy từ gốc repo: apps/api/.venv/Scripts/python -m evals.run --suite E0
"""

import argparse
import hashlib
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.core import time as clock  # noqa: E402


def execute(case: dict) -> object:
    args = case["input"]
    if case["operation"] == "month_bounds":
        return [value.isoformat() for value in clock.month_bounds_utc(args["year"], args["month"])]
    if case["operation"] == "resolve_date":
        return clock.resolve_date(
            args["expression"], datetime.fromisoformat(args["reference"])
        ).isoformat()
    raise ValueError("Loại ca eval chưa hỗ trợ")


def evaluate(path: Path) -> list[dict]:
    cases = [
        json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()
    ]
    if not cases:
        raise ValueError("Bộ eval rỗng")
    seen = set()
    for case in cases:
        if not isinstance(case, dict) or not isinstance(case.get("id"), str) or not case["id"]:
            raise ValueError("Ca eval thiếu id hợp lệ")
        if case["id"] in seen:
            raise ValueError("Ca eval trùng id")
        seen.add(case["id"])
        if case.get("operation") not in {"month_bounds", "resolve_date"}:
            raise ValueError("Loại ca eval chưa hỗ trợ")
        if ("expected" in case) == ("expected_error" in case):
            raise ValueError("Ca eval phải có đúng một kết quả mong đợi")
        if not isinstance(case.get("input"), dict):
            raise ValueError("Ca eval thiếu input")
        if case.get("expected_error", "ValueError") != "ValueError":
            raise ValueError("Loại lỗi mong đợi chưa hỗ trợ")
    results = []
    for case in cases:
        try:
            actual = execute(case)
            passed = "expected" in case and actual == case["expected"]
        except ValueError:
            passed = case.get("expected_error") == "ValueError"
        results.append({"id": case["id"], "passed": passed})
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--suite", default="E0")
    parser.add_argument("--cases", type=Path)
    parser.add_argument("--report-dir", type=Path, default=ROOT / "evals" / "reports")
    args = parser.parse_args()
    catalog = json.loads((ROOT / "evals" / "catalog.json").read_text(encoding="utf-8"))
    suite = catalog.get(args.suite)
    if not suite or suite["mode"] != "offline":
        print(
            json.dumps(
                {"suite": args.suite, "status": "not_run", "reason": "chưa có runner offline"}
            )
        )
        return 2
    path = args.cases or ROOT / "evals" / suite["cases"]
    try:
        results = evaluate(path)
    except (ValueError, KeyError, TypeError, OSError):
        print("Lỗi cấu trúc/dữ liệu bộ eval; không báo đạt", file=sys.stderr)
        return 2
    passed = sum(case["passed"] for case in results)
    report = {
        "suite": args.suite,
        "status": "passed" if passed == len(results) else "failed",
        "mode": "offline",
        "generated_at": clock.now_utc().isoformat(),
        "dataset_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "implementation_sha256": hashlib.sha256(
            (ROOT / "apps/api/app/core/time.py").read_bytes()
        ).hexdigest(),
        "model": None,
        "prompt_version": None,
        "passed": passed,
        "total": len(results),
        "cases": results,
    }
    args.report_dir.mkdir(parents=True, exist_ok=True)
    stem = f"{args.suite}-{clock.now_utc().strftime('%Y%m%dT%H%M%S%fZ')}"
    (args.report_dir / f"{stem}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (args.report_dir / f"{stem}.md").write_text(
        f"# {args.suite}: {report['status']}\n\nOffline: {passed}/{len(results)}. "
        "Không gọi model; không chứng minh độ chính xác AI hay cổng E1–E9.\n",
        encoding="utf-8",
    )
    print(json.dumps({key: report[key] for key in ("suite", "status", "passed", "total")}))
    return int(passed != len(results))


if __name__ == "__main__":
    sys.exit(main())

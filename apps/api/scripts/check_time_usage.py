"""Chặn đọc đồng hồ trực tiếp ngoài app/core/time.py; không import ứng dụng hay cấu hình."""

import ast
import sys
from pathlib import Path


def violations(source: str) -> list[int]:
    tree = ast.parse(source)
    types = {"datetime", "date"}
    modules = {"datetime"}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "datetime":
            types.update(a.asname or a.name for a in node.names if a.name in {"datetime", "date"})
        if isinstance(node, ast.Import):
            modules.update(a.asname or a.name for a in node.names if a.name == "datetime")
    bad = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        func = node.func
        if func.attr not in {"now", "utcnow", "today"}:
            continue
        owner = func.value
        direct = isinstance(owner, ast.Name) and owner.id in types
        module = (
            isinstance(owner, ast.Attribute)
            and isinstance(owner.value, ast.Name)
            and owner.value.id in modules
            and owner.attr in {"datetime", "date"}
        )
        if direct or module:
            bad.append(node.lineno)
    return sorted(bad)


def main() -> int:
    root = Path(__file__).resolve().parents[1] / "app"
    errors = []
    for path in sorted(root.rglob("*.py")):
        if path == root / "core" / "time.py":
            continue
        for line in violations(path.read_text(encoding="utf-8-sig")):
            errors.append(f"{path.relative_to(root.parent)}:{line}: dùng app.core.time.now_utc()")
    print("\n".join(errors) if errors else "Đạt: thời gian ứng dụng đi qua app/core/time.py")
    return int(bool(errors))


if __name__ == "__main__":
    sys.exit(main())

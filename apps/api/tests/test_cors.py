"""Trình duyệt gọi API khác nguồn (web 5173, API 8000): mọi phương thức của mọi route phải qua được
bước preflight CORS. Test trình duyệt giả API ở ranh giới mạng nên không bắt được lỗi này."""

import re

from app.config import get_settings
from app.main import create_app


def test_every_api_method_passes_cors_preflight(client):
    origin = get_settings().cors_origin_list[0]
    checked, refused = 0, []
    for route_path, operations in create_app().openapi()["paths"].items():
        path = re.sub(r"\{[^}]+\}", "00000000-0000-0000-0000-000000000000", route_path)
        for method in (m.upper() for m in operations):
            resp = client.options(
                path,
                headers={
                    "Origin": origin,
                    "Access-Control-Request-Method": method,
                    "Access-Control-Request-Headers": "authorization,content-type",
                },
            )
            checked += 1
            if resp.status_code != 200:
                refused.append(f"{method} {route_path}: {resp.status_code} {resp.text}")
    assert checked > 10
    assert refused == []

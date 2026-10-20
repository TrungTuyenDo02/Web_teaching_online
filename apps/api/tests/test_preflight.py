import asyncio
import functools

import httpx

from app import preflight
from tests.conftest import make_settings


def test_classify_probe():
    assert preflight.classify_probe(httpx.Response(200, json=[])) == "applied"
    assert preflight.classify_probe(httpx.Response(400, json={"code": "42703"})) == "missing"
    assert preflight.classify_probe(httpx.Response(404, json={"code": "PGRST205"})) == "missing"
    # Khóa sai hay mạng lỗi không được coi là "chưa áp"
    assert preflight.classify_probe(httpx.Response(401, json={"code": "PGRST301"})).startswith(
        "error"
    )
    assert preflight.classify_probe(httpx.Response(502, text="Bad gateway")).startswith("error")


def test_config_issues_names_only():
    settings = make_settings().model_copy(
        update={"supabase_url": "https://YOUR-PROJECT.supabase.co", "livekit_api_secret": ""}
    )
    assert preflight.config_issues(settings) == [
        "LIVEKIT_API_SECRET thiếu",
        "SUPABASE_URL còn giá trị mẫu",
    ]


def test_run_reports_missing_migrations_without_secrets(monkeypatch, capsys):
    settings = make_settings().model_copy(update={"supabase_jwt_secret": ""})

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"  # chỉ đọc
        url = str(request.url)
        if "select=finalized_at" in url or "select=deleting_at" in url:
            return httpx.Response(200, json=[])
        if "board_upload_intents" in url:
            return httpx.Response(404, json={"code": "PGRST205"})
        if "/storage/v1/bucket/" in url:
            return httpx.Response(200, json={"public": False})
        if "jwks.json" in url:
            return httpx.Response(200, json={"keys": [{"kid": "k"}]})
        if url.endswith("/health"):
            raise httpx.ConnectError("không kết nối được tới http://localhost:8787")
        return httpx.Response(200, json=[])

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        preflight.httpx, "AsyncClient", functools.partial(httpx.AsyncClient, transport=transport)
    )

    async def fake_rooms(_settings):
        return 0

    monkeypatch.setattr(preflight, "count_livekit_rooms", fake_rooms)

    assert asyncio.run(preflight.run(settings)) == 1
    out = capsys.readouterr().out
    assert "ĐẠT  migration 0004_session_finalize" in out
    assert "ĐẠT  migration 0005_student_deleting" in out
    assert "CHƯA ÁP  0006_board_upload_intents" in out
    assert "ĐẠT  bucket boards tồn tại, riêng tư\n" in out
    assert "CHƯA ÁP  0007_upload_intent_cleaned" in out
    assert "LỖI  máy chủ bảng (WHITEBOARD_INTERNAL_URL)/health: HTTP 599 ConnectError" in out
    for secret in (settings.supabase_service_role_key, settings.livekit_api_secret, "localhost"):
        assert secret not in out

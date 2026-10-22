"""Snapshot có ảnh: không mất files khi đóng/lưu, không báo lưu bản thiếu ảnh thành công."""

import asyncio
import base64
import hashlib
import json
import struct
import zlib

import httpx
import pytest

from app.services import tokens
from tests.conftest import SESSION_ID, STUDENT_ID, TEACHER_ID, auth_header


def document():
    def chunk(kind, data):
        return (
            struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
        )

    data = b"\x89PNG\r\n\x1a\n"
    data += chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(b"\0\0\0\0")) + chunk(b"IEND", b"")
    key = hashlib.sha256(data).hexdigest()
    return {
        "version": 2,
        "elements": [
            {"id": "photo", "type": "image", "fileId": key, "version": 1, "versionNonce": 1}
        ],
        "files": {
            key: {
                "id": key,
                "mimeType": "image/png",
                "dataURL": "data:image/png;base64," + base64.b64encode(data).decode(),
                "created": 1,
            }
        },
    }


def mock_close(monkeypatch, body):
    original = httpx.AsyncClient
    monkeypatch.setattr(
        tokens.httpx,
        "AsyncClient",
        lambda **kw: original(
            transport=httpx.MockTransport(lambda req: httpx.Response(200, json=body)), **kw
        ),
    )


def test_close_preserves_files_and_legacy_board(settings, monkeypatch):
    body = document()
    mock_close(monkeypatch, body)
    assert asyncio.run(tokens.close_whiteboard_room(settings, SESSION_ID)) == body


def test_close_rejects_missing_or_corrupt_images(settings, monkeypatch):
    body = document()
    body["files"] = {}
    mock_close(monkeypatch, body)
    with pytest.raises(ValueError):
        asyncio.run(tokens.close_whiteboard_room(settings, SESSION_ID))


def test_end_saves_image_document_with_existing_upload_intent(client, settings, repo, rooms):
    body = document()
    rooms.board_elements = body
    headers = auth_header(settings, TEACHER_ID)
    client.post(f"/api/sessions/{SESSION_ID}/join", json={"mode": "board"}, headers=headers)
    result = client.post(f"/api/sessions/{SESSION_ID}/end", json={}, headers=headers)
    assert result.status_code == 200 and not result.json()["finalize_pending"]
    assert repo.board_files[f"{STUDENT_ID}/{SESSION_ID}.json"] == body
    assert repo.upload_intents == {}


def test_end_refuses_oversized_document_and_keeps_pending(client, settings, repo, rooms):
    rooms.board_elements = [
        {"id": "large", "version": 1, "versionNonce": 1, "text": "a" * (20 * 1024 * 1024)}
    ]
    headers = auth_header(settings, TEACHER_ID)
    client.post(f"/api/sessions/{SESSION_ID}/join", json={"mode": "board"}, headers=headers)
    result = client.post(f"/api/sessions/{SESSION_ID}/end", json={}, headers=headers)
    assert result.status_code == 200 and result.json()["finalize_pending"]
    assert repo.sessions[SESSION_ID].finalized_at is None
    assert repo.board_files == {}


def test_storage_adapter_serializes_image_document(settings, monkeypatch):
    from app.repo import SupabaseRepository

    captured = []
    body = document()
    original = httpx.AsyncClient

    def respond(request):
        captured.append(json.loads(request.content))
        return httpx.Response(200, json={})

    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(respond), **kw)
    )
    path = asyncio.run(
        SupabaseRepository(settings).save_board_snapshot(STUDENT_ID, SESSION_ID, body)
    )
    assert path == f"{STUDENT_ID}/{SESSION_ID}.json"
    assert captured == [body]

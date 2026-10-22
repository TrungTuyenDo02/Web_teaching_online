"""Bài tập, nộp ảnh, gỡ metadata, OCR Gemini (provider giả), chấm/trả bài. Không gọi Google thật."""

import asyncio
import base64
import json
import struct
import zlib
from datetime import UTC, datetime

import httpx
import pytest

from app.models import SubmissionStatus
from app.services import gemini, images
from tests.conftest import (
    FOREIGN_STUDENT_ID,
    OTHER_STUDENT_PROFILE_ID,
    OTHER_TEACHER_ID,
    STUDENT_ID,
    STUDENT_PROFILE_ID,
    TEACHER_ID,
    auth_header,
)

GPS = b"GPS-21.0285N-105.8542E"


def jpeg(*, exif: bool = True) -> bytes:
    def seg(marker: int, body: bytes) -> bytes:
        return bytes([0xFF, marker]) + struct.pack(">H", len(body) + 2) + body

    parts = [b"\xff\xd8", seg(0xE0, b"JFIF\x00\x01\x02")]
    if exif:
        parts += [seg(0xE1, b"Exif\x00\x00" + GPS), seg(0xFE, b"chup o nha Em A")]
    parts += [
        seg(0xDB, b"\x00" * 65),
        seg(0xDA, b"\x00" * 10) + b"\x12\x34\xff\x00\x56",
        b"\xff\xd9",
    ]
    return b"".join(parts)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def png() -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + png_chunk(b"eXIf", GPS)
        + png_chunk(b"tEXt", b"Author\x00Em A")
        + png_chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00"))
        + png_chunk(b"IEND", b"")
    )


def webp() -> bytes:
    def chunk(fourcc: bytes, data: bytes) -> bytes:
        return fourcc + struct.pack("<I", len(data)) + data + (b"\x00" if len(data) & 1 else b"")

    body = chunk(b"VP8X", bytes([0x08 | 0x04]) + b"\x00" * 9) + chunk(b"VP8 ", b"\x00" * 11)
    body += chunk(b"EXIF", GPS) + chunk(b"XMP ", b"<x>Em A</x>")
    return b"RIFF" + struct.pack("<I", len(body) + 4) + b"WEBP" + body


# ---------- Gỡ metadata ----------


@pytest.mark.parametrize("make", [jpeg, png, webp])
def test_clean_strips_gps_and_names_keeps_image(make):
    cleaned, _ = images.clean(make(), 1024 * 1024)
    assert GPS not in cleaned and b"Em A" not in cleaned
    assert images.clean(cleaned, 1024 * 1024)[0] == cleaned  # gỡ lại lần nữa không đổi gì


def test_clean_keeps_jpeg_scan_and_clears_webp_flags():
    cleaned, mime = images.clean(jpeg(), 1024 * 1024)
    assert mime == "image/jpeg" and cleaned.endswith(b"\x12\x34\xff\x00\x56\xff\xd9")
    assert cleaned == images.clean(jpeg(exif=False), 1024 * 1024)[0]
    out, _ = images.clean(webp(), 1024 * 1024)
    assert out[20] & 0x0C == 0  # VP8X không còn báo có EXIF/XMP
    assert struct.unpack("<I", out[4:8])[0] == len(out) - 8


@pytest.mark.parametrize(
    "data",
    [b"%PDF-1.7 ...", b"<html><script>", b"", jpeg()[:30], png()[:-4] + b"XXXX"],
)
def test_clean_rejects_non_images_and_broken_files(data):
    with pytest.raises(images.InvalidImage):
        images.clean(data, 1024 * 1024)


def test_clean_rejects_oversize():
    with pytest.raises(images.InvalidImage, match="quá lớn"):
        images.clean(jpeg(), 50)


# ---------- Gateway Gemini ----------


def mock_gemini(monkeypatch, response):
    requests = []

    def handle(request):
        requests.append(request)
        return (
            response if isinstance(response, httpx.Response) else httpx.Response(200, json=response)
        )

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: original(transport=httpx.MockTransport(handle), **kw)
    )
    return requests


def ok_response(text="--- Ảnh 1 ---\n$x+1=2$"):
    return {"candidates": [{"finishReason": "STOP", "content": {"parts": [{"text": text}]}}]}


def test_gateway_sends_key_in_header_and_images_inline(settings, monkeypatch):
    settings.gemini_api_key, settings.gemini_ocr_model = "g-key", "gemini-3.7-flash"
    requests = mock_gemini(monkeypatch, ok_response())
    text = asyncio.run(gemini.transcribe(settings, [(b"img", "image/png")]))
    assert text.startswith("--- Ảnh 1 ---")
    request = requests[0]
    assert "g-key" not in str(request.url) and request.headers["x-goog-api-key"] == "g-key"
    assert str(request.url).endswith("/models/gemini-3.7-flash:generateContent")
    payload = json.loads(request.content)
    assert payload["generationConfig"]["temperature"] == 0
    inline = payload["contents"][0]["parts"][1]["inlineData"]
    assert inline == {"mimeType": "image/png", "data": base64.b64encode(b"img").decode()}


def test_gateway_keeps_thinking_low_and_drops_thought_parts(settings, monkeypatch):
    # Gọi thật 2026-10-21: mặc định model nghĩ ~3300 token, >30 s cho một ảnh
    settings.gemini_api_key, settings.gemini_ocr_model = "k", "m"
    parts = [{"text": "nháp suy nghĩ", "thought": True}, {"text": "$x=1$"}]
    requests = mock_gemini(
        monkeypatch, {"candidates": [{"finishReason": "STOP", "content": {"parts": parts}}]}
    )
    assert asyncio.run(gemini.transcribe(settings, [(b"img", "image/png")])) == "$x=1$"
    config = json.loads(requests[0].content)["generationConfig"]
    assert config["thinkingConfig"] == {"thinkingLevel": "low"}


@pytest.mark.parametrize(
    "response",
    [
        {"candidates": [{"finishReason": "SAFETY", "content": {"parts": [{"text": "x"}]}}]},
        {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": "x"}]}}]},
        ok_response("   "),
        {"promptFeedback": {"blockReason": "SAFETY"}},
        httpx.Response(429, json={"error": {"message": "quota SECRET"}}),
    ],
)
def test_gateway_fails_closed(settings, monkeypatch, response):
    settings.gemini_api_key, settings.gemini_ocr_model = "k", "m"
    mock_gemini(monkeypatch, response)
    with pytest.raises(gemini.OCRUnavailable):
        asyncio.run(gemini.transcribe(settings, [(b"img", "image/png")]))


# ---------- API ----------


@pytest.fixture
def teacher(settings):
    return auth_header(settings, TEACHER_ID)


@pytest.fixture
def student(settings):
    return auth_header(settings, STUDENT_PROFILE_ID)


@pytest.fixture
def ocr(settings, repo, monkeypatch):
    settings.ocr_enabled, settings.gemini_api_key, settings.gemini_ocr_model = True, "k", "m"
    repo.students[STUDENT_ID] = repo.students[STUDENT_ID].model_copy(
        update={"consent_at": datetime(2026, 9, 1, tzinfo=UTC)}
    )
    sent = []

    async def transcribe(_settings, batch):
        sent.append(batch)
        return "--- Ảnh 1 ---\n$2x = 4$"

    monkeypatch.setattr(gemini, "transcribe", transcribe)
    return sent


def assign(client, teacher, student_id=STUDENT_ID):
    return client.post(
        "/api/assignments",
        json={
            "student_id": student_id,
            "title": "Bài 3 trang 12",
            "description": "Giải phương trình",
        },
        headers=teacher,
    )


def submit(client, headers, assignment_id, data=None):
    return client.post(
        f"/api/assignments/{assignment_id}/submissions",
        content=jpeg() if data is None else data,
        headers=headers | {"Content-Type": "text/plain"},  # loại ảnh theo chữ ký, không theo header
    )


def test_teacher_assigns_only_own_active_students(client, settings, repo, teacher, student):
    assert assign(client, teacher).status_code == 201
    assert assign(client, teacher, FOREIGN_STUDENT_ID).status_code == 404
    assert assign(client, auth_header(settings, OTHER_TEACHER_ID)).status_code == 404
    assert assign(client, student).status_code == 403
    repo.students[STUDENT_ID] = repo.students[STUDENT_ID].model_copy(update={"active": False})
    assert assign(client, teacher).status_code == 404


def test_student_submits_image_stored_without_metadata(client, settings, repo, teacher, student):
    assignment = assign(client, teacher).json()
    response = submit(client, student, assignment["id"])
    assert response.status_code == 201, response.text
    [row] = repo.submission_rows
    assert row.mime_type == "image/jpeg" and row.storage_path.startswith(f"{STUDENT_ID}/")
    stored = repo.submission_files[row.storage_path]
    assert GPS not in stored and b"Em A" not in stored
    assert repo.assignments[assignment["id"]].status == "submitted"
    # Học sinh khác, giáo viên, bài không tồn tại: cùng 404
    assert (
        submit(
            client, auth_header(settings, OTHER_STUDENT_PROFILE_ID), assignment["id"]
        ).status_code
        == 404
    )
    assert submit(client, teacher, assignment["id"]).status_code == 404
    assert submit(client, student, "00000000-0000-0000-0000-000000000000").status_code == 404


def test_upload_limits_type_size_and_count(client, settings, repo, teacher, student):
    settings.submission_max_bytes, settings.submission_max_files = 400, 2
    assignment = assign(client, teacher).json()
    assert submit(client, student, assignment["id"], b"%PDF-1.7").status_code == 422
    assert (
        submit(client, student, assignment["id"], b"\xff\xd8\xff" + b"\x00" * 500).status_code
        == 413
    )
    sub = submit(client, student, assignment["id"]).json()
    url = f"/api/submissions/{sub['id']}/files"
    assert client.post(url, content=png(), headers=student).status_code == 201
    assert client.post(url, content=png(), headers=student).status_code == 409
    assert client.post(url, content=png(), headers=teacher).status_code == 404
    assert len(repo.submission_rows) == 2


def test_ocr_needs_config_and_guardian_consent_before_sending(
    client, settings, repo, teacher, student, monkeypatch
):
    async def fail(*_a, **_k):
        raise AssertionError("không được gửi ảnh cho Gemini")

    monkeypatch.setattr(gemini, "transcribe", fail)
    sub = submit(client, student, assign(client, teacher).json()["id"]).json()
    url = f"/api/submissions/{sub['id']}/ocr"
    assert client.post(url, headers=teacher).status_code == 503
    settings.ocr_enabled, settings.gemini_api_key, settings.gemini_ocr_model = True, "k", "m"
    response = client.post(url, headers=teacher)
    assert response.status_code == 409 and "phụ huynh đồng ý" in response.json()["detail"]
    assert repo.transcripts == []


def test_ocr_sends_clean_images_saves_transcript_teacher_only(
    client, settings, repo, teacher, student, ocr
):
    sub = submit(client, student, assign(client, teacher).json()["id"]).json()
    url = f"/api/submissions/{sub['id']}/ocr"
    assert client.post(url, headers=student).status_code == 404
    assert client.post(url, headers=auth_header(settings, OTHER_TEACHER_ID)).status_code == 404
    response = client.post(url, headers=teacher)
    assert response.status_code == 200, response.text
    assert response.json()["content"].endswith("$2x = 4$")
    [[(data, mime)]] = ocr
    assert mime == "image/jpeg" and GPS not in data
    assert repo.transcripts[0].model == "m"
    assert repo.submissions[sub["id"]].status == SubmissionStatus.reviewing
    # Đã bắt đầu chấm: học sinh không thêm ảnh nữa
    more = client.post(f"/api/submissions/{sub['id']}/files", content=png(), headers=student)
    assert more.status_code == 409


def test_ocr_quota_and_provider_failure(client, settings, repo, teacher, student, ocr, monkeypatch):
    settings.assistant_daily_user_turns = 1
    sub = submit(client, student, assign(client, teacher).json()["id"]).json()
    url = f"/api/submissions/{sub['id']}/ocr"

    async def broken(*_a):
        raise gemini.OCRUnavailable

    monkeypatch.setattr(gemini, "transcribe", broken)
    assert client.post(url, headers=teacher).status_code == 502
    assert repo.transcripts == []
    assert client.post(url, headers=teacher).status_code == 429  # lượt đã giữ vẫn bị tính


def test_return_with_score_then_no_more_submissions(client, settings, repo, teacher, student):
    assignment = assign(client, teacher).json()
    sub = submit(client, student, assignment["id"]).json()
    url = f"/api/submissions/{sub['id']}/return"
    assert (
        client.post(url, json={"teacher_comment": "Tốt", "score": 11}, headers=teacher).status_code
        == 422
    )
    assert (
        client.post(url, json={"teacher_comment": "Tốt", "score": 9}, headers=student).status_code
        == 404
    )
    response = client.post(url, json={"teacher_comment": "Tốt", "score": 9}, headers=teacher)
    assert response.status_code == 200
    assert response.json()["status"] == "returned" and response.json()["score"] == 9
    assert repo.assignments[assignment["id"]].status == "returned"
    assert submit(client, student, assignment["id"]).status_code == 409


def test_student_being_deleted_cannot_submit_and_upload_is_cleaned(
    client, settings, repo, teacher, student, monkeypatch
):
    assignment = assign(client, teacher).json()
    original = repo.insert_submission_file

    async def deleted_during_upload(fields):
        row = await original(fields)
        repo.students[STUDENT_ID] = repo.students[STUDENT_ID].model_copy(
            update={"deleting_at": datetime(2026, 10, 21, tzinfo=UTC)}
        )
        return row

    monkeypatch.setattr(repo, "insert_submission_file", deleted_during_upload)
    assert submit(client, student, assignment["id"]).status_code == 404
    assert repo.submission_files == {}  # ảnh vừa ghi đã được dọn
    assert submit(client, student, assignment["id"]).status_code == 404


# ---------- Chữa bài trên ảnh ----------


def annotate(client, headers, submission_id, data=None):
    return client.post(
        f"/api/submissions/{submission_id}/annotations",
        content=png() if data is None else data,
        headers=headers,
    )


def test_teacher_annotates_image_stored_clean_and_locks_submission(
    client, settings, repo, teacher, student, ocr
):
    settings.submission_max_files = 2
    sub = submit(client, student, assign(client, teacher).json()["id"]).json()
    assert annotate(client, student, sub["id"]).status_code == 404
    assert annotate(client, auth_header(settings, OTHER_TEACHER_ID), sub["id"]).status_code == 404
    assert annotate(client, teacher, sub["id"], b"%PDF-1.7").status_code == 422
    response = annotate(client, teacher, sub["id"])
    assert response.status_code == 201, response.text
    row = response.json()
    assert row["kind"] == "annotated"
    assert row["storage_path"].startswith(f"{STUDENT_ID}/{sub['id']}/")
    stored = repo.submission_files[row["storage_path"]]
    assert GPS not in stored and b"Em A" not in stored
    # Thầy cô đã bắt đầu chữa: học sinh không thêm ảnh vào lượt nộp này nữa
    assert repo.submissions[sub["id"]].status == SubmissionStatus.reviewing
    more = client.post(f"/api/submissions/{sub['id']}/files", content=png(), headers=student)
    assert more.status_code == 409
    # Giới hạn đếm riêng ảnh chữa; AI chỉ đọc ảnh gốc của học sinh
    assert annotate(client, teacher, sub["id"]).status_code == 201
    assert annotate(client, teacher, sub["id"]).status_code == 409
    assert client.post(f"/api/submissions/{sub['id']}/ocr", headers=teacher).status_code == 200
    [batch] = ocr
    assert len(batch) == 1 and batch[0][1] == "image/jpeg"


def test_teacher_deletes_only_annotated_files(client, settings, repo, teacher, student):
    sub = submit(client, student, assign(client, teacher).json()["id"]).json()
    other = submit(client, student, assign(client, teacher).json()["id"]).json()
    original = next(f for f in repo.submission_rows if f.submission_id == sub["id"])
    marked = annotate(client, teacher, sub["id"]).json()
    url = f"/api/submissions/{sub['id']}/files"
    assert client.delete(f"{url}/{original.id}", headers=teacher).status_code == 409
    assert client.delete(f"{url}/{marked['id']}", headers=student).status_code == 404
    other_url = f"/api/submissions/{other['id']}/files/{marked['id']}"
    assert client.delete(other_url, headers=teacher).status_code == 404
    assert client.delete(f"{url}/{marked['id']}", headers=teacher).status_code == 204
    assert marked["storage_path"] not in repo.submission_files
    assert [f.kind for f in repo.submission_rows] == ["original", "original"]
    assert client.delete(f"{url}/{marked['id']}", headers=teacher).status_code == 404


def test_teacher_asks_redo_student_submits_again(client, settings, repo, teacher, student):
    assignment = assign(client, teacher).json()
    first = submit(client, student, assignment["id"]).json()
    url = f"/api/submissions/{first['id']}/return"
    body = {"teacher_comment": "Câu 2 sai dấu, làm lại nhé", "score": None, "redo": True}
    assert client.post(url, json=body, headers=student).status_code == 404
    response = client.post(url, json=body, headers=teacher)
    assert response.status_code == 200, response.text
    # Lượt nộp cũ đã trả (học sinh đọc nhận xét); bài tập mở lại để nộp lượt mới
    assert response.json()["status"] == "returned"
    assert repo.assignments[assignment["id"]].status == "assigned"
    second = submit(client, student, assignment["id"])
    assert second.status_code == 201
    assert repo.assignments[assignment["id"]].status == "submitted"
    assert repo.submissions[first["id"]].teacher_comment == "Câu 2 sai dấu, làm lại nhé"
    # Trả bài bình thường thì đóng hẳn
    done = f"/api/submissions/{second.json()['id']}/return"
    assert (
        client.post(done, json={"teacher_comment": "Đúng rồi"}, headers=teacher).status_code == 200
    )
    assert repo.assignments[assignment["id"]].status == "returned"
    assert submit(client, student, assignment["id"]).status_code == 409

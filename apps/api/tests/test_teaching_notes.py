"""Ghi chú sau buổi là dữ liệu riêng, không dùng summary/homework công khai."""

import asyncio
import functools
from datetime import UTC, datetime

import httpx
import pytest

from app.models import SessionStatus, TeachingNoteRequest
from app.repo import SupabaseRepository
from tests.conftest import (
    OTHER_TEACHER_ID,
    SESSION_ID,
    STUDENT_ID,
    STUDENT_PROFILE_ID,
    TEACHER_ID,
    auth_header,
)

PATH = f"/api/sessions/{SESSION_ID}/teaching-note"


@pytest.fixture
def teacher(settings, repo):
    repo.sessions[SESSION_ID].status = SessionStatus.completed
    repo.sessions[SESSION_ID].scheduled_start = datetime(2026, 10, 1, tzinfo=UTC)
    return auth_header(settings, TEACHER_ID)


def topic(client, headers, name="Phương trình", grade="9"):
    response = client.post("/api/topics", headers=headers, json={"name": name, "grade": grade})
    assert response.status_code == 200
    return response.json()["id"]


def test_teacher_reads_empty_then_saves_and_edits_private_record(client, repo, teacher):
    original = repo.sessions[SESSION_ID].model_dump()
    empty = client.get(PATH, headers=teacher)
    assert empty.status_code == 200 and empty.json()["revision"] == 0
    tid = topic(client, teacher)
    response = client.put(
        PATH,
        headers=teacher,
        json={
            "expected_revision": 0,
            "summary_md": "Chưa tự tin",
            "understanding_level": "Cần hỗ trợ",
            "improve_points": "Luyện đổi dấu",
            "homework_text": "Ghi riêng",
            "topic_ids": [tid, tid],
        },
    )
    assert response.status_code == 200
    assert response.json()["revision"] == 1 and response.json()["topic_ids"] == [tid]
    assert client.get(PATH, headers=teacher).json()["summary_md"] == "Chưa tự tin"
    assert repo.sessions[SESSION_ID].model_dump() == original
    edited = client.put(PATH, headers=teacher, json={"expected_revision": 1})
    assert edited.status_code == 200 and edited.json()["revision"] == 2
    assert edited.json()["summary_md"] == "" and edited.json()["topic_ids"] == []


@pytest.mark.parametrize("person", [STUDENT_PROFILE_ID, OTHER_TEACHER_ID])
def test_private_record_is_404_for_student_and_other_teacher(client, settings, teacher, person):
    client.put(PATH, headers=teacher, json={"expected_revision": 0, "summary_md": "riêng"})
    denied = auth_header(settings, person)
    for response in [
        client.get(PATH, headers=denied),
        client.put(PATH, headers=denied, json={"expected_revision": 0}),
    ]:
        assert response.status_code == 404 and "riêng" not in response.text


@pytest.mark.parametrize(
    "state",
    [SessionStatus.scheduled, SessionStatus.live, SessionStatus.cancelled, SessionStatus.no_show],
)
def test_only_completed_sessions_have_post_lesson_notes(client, repo, teacher, state):
    repo.sessions[SESSION_ID].status = state
    assert client.put(PATH, headers=teacher, json={"expected_revision": 0}).status_code == 409


def test_stale_revision_does_not_replace_note_or_topics(client, teacher):
    tid = topic(client, teacher)
    assert (
        client.put(
            PATH,
            headers=teacher,
            json={"expected_revision": 0, "summary_md": "Mới", "topic_ids": [tid]},
        ).status_code
        == 200
    )
    stale = client.put(PATH, headers=teacher, json={"expected_revision": 0, "summary_md": "Cũ"})
    assert stale.status_code == 409 and "tải lại" in stale.json()["detail"].lower()
    saved = client.get(PATH, headers=teacher).json()
    assert saved["summary_md"] == "Mới" and saved["topic_ids"] == [tid]


def test_foreign_or_unknown_topic_rejects_whole_save(client, teacher, settings):
    foreign = topic(client, auth_header(settings, OTHER_TEACHER_ID))
    for tid in [foreign, "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"]:
        response = client.put(
            PATH,
            headers=teacher,
            json={"expected_revision": 0, "summary_md": "không lưu", "topic_ids": [tid]},
        )
        assert response.status_code == 422
        assert client.get(PATH, headers=teacher).json()["revision"] == 0


def test_topic_catalog_owned_and_duplicate_creation_idempotent(client, settings, teacher):
    tid = topic(client, teacher, "  Số hữu tỉ  ")
    assert topic(client, teacher, "Số hữu tỉ") == tid
    assert client.get("/api/topics", headers=teacher).json() == [
        {"id": tid, "name": "Số hữu tỉ", "grade": "9"}
    ]
    assert client.get("/api/topics", headers=auth_header(settings, OTHER_TEACHER_ID)).json() == []
    student = auth_header(settings, STUDENT_PROFILE_ID)
    assert client.get("/api/topics", headers=student).status_code == 403
    assert client.post("/api/topics", headers=student, json={"name": "hack"}).status_code == 403


def test_deleting_student_cannot_read_save_or_export(client, repo, teacher):
    repo.students[STUDENT_ID].deleting_at = datetime(2026, 10, 20, tzinfo=UTC)
    assert client.get(PATH, headers=teacher).status_code == 404
    assert client.put(PATH, headers=teacher, json={"expected_revision": 0}).status_code == 404
    assert (
        client.get(
            f"/api/students/{STUDENT_ID}/teaching-notes?month=2026-10", headers=teacher
        ).status_code
        == 404
    )


def test_export_records_respect_month_and_student_and_no_public_notes(client, repo, teacher):
    client.put(PATH, headers=teacher, json={"expected_revision": 0, "summary_md": "riêng"})
    url = f"/api/students/{STUDENT_ID}/teaching-notes"
    rows = client.get(url + "?month=2026-10", headers=teacher)
    assert rows.status_code == 200 and len(rows.json()) == 1
    assert rows.json()[0]["summary_md"] == "riêng"
    assert client.get(url + "?month=2026-11", headers=teacher).json() == []
    assert client.get(url + "?month=0001-01", headers=teacher).status_code == 422
    assert "guardian" not in rows.text


def test_note_validation_forbids_owner_injection_and_overlong_text(client, teacher):
    for body in [
        {"teacher_id": OTHER_TEACHER_ID},
        {"summary_md": "x" * 5001},
        {"topic_ids": ["bad"]},
    ]:
        assert (
            client.put(PATH, headers=teacher, json={"expected_revision": 0, **body}).status_code
            == 422
        )


def test_deleting_session_cascades_private_note_and_topic_links_in_fake(client, repo, teacher):
    client.put(
        PATH,
        headers=teacher,
        json={"expected_revision": 0, "summary_md": "x", "topic_ids": [topic(client, teacher)]},
    )
    asyncio.run(repo.delete_student_sessions(STUDENT_ID))
    assert SESSION_ID not in repo.teaching_records
    assert client.get(PATH, headers=teacher).status_code == 404


def test_delete_starts_after_router_read_but_rpc_rechecks(client, repo, teacher):
    def deletion_starts():
        repo.students[STUDENT_ID].deleting_at = datetime(2026, 10, 20, tzinfo=UTC)

    repo.before_save_teaching_record = deletion_starts
    response = client.put(
        PATH, headers=teacher, json={"expected_revision": 0, "summary_md": "Không được lưu"}
    )
    assert response.status_code == 404 and SESSION_ID not in repo.teaching_records


def test_export_denies_other_teacher_and_student(client, settings, teacher):
    url = f"/api/students/{STUDENT_ID}/teaching-notes?month=2026-10"
    assert client.get(url, headers=auth_header(settings, OTHER_TEACHER_ID)).status_code == 404
    assert client.get(url, headers=auth_header(settings, STUDENT_PROFILE_ID)).status_code == 403


def test_real_repository_filters_paginates_and_decodes_postgrest_join(monkeypatch, settings):
    original = httpx.AsyncClient
    offsets = []
    start, end = datetime(2026, 9, 30, 17, tzinfo=UTC), datetime(2026, 10, 31, 17, tzinfo=UTC)

    def handler(request):
        query = request.url.params
        assert query["teacher_id"] == f"eq.{TEACHER_ID}"
        assert query["student_id"] == f"eq.{STUDENT_ID}"
        assert query["students.teacher_id"] == f"eq.{TEACHER_ID}"
        assert query["students.deleting_at"] == "is.null" and query["status"] == "eq.completed"
        assert (
            query["and"]
            == f"(scheduled_start.gte.{start.isoformat()},scheduled_start.lt.{end.isoformat()})"
        )
        offset = int(query["offset"])
        offsets.append(offset)
        note = {"revision": 1, "summary_md": "riêng"}
        return httpx.Response(
            200,
            json=[
                {
                    "id": f"session-{offset}",
                    "scheduled_start": start.isoformat(),
                    "session_notes": note if offset == 0 else [note],
                    "session_topics": [{"topic_id": "t1"}],
                }
            ]
            if offset < 2
            else [],
        )

    monkeypatch.setattr(
        "app.repo.httpx.AsyncClient",
        functools.partial(original, transport=httpx.MockTransport(handler)),
    )
    records = asyncio.run(
        SupabaseRepository(settings).list_teaching_records(TEACHER_ID, STUDENT_ID, start, end)
    )
    assert offsets == [0, 1, 2] and len(records) == 2
    assert all(r.summary_md == "riêng" and r.topic_ids == ["t1"] for r in records)


def test_real_repository_save_uses_single_rpc_with_trusted_owner(monkeypatch, settings):
    original = httpx.AsyncClient
    calls = []

    def handler(request):
        import json

        calls.append(request.url.path)
        params = json.loads(request.content)
        assert params["p_teacher_id"] == TEACHER_ID and params["p_session_id"] == SESSION_ID
        assert params["p_expected_revision"] == 0 and params["p_topic_ids"] == []
        return httpx.Response(200, json={"status": "conflict"})

    monkeypatch.setattr(
        "app.repo.httpx.AsyncClient",
        functools.partial(original, transport=httpx.MockTransport(handler)),
    )
    result = asyncio.run(
        SupabaseRepository(settings).save_teaching_record(
            TEACHER_ID, SESSION_ID, TeachingNoteRequest(expected_revision=0)
        )
    )
    assert result == ("conflict", None) and calls == ["/rest/v1/rpc/save_teaching_record"]

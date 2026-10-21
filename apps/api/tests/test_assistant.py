"""Kiểm orchestration/quyền/giới hạn bằng provider giả; không đo chất lượng model thật."""

import asyncio
import json

import httpx
import pytest

from app.assistant_models import MaterialInput
from app.models import SessionStatus, TeachingRecord
from app.services import llm
from tests.conftest import (
    OTHER_TEACHER_ID,
    SESSION_ID,
    STUDENT_ID,
    STUDENT_PROFILE_ID,
    TEACHER_ID,
    auth_header,
)


@pytest.fixture
def ai(settings, monkeypatch):
    settings.assistant_enabled = True
    settings.openai_api_key = "test-key-never-sent"
    settings.openai_chat_model = "test-model"
    calls = []

    async def respond(_settings, *, instructions, messages, tools=None):
        calls.append({"instructions": instructions, "messages": list(messages), "tools": tools})
        if tools:
            return {
                "output": [
                    {
                        "type": "function_call",
                        "name": "search_knowledge",
                        "arguments": json.dumps({"query": "bảng tablet"}),
                        "call_id": "one",
                    }
                ]
            }
        return {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "Dùng tablet cho bảng viết [1]."}],
                }
            ]
        }

    monkeypatch.setattr(llm, "respond", respond)
    return calls


def ask(client, settings, actor=TEACHER_ID, **extra):
    return client.post(
        "/api/assistant/chat",
        headers=auth_header(settings, actor),
        json={"question": "Cách dùng bảng?", "consent": True, **extra},
    )


def test_disabled_and_consent_never_call_provider(client, settings, monkeypatch):
    async def fail(*args, **kwargs):
        pytest.fail("Không được gọi provider")

    monkeypatch.setattr(llm, "respond", fail)
    assert ask(client, settings).status_code == 503
    settings.assistant_enabled = True
    settings.openai_api_key = "dummy"
    settings.openai_chat_model = "dummy"
    assert ask(client, settings, consent=False).status_code == 422
    assert ask(client, settings, role="teacher").status_code == 422
    assert ask(client, settings, question=" " * 20).status_code == 422


def test_agent_searches_then_answers_with_sources_no_pii(client, settings, ai):
    result = ask(client, settings)
    assert result.status_code == 200
    assert result.json()["sources"][0]["kind"] == "guide"
    assert len(ai) == 2
    assert ai[0]["tools"][0]["name"] == "search_knowledge"
    assert ai[1]["messages"][-1]["type"] == "function_call_output"
    assert TEACHER_ID not in json.dumps(ai)
    assert "Cô Thử" not in json.dumps(ai, ensure_ascii=False)


def test_student_role_and_no_teacher_sources(client, settings, ai):
    result = ask(client, settings, STUDENT_PROFILE_ID)
    assert result.status_code == 200
    assert all(
        s["path"] not in {"/reports", "/students", "/teaching-notes"}
        for s in result.json()["sources"]
    )
    assert "student" in ai[0]["instructions"]
    assert "teacher" in ai[0]["instructions"]  # Chỉ nhắc giới hạn, không chuyển principal.


def test_quota_is_shared_across_requests_and_respects_global_limit(client, settings, ai):
    settings.assistant_daily_user_turns = 1
    settings.assistant_daily_total_turns = 2
    assert ask(client, settings).status_code == 200
    assert ask(client, settings).status_code == 429
    assert ask(client, settings, STUDENT_PROFILE_ID).status_code == 200
    assert ask(client, settings, OTHER_TEACHER_ID).status_code == 429
    assert len(ai) == 4


def test_unknown_tool_invalid_args_and_fake_citations_fail_closed(
    client, settings, monkeypatch, ai
):
    async def invalid(_settings, **kwargs):
        return {
            "output": [
                {
                    "type": "function_call",
                    "name": "delete_student",
                    "arguments": "{}",
                    "call_id": "x",
                }
            ]
        }

    monkeypatch.setattr(llm, "respond", invalid)
    assert ask(client, settings).status_code == 502

    async def bad_args(_settings, **kwargs):
        return {
            "output": [
                {
                    "type": "function_call",
                    "name": "search_knowledge",
                    "arguments": '{"query":"bảng", "actor_id":"other"}',
                    "call_id": "x",
                }
            ]
        }

    monkeypatch.setattr(llm, "respond", bad_args)
    assert ask(client, settings).status_code == 502


def test_provider_errors_do_not_echo_response_content(client, settings, ai, monkeypatch):
    async def fail(*args, **kwargs):
        raise llm.LLMUnavailable("SECRET_OR_STUDENT_TEXT")

    monkeypatch.setattr(llm, "respond", fail)
    result = ask(client, settings)
    assert result.status_code == 502 and "SECRET_OR_STUDENT_TEXT" not in result.text


def test_fabricated_citation_is_rejected(client, settings, ai, monkeypatch):
    async def respond(_settings, *, tools=None, **kwargs):
        if tools:
            return {
                "output": [
                    {
                        "type": "function_call",
                        "name": "search_knowledge",
                        "arguments": '{"query":"tablet"}',
                        "call_id": "x",
                    }
                ]
            }
        return {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "Invented source [99]"}],
                }
            ]
        }

    monkeypatch.setattr(llm, "respond", respond)
    assert ask(client, settings).status_code == 502


def test_student_rollout_does_not_even_query_lessons(client, settings, ai, repo, monkeypatch):
    async def fail(*args):
        pytest.fail("Bài giảng HS chưa được bật")

    monkeypatch.setattr(repo, "search_assistant_chunks", fail)
    assert ask(client, settings, STUDENT_PROFILE_ID).status_code == 200


def test_removed_material_during_generation_is_not_returned(
    client, settings, ai, repo, monkeypatch
):
    row, _ = add_material(repo)

    async def respond(_settings, *, tools=None, **kwargs):
        if tools:
            return {
                "output": [
                    {
                        "type": "function_call",
                        "name": "search_knowledge",
                        "arguments": '{"query":"phân"}',
                        "call_id": "x",
                    }
                ]
            }
        repo.assistant_materials.pop(row.id)
        return {
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "Một phần của đơn vị [1]."}],
                }
            ]
        }

    monkeypatch.setattr(llm, "respond", respond)
    assert ask(client, settings).status_code == 502


def test_gateway_timeouts_are_masked(settings, monkeypatch):
    def handle(request):
        raise httpx.ReadTimeout("provider response may contain private text")

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs),
    )
    with pytest.raises(llm.LLMUnavailable):
        asyncio.run(llm.respond(settings, instructions="system", messages=[]))


def test_student_answer_guard_blocks_solution_instead_of_leaking(
    client, settings, ai, repo, monkeypatch
):
    _, topic = add_material(repo)
    settings.assistant_student_lessons_enabled = True
    session = repo.sessions[SESSION_ID]
    session.status = SessionStatus.completed
    repo.teaching_records[SESSION_ID] = TeachingRecord(
        session_id=SESSION_ID, scheduled_start=session.scheduled_start, topic_ids=[topic.id]
    )
    call_count = 0

    async def respond(_settings, *, tools=None, **kwargs):
        nonlocal call_count
        call_count += 1
        if tools:
            return {
                "output": [
                    {
                        "type": "function_call",
                        "name": "search_knowledge",
                        "arguments": '{"query":"phân"}',
                        "call_id": "x",
                    }
                ]
            }
        text = "Đáp án là 3/4 [1]." if call_count == 2 else "BLOCK"
        return {"output": [{"type": "message", "content": [{"type": "output_text", "text": text}]}]}

    monkeypatch.setattr(llm, "respond", respond)
    result = ask(client, settings, STUDENT_PROFILE_ID)
    assert result.status_code == 200
    assert "3/4" not in result.text and result.json()["sources"] == []


def test_repository_sends_authenticated_actor_to_rpc(settings, monkeypatch):
    from app.repo import SupabaseRepository

    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json=[])

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs),
    )
    assert (
        asyncio.run(SupabaseRepository(settings).search_assistant_chunks(TEACHER_ID, "phân số"))
        == []
    )
    assert json.loads(requests[0].content) == {"p_actor": TEACHER_ID, "p_query": "phân số"}
    assert requests[0].url.path == "/rest/v1/rpc/search_assistant_chunks"


def add_material(repo, teacher=TEACHER_ID, visible=True):
    topic = asyncio.run(repo.create_teaching_topic(teacher, "Phân số", "7"))
    row = asyncio.run(
        repo.create_assistant_material(
            teacher,
            MaterialInput(
                topic_id=topic.id,
                title="Phân số",
                content="Phân số biểu diễn một phần của đơn vị. Tử số ở trên và mẫu số ở dưới.",
                student_visible=visible,
            ),
        )
    )
    return row, topic


def test_material_lifecycle_and_wrong_owner_or_student_cannot_write(client, settings, repo):
    row, topic = add_material(repo)
    auth = auth_header(settings, TEACHER_ID)
    assert client.get("/api/assistant/materials", headers=auth).json()[0]["id"] == row.id
    assert (
        client.get(
            f"/api/assistant/materials/{row.id}", headers=auth_header(settings, OTHER_TEACHER_ID)
        ).status_code
        == 404
    )
    assert (
        client.delete(
            f"/api/assistant/materials/{row.id}", headers=auth_header(settings, OTHER_TEACHER_ID)
        ).status_code
        == 404
    )
    payload = {
        "topic_id": topic.id,
        "title": "Tài liệu",
        "content": "Nội dung bài giảng đã được kiểm tra.",
    }
    assert (
        client.post(
            "/api/assistant/materials",
            headers=auth_header(settings, STUDENT_PROFILE_ID),
            json=payload,
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/assistant/materials",
            headers=auth_header(settings, OTHER_TEACHER_ID),
            json=payload,
        ).status_code
        == 404
    )
    assert client.delete(f"/api/assistant/materials/{row.id}", headers=auth).status_code == 204
    assert asyncio.run(repo.search_assistant_chunks(TEACHER_ID, "phân số")) == []


def test_student_only_published_taught_topic_and_rollout_gate(client, settings, repo):
    row, topic = add_material(repo)
    auth = auth_header(settings, STUDENT_PROFILE_ID)
    assert client.get(f"/api/assistant/materials/{row.id}", headers=auth).status_code == 404
    settings.assistant_student_lessons_enabled = True
    assert client.get(f"/api/assistant/materials/{row.id}", headers=auth).status_code == 404
    session = repo.sessions[SESSION_ID]
    session.status = SessionStatus.completed
    repo.teaching_records[SESSION_ID] = TeachingRecord(
        session_id=SESSION_ID, scheduled_start=session.scheduled_start, topic_ids=[topic.id]
    )
    assert client.get(f"/api/assistant/materials/{row.id}", headers=auth).status_code == 200
    row.student_visible = False
    assert client.get(f"/api/assistant/materials/{row.id}", headers=auth).status_code == 404
    row.student_visible = True
    from app.core import time as clock

    repo.students[STUDENT_ID].deleting_at = clock.now_utc()
    assert client.get(f"/api/assistant/materials/{row.id}", headers=auth).status_code == 404


def test_gateway_no_storage_no_retries_and_safe_error(settings, monkeypatch):
    requests = []

    def handle(request):
        requests.append(request)
        return httpx.Response(200, json={"status": "completed", "output": []})

    original = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original(transport=httpx.MockTransport(handle), **kwargs),
    )
    asyncio.run(
        llm.respond(settings, instructions="system", messages=[{"role": "user", "content": "hi"}])
    )
    payload = json.loads(requests[0].content)
    assert payload["store"] is False
    assert payload["max_output_tokens"] <= 2000
    assert str(requests[0].url) == "https://api.openai.com/v1/responses"

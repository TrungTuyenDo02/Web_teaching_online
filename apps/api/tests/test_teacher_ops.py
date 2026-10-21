"""Teacher-Ops chỉ đọc, provider giả: quyền, mã hóa tên, tool, giới hạn vòng (không đo model)."""

import json
from datetime import UTC, datetime, timedelta

import pytest

from app.models import SessionRow, SessionStatus
from app.services import llm, teacher_ops
from tests.conftest import STUDENT_ID, STUDENT_PROFILE_ID, TEACHER_ID, auth_header

REAL_NAMES = ["Em A", "Em B", "Em C", "Em D"]


@pytest.fixture
def ai(settings):
    settings.assistant_enabled = True
    settings.openai_api_key = "test-key-never-sent"
    settings.openai_chat_model = "test-model"


def script(monkeypatch, *steps):
    """Provider giả trả lần lượt các bước: dict tool call hoặc chuỗi câu trả lời."""
    calls: list[dict] = []
    queue = list(steps)

    async def respond(_settings, *, instructions, messages, tools=None, tool_choice="required"):
        calls.append({"instructions": instructions, "messages": json.loads(json.dumps(messages))})
        step = queue.pop(0) if queue else queue_end
        if isinstance(step, dict):
            return {
                "output": [
                    {
                        "type": "function_call",
                        "name": step["name"],
                        "arguments": json.dumps(step["args"]),
                        "call_id": f"c{len(calls)}",
                    }
                ]
            }
        return {"output": [{"type": "message", "content": [{"type": "output_text", "text": step}]}]}

    queue_end = {"name": "list_students", "args": {}}
    monkeypatch.setattr(llm, "respond", respond)
    return calls


def ask(client, settings, question, actor=TEACHER_ID, history=()):
    return client.post(
        "/api/assistant/teacher-ops",
        headers=auth_header(settings, actor),
        json={"question": question, "consent": True, "history": list(history)},
    )


def outputs(calls) -> list[dict]:
    return [
        json.loads(m["output"])
        for m in calls[-1]["messages"]
        if m.get("type") == "function_call_output"
    ]


def test_schedule_lookup_sends_codes_not_names_and_restores_names(
    client, settings, ai, repo, monkeypatch
):
    start = datetime.now(UTC) + timedelta(days=2)
    repo.sessions["future"] = SessionRow(
        id="future",
        teacher_id=TEACHER_ID,
        student_id=STUDENT_ID,
        room_name="room-future",
        subject="Toán",
        topic="Ôn tập cho Em A",
        status=SessionStatus.scheduled,
        scheduled_start=start,
        scheduled_end=start + timedelta(hours=1),
    )
    calls = script(
        monkeypatch,
        {"name": "list_upcoming", "args": {"days": 7, "student": "HS1"}},
        "HS1 có một buổi Toán trong tuần này.",
    )
    response = ask(
        client,
        settings,
        "Lịch của Em A tuần này?",
        history=[{"question": "Em B học mấy buổi?", "answer": "Em B học 2 buổi."}],
    )
    assert response.status_code == 200
    assert response.json()["answer"] == "Em A có một buổi Toán trong tuần này."
    sent = json.dumps(calls, ensure_ascii=False)
    assert not any(name in sent for name in REAL_NAMES)
    [result] = outputs(calls)
    assert [s["student"] for s in result["sessions"]] == ["HS1"]
    assert result["sessions"][0]["topic"] == "Ôn tập cho HS1"


def test_find_student_ignores_accents_and_only_searches_own_students(
    client, settings, ai, repo, monkeypatch
):
    repo.students[STUDENT_ID] = repo.students[STUDENT_ID].model_copy(
        update={"full_name": "Nguyễn Lan Anh", "grade": "8A"}
    )
    calls = script(
        monkeypatch,
        {"name": "find_student", "args": {"name": "lan anh"}},
        {"name": "find_student", "args": {"name": "Em D"}},
        "Tìm thấy HS3.",
    )
    assert ask(client, settings, "lan anh lớp nào").status_code == 200
    first, foreign = outputs(calls)
    assert first == {"matches": [{"student": "HS3", "grade": "8A", "active": True}]}
    assert foreign == {"matches": []}  # học sinh của giáo viên khác không lộ ra


def test_count_sessions_uses_report_rule_and_hides_other_teachers(
    client, settings, ai, repo, monkeypatch
):
    month = datetime.now(UTC).strftime("%Y-%m")
    repo.sessions["done"] = repo.sessions["cccccccc-cccc-cccc-cccc-cccccccccccc"].model_copy(
        update={"id": "done", "status": SessionStatus.completed}
    )
    calls = script(monkeypatch, {"name": "count_sessions", "args": {"month": month}}, "Xong.")
    assert ask(client, settings, "Tháng này dạy mấy buổi?").status_code == 200
    [result] = outputs(calls)
    assert {r["student"] for r in result["students"]} == {"HS1", "HS2", "HS3"}
    assert result["total"] >= 1


def test_unresolvable_date_returns_error_to_model_not_guess(client, settings, ai, monkeypatch):
    calls = script(
        monkeypatch, {"name": "resolve_date", "args": {"expression": "thứ Ba"}}, "Thứ Ba tuần nào?"
    )
    assert ask(client, settings, "Thứ Ba có lịch không?").status_code == 200
    [result] = outputs(calls)
    assert "error" in result


def test_student_and_disabled_never_reach_provider(client, settings, monkeypatch):
    async def fail(*_args, **_kwargs):
        raise AssertionError("không được gọi provider")

    monkeypatch.setattr(llm, "respond", fail)
    assert ask(client, settings, "Lịch?").status_code == 503
    settings.assistant_enabled = True
    settings.openai_api_key = "k"
    settings.openai_chat_model = "m"
    assert ask(client, settings, "Lịch?", actor=STUDENT_PROFILE_ID).status_code == 403


def test_unknown_tool_bad_args_and_endless_loop_fail_closed(client, settings, ai, monkeypatch):
    script(monkeypatch, {"name": "delete_session", "args": {}})
    assert ask(client, settings, "Xóa buổi").status_code == 502
    script(monkeypatch, {"name": "list_upcoming", "args": {"days": 7, "student": "Em A"}})
    assert ask(client, settings, "Lịch").status_code == 502
    calls = script(monkeypatch)  # luôn gọi tool, không bao giờ trả lời
    assert ask(client, settings, "Lặp").status_code == 502
    assert len(calls) == teacher_ops.MAX_ROUNDS + 1


def test_tool_schemas_are_strict_and_only_teacher_reads():
    for tool in teacher_ops.TOOLS.values():
        params = teacher_ops.spec(tool)["parameters"]
        assert params["additionalProperties"] is False
        assert params["required"] == list(params["properties"])
        assert "minLength" not in json.dumps(params) and "title" not in json.dumps(params)
    assert set(teacher_ops.TOOLS) == {
        "resolve_date",
        "find_student",
        "list_students",
        "list_upcoming",
        "count_sessions",
    }


def test_alias_mask_and_restore_edge_cases(repo):
    students = sorted(repo.students.values(), key=lambda s: s.full_name)[:2]
    students[0] = students[0].model_copy(update={"full_name": "An (8A)"})
    aliases = teacher_ops.Aliases(students)
    assert aliases.mask("gặp an (8a) và Em B") == "gặp HS1 và HS2"
    assert aliases.restore("HS1, HS2, HS99, XHS1") == "An (8A), Em B, HS99, XHS1"

from tests.conftest import (
    FOREIGN_STUDENT_ID,
    NO_ACCOUNT_STUDENT_ID,
    SESSION_ID,
    STUDENT_ID,
    STUDENT_PROFILE_ID,
    TEACHER_ID,
    auth_header,
)

BODY = {"email": "em.c@example.com", "password": "matkhau-tam-1"}


def create(client, settings, student_id, user_id=TEACHER_ID, body=BODY):
    return client.post(
        f"/api/students/{student_id}/account", json=body, headers=auth_header(settings, user_id)
    )


def test_teacher_creates_account_and_links_it(client, settings, repo):
    resp = create(client, settings, NO_ACCOUNT_STUDENT_ID)
    assert resp.status_code == 201
    profile_id = resp.json()["profile_id"]
    assert repo.students[NO_ACCOUNT_STUDENT_ID].profile_id == profile_id
    assert repo.profiles[profile_id].role == "student"
    assert "password" not in resp.json()


def test_student_cannot_create_accounts(client, settings):
    assert create(client, settings, NO_ACCOUNT_STUDENT_ID, STUDENT_PROFILE_ID).status_code == 403


def test_other_teachers_student_is_not_found(client, settings, repo):
    assert create(client, settings, FOREIGN_STUDENT_ID).status_code == 404
    assert repo.auth_users == {}


def test_student_with_account_is_rejected(client, settings, repo):
    assert create(client, settings, STUDENT_ID).status_code == 409
    assert repo.auth_users == {}


def test_inactive_student_is_rejected(client, settings, repo):
    repo.students[NO_ACCOUNT_STUDENT_ID] = repo.students[NO_ACCOUNT_STUDENT_ID].model_copy(
        update={"active": False}
    )
    assert create(client, settings, NO_ACCOUNT_STUDENT_ID).status_code == 409


def test_email_already_used(client, settings, repo):
    repo.auth_users[BODY["email"]] = "x"
    resp = create(client, settings, NO_ACCOUNT_STUDENT_ID)
    assert resp.status_code == 409
    assert "Email" in resp.json()["detail"]


def test_short_password_rejected(client, settings):
    body = BODY | {"password": "123"}
    assert create(client, settings, NO_ACCOUNT_STUDENT_ID, body=body).status_code == 422


def test_failed_link_removes_created_account(client, settings, repo):
    repo.fail_link = True
    assert create(client, settings, NO_ACCOUNT_STUDENT_ID).status_code == 409
    assert repo.auth_users == {}  # không để lại tài khoản mồ côi


def test_invalid_student_id_is_422(client, settings):
    assert create(client, settings, "not-a-uuid").status_code == 422


# ---------- Quản lý hồ sơ học sinh: chỉ giáo viên, chỉ học sinh của mình ----------


def call(client, settings, method, path, user_id=TEACHER_ID, **kw):
    return client.request(method, path, headers=auth_header(settings, user_id), **kw)


def test_teacher_lists_only_own_students_with_private_fields(client, settings, repo):
    repo.students[STUDENT_ID] = repo.students[STUDENT_ID].model_copy(update={"notes": "Hay quên"})
    resp = call(client, settings, "GET", "/api/students")
    assert resp.status_code == 200
    ids = {s["id"] for s in resp.json()}
    assert FOREIGN_STUDENT_ID not in ids and STUDENT_ID in ids
    assert next(s for s in resp.json() if s["id"] == STUDENT_ID)["notes"] == "Hay quên"


def test_student_cannot_list_or_create_or_change(client, settings):
    sid = STUDENT_PROFILE_ID
    assert call(client, settings, "GET", "/api/students", sid).status_code == 403
    new = {"full_name": "Em X"}
    assert call(client, settings, "POST", "/api/students", sid, json=new).status_code == 403
    path = f"/api/students/{STUDENT_ID}"
    patch = {"notes": "x"}
    assert call(client, settings, "PATCH", path, sid, json=patch).status_code == 403
    assert call(client, settings, "DELETE", path, sid).status_code == 403


def test_create_student_trims_and_records_consent_time(client, settings, repo):
    body = {"full_name": "  Em Mới ", "grade": "", "consent": True}
    resp = call(client, settings, "POST", "/api/students", json=body)
    assert resp.status_code == 201
    created = repo.students[resp.json()["id"]]
    assert created.full_name == "Em Mới"
    assert created.teacher_id == TEACHER_ID  # không lấy từ người gọi gửi lên
    assert created.grade is None
    assert created.consent_at is not None and created.active


def test_create_student_requires_name(client, settings):
    resp = call(client, settings, "POST", "/api/students", json={"full_name": "   "})
    assert resp.status_code == 422


def test_create_ignores_teacher_id_in_body(client, settings, repo):
    body = {"full_name": "Em Y", "teacher_id": "44444444-4444-4444-4444-444444444444"}
    resp = call(client, settings, "POST", "/api/students", json=body)
    assert repo.students[resp.json()["id"]].teacher_id == TEACHER_ID


def test_update_only_sent_fields_and_keep_first_consent_time(client, settings, repo):
    path = f"/api/students/{STUDENT_ID}"
    call(client, settings, "PATCH", path, json={"consent": True})
    first = repo.students[STUDENT_ID].consent_at
    resp = call(client, settings, "PATCH", path, json={"goals": "Thi lớp 10", "consent": True})
    assert resp.status_code == 200
    student = repo.students[STUDENT_ID]
    assert student.goals == "Thi lớp 10" and student.full_name == "Em A"
    assert student.consent_at == first
    call(client, settings, "PATCH", path, json={"consent": False, "goals": ""})
    assert repo.students[STUDENT_ID].consent_at is None
    assert repo.students[STUDENT_ID].goals is None


def test_cannot_touch_other_teachers_student(client, settings, repo):
    path = f"/api/students/{FOREIGN_STUDENT_ID}"
    assert call(client, settings, "PATCH", path, json={"notes": "x"}).status_code == 404
    assert call(client, settings, "DELETE", path).status_code == 404
    assert FOREIGN_STUDENT_ID in repo.students


def test_delete_requires_inactive_first(client, settings, repo):
    path = f"/api/students/{NO_ACCOUNT_STUDENT_ID}"
    assert call(client, settings, "DELETE", path).status_code == 409
    call(client, settings, "PATCH", path, json={"active": False})
    assert call(client, settings, "DELETE", path).status_code == 204
    assert NO_ACCOUNT_STUDENT_ID not in repo.students


def test_delete_student_also_removes_login_account(client, settings, repo):
    create(client, settings, NO_ACCOUNT_STUDENT_ID)
    assert repo.auth_users
    path = f"/api/students/{NO_ACCOUNT_STUDENT_ID}"
    call(client, settings, "PATCH", path, json={"active": False})
    assert call(client, settings, "DELETE", path).status_code == 204
    assert repo.auth_users == {}


def test_list_counts_only_completed_sessions(client, settings, repo):
    base = repo.sessions[SESSION_ID]
    repo.sessions["done-1"] = base.model_copy(update={"id": "done-1", "status": "completed"})
    repo.sessions["done-2"] = base.model_copy(update={"id": "done-2", "status": "completed"})
    repo.sessions["cancel"] = base.model_copy(update={"id": "cancel", "status": "cancelled"})
    rows = {s["id"]: s for s in call(client, settings, "GET", "/api/students").json()}
    assert rows[STUDENT_ID]["completed_sessions"] == 2  # buổi scheduled, cancelled không tính
    assert rows[NO_ACCOUNT_STUDENT_ID]["completed_sessions"] == 0


def test_teacher_resets_student_password(client, settings, repo):
    path = f"/api/students/{STUDENT_ID}/password"
    resp = call(client, settings, "POST", path, json={"password": "matkhau-moi-1"})
    assert resp.status_code == 204
    assert repo.passwords[STUDENT_PROFILE_ID] == "matkhau-moi-1"


def test_reset_password_rules(client, settings, repo):
    body = {"password": "matkhau-moi-1"}
    # học sinh không tự đặt lại qua đây, học sinh của GV khác: 404, chưa có tài khoản: 409
    path = f"/api/students/{STUDENT_ID}/password"
    assert call(client, settings, "POST", path, STUDENT_PROFILE_ID, json=body).status_code == 403
    path = f"/api/students/{FOREIGN_STUDENT_ID}/password"
    assert call(client, settings, "POST", path, json=body).status_code == 404
    path = f"/api/students/{NO_ACCOUNT_STUDENT_ID}/password"
    assert call(client, settings, "POST", path, json=body).status_code == 409
    path = f"/api/students/{STUDENT_ID}/password"
    assert call(client, settings, "POST", path, json={"password": "123"}).status_code == 422
    assert repo.passwords == {}

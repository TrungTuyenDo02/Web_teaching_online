# apps/api: FastAPI

Đọc kèm `AGENTS.md` ở thư mục gốc. File này chỉ ghi điều riêng của API.

## Vai trò

Xác thực JWT Supabase, kiểm tra quyền với buổi học, cấp token LiveKit và token bảng viết, ghi điểm danh, kết thúc buổi học. Gọi Supabase bằng service role, nên **mọi kiểm tra quyền nằm trong code router và phải có test**.

## Bản đồ file

| File | Nội dung |
|------|----------|
| `app/main.py` | `create_app()`, CORS, gắn router, kiểm tra biến môi trường khi khởi động |
| `app/config.py` | `Settings` (pydantic-settings, đọc `.env` gốc). Thêm biến mới: sửa ở đây và `.env.example` |
| `app/core/time.py` | Đồng hồ UTC duy nhất của app; tháng/ngày nghiệp vụ giờ Việt Nam, resolve_date xác định và từ chối diễn đạt mơ hồ |
| `app/auth.py` | `get_current_user` → `AuthUser` (ES256 qua JWKS cho dự án mới, HS256 nếu có `SUPABASE_JWT_SECRET`) |
| `app/models.py` | Enum `Role`, `DeviceMode`, `SessionStatus`; model hàng DB và request/response |
| `app/repo.py` | `Repository` (Protocol), `SupabaseRepository` (PostgREST), `get_repo` |
| `app/routers/` | `health`, `me`, `sessions` (tạo, `cancel`, `join`, `end`; `require_teacher`), `students` (danh sách, thêm, sửa, xóa hẳn, `account`) |
| `app/services/tokens.py` | Nơi duy nhất gọi LiveKit SDK (token, tạo phòng, thu hồi token rồi xóa phòng, liệt kê phòng) qua `_livekit`, và ký token bảng viết (vào phòng, đóng phòng). Thiết kế: `docs/design-video-token.md` |
| `app/preflight.py` | `python -m app.preflight`: kiểm tra chỉ đọc cấu hình, migration 0004–0007, bucket, JWKS, máy chủ bảng, LiveKit; không in URL/khóa |
| `app/services/no_show.py` | Vòng lặp nền trong `lifespan`: buổi quá giờ chưa vào → `no_show`, rồi `finalize.retry_pending`, `finalize.sweep_livekit_rooms` (xóa phòng video của buổi đã đóng) và `student_deletion.retry_pending_deletions` (`NO_SHOW_INTERVAL_SECONDS`, 0 để tắt) |
| `app/routers/reports.py`, `app/services/reports.py` | Báo cáo tháng chỉ giáo viên; completed theo scheduled_start trong tháng giờ VN, qua Repository phân trang; không giữ số liệu học sinh đã xóa. `tests/test_monthly_reports.py` |
| `app/routers/weekly_slots.py`, `app/services/weekly_slots.py` | Lịch cố định hằng tuần (M1a.3): GV tạo/ngừng lịch; `fill_slot` sinh buổi 4 tuần tới theo giờ VN, bỏ ngày trùng giờ, chống trùng bằng unique (slot_id, slot_date) trong DB; `fill_all` chạy trong vòng lặp nền (`no_show.run_forever`). Test `tests/test_weekly_slots.py` |
| `app/routers/teaching_notes.py` | Danh mục chủ đề theo GV, note riêng của buổi completed, danh sách/xuất theo HS–tháng VN. Repository gọi RPC 0008 lưu note+chủ đề nguyên tử/CAS; `tests/test_teaching_notes.py` |
| `app/services/student_deletion.py` | Xóa hẳn học sinh theo bước (bảng, tệp, buổi, tài khoản, hồ sơ), làm tiếp được (quyết định 19) |
| `app/services/finalize.py` | Làm nốt việc sau khi kết thúc buổi (điểm danh, đóng LiveKit, đóng và lưu bảng), ghi `finalized_at`; gọi lại được (quyết định 18). Tải bảng lên qua bản đăng ký `board_upload_intents`, `sweep_stale_uploads` dọn bù (quyết định 19) |
| `tests/conftest.py` | `make_settings()`, `FakeRepo`, `FakeLiveKit` (mô hình LiveKit giả định: thu hồi có hạn, tạo phòng muộn, tiêm lỗi), `clock`, client test, hằng số UUID mẫu |
| `scripts/livekit_dev_check.py` | Kịch bản thử T1–T14 trên dự án LiveKit **dev** (gọi dịch vụ thật, chỉ chạy khi được phép, dừng API dev trước; không thuộc ứng dụng). Test offline: `tests/test_livekit_dev_check.py` |

## Lệnh (chạy từ thư mục gốc)

- `make dev-api` · `make test-api` · `make lint`
- Một test: `cd apps/api && .venv/Scripts/pytest tests/test_sessions.py -k ten_test` (Linux/macOS: `.venv/bin`)

## Công thức thêm một endpoint

1. Model request/response trong `app/models.py`.
2. Truy vấn mới: thêm vào `Repository`, `SupabaseRepository` **và** `FakeRepo` trong `tests/conftest.py`.
3. Router mới trong `app/routers/`, gắn ở `create_app()`. Lấy quyền qua `_load_session_for_member` (hoặc hàm tương tự) để giữ quy tắc 404.
4. Test: người được phép, người khác (404), sai vai trò, sai trạng thái.
5. Docstring của endpoint viết rõ bằng tiếng Việt: nó là mô tả trong OpenAPI, sau này làm mô tả công cụ cho trợ lý AI (quyết định 12).
6. Cập nhật `apps/web/src/lib/api.ts` nếu web gọi endpoint này.

## Lưu ý

- Chuỗi lỗi trả về cho người dùng bằng tiếng Việt (`HTTPException(..., "…")`).
- Không log body request hay nội dung bài làm.
- Không gọi `datetime.now`/`date.today` trực tiếp ngoài `app/core/time.py`; dùng `from app.core import time as clock`. Test giả thời gian patch `app.core.time.now_utc`, không patch lẻ từng module. `scripts/check_time_usage.py` và Ruff DTZ chạy trong lint/CI. Công cụ dev/SDK có đồng hồ riêng không phải code nghiệp vụ.
- Eval offline: `make test-evals` hoặc từ gốc `apps/api/.venv/Scripts/python -m evals.run --suite E0`; tài liệu `evals/README.md`. Không gọi provider hoặc nhận dữ liệu học sinh thật trong suite PR.
- Phòng video mới có metadata sở hữu ký HMAC theo tên phòng và môi trường (`services/tokens.py`). Sweeper chỉ dọn phòng không còn hàng DB khi nhãn hợp lệ; DB lỗi không được coi là mất hàng. Đổi khóa/phạm vi thì nhãn cũ không được tự nhận; không log metadata.
- Đổi trạng thái buổi học: dùng `update_session(..., expected_status=...)` theo trạng thái vừa đọc, `None` nghĩa là yêu cầu khác đã ghi trước (test bằng `FakeRepo.before_next_update`).
- Hook tự chạy `ruff format` và `ruff check --fix` sau mỗi lần sửa file `.py` (cần `make install-api`).

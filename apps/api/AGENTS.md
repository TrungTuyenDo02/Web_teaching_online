# apps/api: FastAPI

Đọc kèm `AGENTS.md` ở thư mục gốc. File này chỉ ghi điều riêng của API.

## Vai trò

Xác thực JWT Supabase, kiểm tra quyền với buổi học, cấp token LiveKit và token bảng viết, ghi điểm danh, kết thúc buổi học. Gọi Supabase bằng service role, nên **mọi kiểm tra quyền nằm trong code router và phải có test**.

## Bản đồ file

| File | Nội dung |
|------|----------|
| `app/main.py` | `create_app()`, CORS, gắn router, kiểm tra biến môi trường khi khởi động |
| `app/config.py` | `Settings` (pydantic-settings, đọc `.env` gốc). Thêm biến mới: sửa ở đây và `.env.example` |
| `app/auth.py` | `get_current_user` → `AuthUser` (HS256; đổi sang JWKS ở đây nếu cần) |
| `app/models.py` | Enum `Role`, `DeviceMode`, `SessionStatus`; model hàng DB và request/response |
| `app/repo.py` | `Repository` (Protocol), `SupabaseRepository` (PostgREST), `get_repo` |
| `app/routers/` | `health`, `me`, `sessions` (`join`, `end`) |
| `app/services/tokens.py` | Nơi duy nhất gọi LiveKit SDK và ký token bảng viết |
| `tests/conftest.py` | `make_settings()`, `FakeRepo`, client test, hằng số UUID mẫu |

## Lệnh (chạy từ thư mục gốc)

- `make dev-api` · `make test-api` · `make lint`
- Một test: `cd apps/api && .venv/Scripts/pytest tests/test_sessions.py -k ten_test` (Linux/macOS: `.venv/bin`)

## Công thức thêm một endpoint

1. Model request/response trong `app/models.py`.
2. Truy vấn mới: thêm vào `Repository`, `SupabaseRepository` **và** `FakeRepo` trong `tests/conftest.py`.
3. Router mới trong `app/routers/`, gắn ở `create_app()`. Lấy quyền qua `_load_session_for_member` (hoặc hàm tương tự) để giữ quy tắc 404.
4. Test: người được phép, người khác (404), sai vai trò, sai trạng thái.
5. Cập nhật `apps/web/src/lib/api.ts` nếu web gọi endpoint này.

## Lưu ý

- Chuỗi lỗi trả về cho người dùng bằng tiếng Việt (`HTTPException(..., "…")`).
- Không log body request hay nội dung bài làm.
- Hook tự chạy `ruff format` và `ruff check --fix` sau mỗi lần sửa file `.py` (cần `make install-api`).

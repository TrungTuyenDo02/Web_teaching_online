# AGENTS.md

Hướng dẫn cho Claude Code, Codex và các công cụ code AI khác làm việc trong dự án này. Đọc trước khi sửa code.

## Dự án

Nền tảng gia sư trực tuyến 1-1, một giáo viên và nhiều học sinh. Học sinh có thể là trẻ vị thành niên, nên quyền riêng tư là yêu cầu hàng đầu. Giáo viên dạy bằng **laptop (camera, micro) và tablet Android dùng bút làm bảng viết**. Không dùng chia sẻ màn hình, vì trình duyệt di động không hỗ trợ ổn định và video nén làm mờ nét chữ.

Giai đoạn 1: phòng học, bảng viết, buổi học. Giai đoạn 2: hồ sơ học sinh, lịch, nộp và chữa bài. Giai đoạn 3: AI gợi ý chấm. Không làm việc của giai đoạn sau khi chưa được yêu cầu.

## Cấu trúc và lệnh

- `apps/api` (Python 3.13, FastAPI): `make dev-api`, `make test-api`
- `apps/web` (React 19, TypeScript, Vite): `make dev-web`, `cd apps/web && npm run typecheck && npm run build`
- `services/whiteboard-sync` (Node 22, ws, jose): `make dev-board`, `make test-board`
- `supabase/migrations`: schema. `supabase/tests/run.sh`: kiểm thử migration và RLS
- `make lint` phải sạch trước khi coi một việc là xong

## Quy tắc bắt buộc

Bảo mật:
- Không đọc, in, commit file `.env`. Chỉ sửa `.env.example` khi thêm biến mới (và cập nhật `apps/api/app/config.py` nếu API dùng).
- `SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_API_SECRET`, `WHITEBOARD_JWT_SECRET` chỉ dùng ở `apps/api` và `services/whiteboard-sync`. Không đưa vào `apps/web`, không đặt tên biến bắt đầu bằng `VITE_`.
- Mọi bảng mới phải bật RLS và có policy tối thiểu trong migration mới (đánh số tiếp, không sửa migration đã áp dụng). Mỗi policy mới cần thêm ca kiểm thử trong `supabase/tests/90_rls_test.sql`: người được phép thấy, người không được phép không thấy.
- Vai trò (giáo viên/học sinh) lấy từ bảng `profiles`, không tin claim trong JWT.
- API trả 404 (không phải 403) khi người dùng không có quyền với một buổi học, để không lộ buổi học tồn tại.
- Không ghi hình mặc định, không log nội dung bài làm hay thông tin cá nhân của học sinh.

Code:
- Router API chỉ làm việc qua `Repository` (`apps/api/app/repo.py`). Thêm truy vấn mới thì thêm vào Protocol, bản Supabase và `FakeRepo` trong test.
- Dịch vụ video phải đổi được: mọi chỗ gọi LiveKit nằm trong `apps/api/app/services/tokens.py` và `apps/web/src/components/VideoPanel.tsx`.
- Không tự dựng WebRTC. Không thêm thư viện lớn khi chưa cần.
- Tablet ở chế độ `board` chỉ vào bảng viết, không vào phòng video (không tính thêm phút video).
- Giao diện: vùng chạm tối thiểu 44 px, dùng được trên tablet và điện thoại, chữ tiếng Việt.
- Tiếng Việt cho chuỗi hiển thị và thông báo lỗi; tên biến, hàm, bảng bằng tiếng Anh.

Cách làm việc:
- Làm từng lát nhỏ chạy được từ đầu đến cuối (ví dụ "tạo học sinh, xem danh sách, sửa, xóa"), có test, rồi mới sang lát tiếp.
- Sửa lỗi thì viết test tái hiện lỗi trước.
- Trước khi báo xong: `make test`, `make lint`, `make build-web`. Nếu đụng migration: chạy `supabase/tests/run.sh`.
- Không bịa kết quả chạy. Việc chưa chạy thử được (cần Supabase hay LiveKit thật, bút trên tablet) thì nói rõ là chưa thử.

## Làm tiếp từ đâu

- **`docs/progress.md`**: đang làm gì, việc tiếp theo, nhật ký. Đọc đầu phiên, cập nhật cuối phiên (cách ghi: `docs/AGENTS.md`).
- Mỗi mục có `AGENTS.md` riêng (bản đồ file, lệnh, công thức thêm tính năng): `apps/api`, `apps/web`, `services/whiteboard-sync`, `supabase`, `docs`. `CLAUDE.md` cạnh đó chỉ là `@AGENTS.md` để Claude Code tự nạp.

## Hook Claude Code (`.claude/settings.json`, script ở `.claude/hooks/`)

- `SessionStart`: in `docs/progress.md` vào ngữ cảnh.
- `PreToolUse` (`guard.mjs`): chặn đọc/sửa `.env`, sửa migration đã có, đưa tên khóa bí mật vào `apps/web`.
- `PostToolUse` (`py-format.mjs`): `ruff format` và `ruff check --fix` file `.py` vừa sửa trong `apps/api`.
- `Stop` (`stop-progress.mjs`): code mới hơn `docs/progress.md` thì yêu cầu cập nhật sổ trước khi dừng (nhắc một lần).
- Cần Node 22 trên PATH. Cài đặt riêng từng máy để ở `.claude/settings.local.json` (không commit).

## Sơ đồ

Xem `docs/flows.md`. Đổi luồng nghiệp vụ thì cập nhật sơ đồ trong cùng lần sửa.

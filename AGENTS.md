# AGENTS.md

Hướng dẫn cho Claude Code, Codex và các công cụ code AI khác làm việc trong dự án này. Đọc trước khi sửa code.

Đây là nguồn hướng dẫn chung. `CLAUDE.md` chỉ chứa `@AGENTS.md`; quy tắc riêng của từng thư mục đặt trong `AGENTS.md` của thư mục đó, tránh chép lại hướng dẫn chung.

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
- Không đọc, in, sửa hoặc commit file chứa bí mật (`.env`, `.env.local` và các file `.env.*`, trừ `.env.example`). Chỉ sửa `.env.example` khi thêm biến mới (và cập nhật `apps/api/app/config.py` nếu API dùng).
- `SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_API_SECRET`, `WHITEBOARD_JWT_SECRET` chỉ dùng ở `apps/api` và `services/whiteboard-sync`. Không đưa vào `apps/web`, không đặt tên biến bắt đầu bằng `VITE_`.
- Mọi bảng mới phải bật RLS và có policy tối thiểu trong migration mới (đánh số tiếp, không sửa migration đã áp dụng). Mỗi policy mới cần thêm ca kiểm thử trong `supabase/tests/90_rls_test.sql`: người được phép thấy, người không được phép không thấy.
- Vai trò (giáo viên/học sinh) lấy từ bảng `profiles`, không tin claim trong JWT.
- API trả 404 (không phải 403) khi người dùng không có quyền với một buổi học, để không lộ buổi học tồn tại.
- Không ghi hình mặc định, không log nội dung bài làm hay thông tin cá nhân của học sinh.

Code:
- Router API chỉ làm việc qua `Repository` (`apps/api/app/repo.py`). Thêm truy vấn mới thì thêm vào Protocol, bản Supabase và `FakeRepo` trong test.
- Dịch vụ video phải đổi được: mọi chỗ gọi LiveKit nằm trong `apps/api/app/services/tokens.py` và `apps/web/src/components/VideoPanel.tsx`.
- Không tự dựng WebRTC. Giữ stack và trình quản lý gói hiện tại (`npm` cho web và máy chủ bảng). Nếu chưa được cho phép, đề xuất và chờ duyệt trước khi đổi framework, thêm dịch vụ ngoài hoặc thư viện lớn.
- Tablet ở chế độ `board` chỉ vào bảng viết, không vào phòng video (không tính thêm phút video).
- Giao diện: vùng chạm tối thiểu 44 px, dùng được trên tablet và điện thoại, chữ tiếng Việt.
- Tiếng Việt cho chuỗi hiển thị và thông báo lỗi; tên biến, hàm, bảng bằng tiếng Anh. Web có hai ngôn ngữ: chuỗi hiển thị đi qua `t("câu tiếng Việt")` và có bản tiếng Anh trong `apps/web/src/lib/i18n-en.ts` (xem `apps/web/AGENTS.md`).

Cách làm việc:
- Đọc `docs/progress.md` đầu phiên và `AGENTS.md` trong các thư mục liên quan. Kiểm tra `git status`/`git diff` để giữ nguyên thay đổi đang có của người dùng.
- Đọc code liên quan và trình bày kế hoạch ngắn trước khi sửa. Không bắt buộc vào plan mode cho mọi việc.
- Tự thực hiện trong phạm vi yêu cầu; chỉ chờ duyệt khi đổi kiến trúc, mở rộng phạm vi hoặc có thao tác khó hoàn tác chưa được cho phép. Không hỏi lại việc đã được cho phép trong phiên.
- Làm từng lát nhỏ chạy được từ đầu đến cuối (ví dụ "tạo học sinh, xem danh sách, sửa, xóa"), gồm code, test và tài liệu liên quan, rồi mới sang lát tiếp. Không giới hạn cứng số file.
- Sửa lỗi thì viết test tái hiện lỗi trước.
- Trước khi báo xong: `make test`, `make lint`, `make build-web`. Nếu đụng migration: chạy `supabase/tests/run.sh`.
- Nếu lệnh chuẩn lỗi môi trường, chạy lệnh thành phần phù hợp khi có thể; ghi rõ lệnh nào lỗi, lệnh thay thế và kết quả thực tế, không báo lệnh chuẩn đã đạt.
- Không bịa kết quả chạy. Việc chưa chạy thử được (cần Supabase hay LiveKit thật, bút trên tablet) thì nói rõ là chưa thử.
- Cập nhật `docs/progress.md` cuối phiên; đổi luồng thì cập nhật `docs/flows.md`. Tiến độ và việc tiếp theo lấy từ sổ bàn giao, không bắt đầu lại từ bộ khung.
- Chỉ commit khi được yêu cầu; chỉ đưa thay đổi thuộc công việc vào commit, message rõ ràng.
- Báo ngắn gọn bằng tiếng Việt: kết quả, kiểm tra thực chạy, phần chưa thử và bước tiếp theo. Không giới hạn cứng số dòng nếu cần giải thích lỗi hoặc hạn chế.

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

## Định hướng Tutor

`TUTOR_PLATFORM_SPEC.md` là bản nháp mở rộng Teacher-Ops, bài tập, chấm bài và Tutor. Đọc đối chiếu `docs/platform-workflow.md` trước khi làm mốc mới; không tự khởi tạo lại repo, thay Auth/stack hoặc đổi quy tắc xóa/tính buổi từ bản nháp. Sổ bàn giao vẫn là `docs/progress.md`; `STATUS.md` chỉ ghi mốc theo kiểu append-only.

Thời gian ứng dụng API đi qua `app/core/time.py` (UTC để lưu, giờ Việt Nam cho ngày nghiệp vụ), có guard trong lint. Eval xác định chạy bằng `make test-evals`; E0 hiện mới có phần thời gian. Các cổng AI chưa có dữ liệu/runner phải ghi chưa đo hoặc `not_run`, không lấy test giả lập làm kết quả model thật.

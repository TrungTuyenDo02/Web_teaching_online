# apps/web: React + TypeScript + Vite

Đọc kèm `AGENTS.md` ở thư mục gốc. File này chỉ ghi điều riêng của web.

## Vai trò

Đăng nhập (Supabase Auth), danh sách buổi học, phòng học gồm video (LiveKit) và bảng viết (Excalidraw đồng bộ qua `whiteboard-sync`). Đọc dữ liệu trực tiếp từ Supabase trong giới hạn RLS. **Mọi thao tác ghi học sinh, buổi học đi qua API** (`src/lib/api.ts`); trình duyệt không có quyền ghi các bảng này (migration 0003).

## Bản đồ file

| File | Nội dung |
|------|----------|
| `src/main.tsx`, `src/App.tsx` | Khởi động, định tuyến, `RequireAuth` |
| `src/auth/AuthProvider.tsx` | `AuthProvider`, `useAuth` (kèm `role` đọc từ `profiles`) |
| `src/lib/env.ts` | Biến `VITE_*` (chỉ biến công khai) |
| `src/lib/supabase.ts` | Client Supabase (có thể `null` khi chưa cấu hình) |
| `src/lib/api.ts` | `apiFetch`, `joinSession`, `endSession`, kiểu `JoinResponse` (khớp `apps/api/app/models.py`) |
| `src/pages/LandingPage.tsx` | Trang giới thiệu ở `/` cho khách (người đã đăng nhập ở `/` thấy `DashboardPage`, chọn trong `App.tsx`); chỉ nêu điều ứng dụng làm thật |
| `src/lib/i18n.ts`, `src/lib/i18n-en.ts`, `src/ui/LangSwitch.tsx` | Hai ngôn ngữ, không thư viện: câu tiếng Việt là khóa, `i18n-en.ts` là bản tiếng Anh; chọn VI/EN lưu `localStorage`, đặt `<html lang>`. `App` gọi `useLang()` để cả cây vẽ lại khi đổi |
| `src/pages/` | `LoginPage`, `DashboardPage` (chọn `teacher/TeacherHome` hoặc `student/StudentHome` theo vai trò), `RoomPage`, `StudentsPage` (tìm, lọc, thêm/sửa, tài khoản, ngừng dạy, xóa hẳn), `HistoryPage`, `BoardReviewPage`, `NotFoundPage`; `SessionList`, `teacher/SessionFormDialog` |
| `src/lib/data.ts` | `backend`: mọi lần đọc (Supabase, RLS lọc) và ghi (API) của trang đi qua đây; `setBackend` chỉ cho chế độ xem trước |
| `src/lib/schedule.ts` | Hàm thuần: buổi tiếp theo, chia hôm nay/sắp tới, câu thời gian, gắn lỗi API vào trường form (test: `services/whiteboard-sync/test/web-schedule.test.ts`) |
| `src/pages/MonthlyReportPage.tsx`, `src/lib/reportCsv.ts` | `/reports` chỉ giáo viên: chọn tháng, xem số buổi, tải CSV tiếng Việt qua backend/API. Test CSV trong board; test UI `e2e/ui/reports.spec.ts` |
| `src/pages/teacher/WeeklySlotsDialog.tsx` | Hộp thoại "Lịch hằng tuần" mở từ trang Học sinh: xem, thêm, ngừng lịch cố định; báo số buổi đã xếp và ngày bị bỏ vì trùng giờ. Test `e2e/ui/weekly-slots.spec.ts` |
| `src/pages/TeachingNotesPage.tsx`, `src/lib/teachingNotesExport.ts`, `src/lib/csv.ts` | `/teaching-notes` chỉ GV: note riêng/chủ đề buổi completed, lọc HS–tháng VN, tải Markdown/CSV; không render HTML nhập vào. API 0008 có revision, lỗi giữ bản nháp, tải lại bản đã lưu trước khi sửa tiếp. Test `e2e/ui/teaching-notes.spec.ts` và `web-teaching-notes.test.ts` |
| `src/lib/hooks.ts` | `useAsync` (tải, lỗi, tải lại), `useNow` |
| `src/ui/` | Bộ component dùng chung theo `DESIGN.md`: `AppShell` (thanh trên, điều hướng theo vai trò, tên tài khoản, đăng xuất), `Window`, `Button`/`ButtonLink`, `Field`, `Dialog`/`ConfirmDialog`, `Feedback` (`Alert`, `Loading`, `Empty`, `ErrorState`, `ToastProvider`/`useToast`), `SessionStatus`, `Decor` |
| `src/styles/tokens.css`, `src/styles/global.css` | Design tokens và kiểu chung; chỉ tạo kiểu qua class (không đặt kiểu cho thẻ `button`/`input` trần, để không lọt vào Excalidraw/LiveKit) |
| `src/dev/preview.tsx` | Chế độ xem trước bằng dữ liệu minh họa, **chỉ bản development** (xem dưới) |
| `src/dev/whiteboard.tsx` | Trang thử bảng `/dev/whiteboard` với máy chủ bảng thử thật, **chỉ bản development** (xem dưới) |
| `src/components/BoardViewer.tsx` | Excalidraw chỉ xem cho bảng đã lưu |
| `src/components/VideoPanel.tsx` | Nơi duy nhất dùng LiveKit ở web |
| `src/components/Whiteboard.tsx` | Excalidraw: chỉnh bút, chặn chạm nhầm ở đây |
| `src/lib/boardConnection.ts` | Giao thức WebSocket với `services/whiteboard-sync` (chia lô, nối lại, gửi bù, heartbeat ping/pong 5 s/10 s, `verify()` khi quay lại tab); không phụ thuộc React/Excalidraw để test với máy chủ thật |
| `src/hooks/useBoardSync.ts` | Gắn `BoardConnection` vào Excalidraw (`reconcileElements`), gỡ ảnh chưa đồng bộ được; gọi `verify()` khi tab hiện lại/có mạng/được focus |
| `src/brand.ts` | Tên, khẩu hiệu (màu ở `src/styles/tokens.css`) |
| `playwright.config.ts`, `e2e/` | Test trình duyệt (docs/testing.md): `global-setup.ts` dựng Vite `--mode e2e` + máy chủ bảng thử ở cổng ngẫu nhiên; `fixtures/` (chặn mạng ngoài, gom lỗi console, Supabase/API giả, trợ giúp bảng); `ui/`, `board/`, `build/` |

## Lệnh (chạy từ thư mục gốc)

- `make dev-web` · `cd apps/web && npm run typecheck` · `make build-web`
- Test tự động của web chạy trong `make test-board`: `boardConnection.ts` (`client.test.ts`, với máy chủ bảng thật) và `schedule.ts` (`web-schedule.test.ts`).
- Test trình duyệt: `npm run test:e2e:smoke` / `npm run test:e2e` (hoặc `make test-e2e-smoke` / `make test-e2e`). Cách chạy, phần giả/thật, cách đọc lỗi: `docs/testing.md`. Không dùng hay dừng Vite 5173; không gọi dịch vụ thật.

## Chế độ xem trước (chỉ development)

- Chạy `make dev-web` rồi mở `http://localhost:5173/?preview=teacher` hoặc `?preview=student`; tắt bằng `?preview=off`. Dải trên cùng ghi "Dữ liệu minh họa".
- Dùng đúng trang và component thật; dữ liệu minh họa nằm trong bộ nhớ trình duyệt, không gọi Supabase/API/LiveKit/máy chủ bảng (bảng vẽ được nhưng không gửi đi, video là khung giữ chỗ).
- Cố ý mô phỏng: tạo buổi trùng giờ/quá 4 giờ/giờ đã qua báo lỗi như API; xóa hẳn lần đầu "chưa xóa xong" rồi "Xóa tiếp"; kết thúc buổi lần đầu "chờ lưu" rồi "Thử lại ngay".
- `main.tsx` chỉ nạp `src/dev/` khi `import.meta.env.DEV`; bản build production không chứa (kiểm: `grep preview=teacher dist/assets/*.js` không ra gì). Không bỏ qua xác thực ở bản production.

## Trang thử bảng viết `/dev/whiteboard` (chỉ development)

- Hai cửa sổ terminal: `make dev-board-local` rồi `make dev-web`; mở `http://localhost:5173/dev/whiteboard`. Không cần Supabase/API/LiveKit.
- Dùng đúng `components/Whiteboard.tsx`, `lib/boardConnection.ts` và máy chủ `whiteboard-sync` thật (`services/whiteboard-sync/dev/local-board.ts`). Token do máy chủ thử ký bằng khóa ngẫu nhiên; web không có khóa ký.
- `main.tsx` nạp `src/dev/whiteboard.tsx` trước khi dựng `App` (không qua đăng nhập), chỉ khi `import.meta.env.DEV`. Kiểm bản production: `grep -rlF "Phòng thử cục bộ" dist` và `grep -rlF "127.0.0.1:8789" dist` không ra gì.
- "Bảng đã kết nối" (thanh của `Whiteboard`) chỉ là kết nối máy chủ; "Tab học sinh cùng trình duyệt: đã nhận nét mới nhất" là xác nhận của tab nhận qua `BroadcastChannel` (chỉ giữa các tab cùng trình duyệt; nhãn ghi "cùng trình duyệt", máy khác thì trang ghi rõ là không báo về được). `Whiteboard`/`useBoardSync`/`BoardConnection` có callback tùy chọn `onActivity` cho việc này; giao thức không đổi.
- Tablet qua Wi-Fi: `make dev-board-lan LAN_IP=<IP>` và `make dev-web-lan LAN_IP=<IP>` (`vite.config.ts` `--mode lan`: chỉ nghe IP nội bộ trong `LAN_IP`, `envDir: false`). Trang gọi máy chủ thử theo `location.hostname` (localhost → 127.0.0.1), nhận 401 thì hiện ô "Mã ghép nối" (lưu `sessionStorage` của tab). Hướng dẫn: `docs/tablet-wifi.md`.
- Vite chạy cổng khác 5173 (cổng bận): chạy máy chủ thử với `cd services/whiteboard-sync && npm run dev:local -- --web-port=<cổng>`; trang báo lỗi tiếng Việt nếu lệch cổng.
- Hai nút giả lập mất kết nối: "Ngắt máy chủ thử 10 giây" (máy chủ cắt kết nối, có close) và "Treo đường truyền tab này 40 giây" (proxy `services/whiteboard-sync/dev/line-proxy.ts` ngừng chuyển dữ liệu của riêng tab đó, không có close; 40 giây để máy chủ kịp gỡ kết nối, tab kia thấy bớt thiết bị). Offline của DevTools cũng là đường truyền treo.

## Lưu ý

- Không đặt khóa bí mật trong web (hook chặn khi thấy tên khóa bí mật trong `apps/web`).
- Đổi giao thức bảng viết thì sửa cùng lúc `lib/boardConnection.ts` và `services/whiteboard-sync/src/server.ts`. `boardConnection.ts` chỉ dùng API chuẩn (WebSocket, TextEncoder, setTimeout): test chạy trong Node.
- Vùng chạm ≥ 44 px (`--touch`), kiểm trên khổ tablet và điện thoại; mọi chuỗi hiển thị bằng tiếng Việt.
- Màu, khoảng cách, bóng chỉ lấy từ `tokens.css`. Chữ `--ink-900` trên `--pink-400` chỉ 4.3:1: nút chính dùng `--periwinkle-400`, title bar hồng dùng `--pink-200`, chữ phụ cỡ nhỏ dùng `--ink-700`.
- Font của Excalidraw phục vụ từ chính web: `main.tsx` đặt `window.EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/"`, plugin `excalidrawFonts` trong `vite.config.ts` phục vụ khi dev và chép `node_modules/@excalidraw/excalidraw/dist/prod/fonts` vào bản build (mặc định thư viện tải từ CDN esm.sh). Test trình duyệt chặn mọi yêu cầu ra ngoài.
- Giao diện Excalidraw hiện là tiếng Anh: gói vi-VN của Excalidraw 0.18.1 dịch 49%, dưới ngưỡng 85% thư viện tự lọc nên `langCode="vi-VN"` không có tác dụng (chưa xử lý, xem docs/testing.md).
- `Whiteboard` có prop tùy chọn `onApi` (trang thử `/dev/whiteboard` đặt `window.__devBoardApi` cho test đọc nội dung bảng); bản production không có móc này (BUILD-01).
- Chữ hiển thị: viết câu tiếng Việt trong `t("…")` (biến: `t("Còn {n} phút", { n })`, không ghép chuỗi hay template literal có chữ Việt), thêm bản tiếng Anh vào `i18n-en.ts`. Câu lỗi API (tiếng Việt) dịch khi hiển thị qua `errorMessage`; so khớp nội dung lỗi thì dùng `errorText` (câu gốc). `services/whiteboard-sync/test/web-i18n.test.ts` quét mã nguồn và báo câu thiếu bản dịch; `e2e/ui/landing.spec.ts` kiểm giao diện tiếng Anh thật. Excalidraw nhận `langCode` theo ngôn ngữ (vi-VN vẫn hiện tiếng Anh, xem dưới).
- Font giao diện: Nunito (`@fontsource-variable/nunito`, import trong `main.tsx`, đóng gói vào bản build, có dấu tiếng Việt), tiêu đề dùng cùng font độ đậm 900 (`--font-display`).
- Không tải font ngoài; font pixel chỉ cho nhãn ASCII (tên tệp trên title bar), không dùng Georgia cho chữ có dấu (quyết định 20).
- Trang gọi dữ liệu qua `backend` trong `lib/data.ts`, không gọi `supabase` trực tiếp.

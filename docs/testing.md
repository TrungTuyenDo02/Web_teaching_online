# Kiểm thử tự động

Cách chạy, phần nào thật, phần nào giả, và cách đọc kết quả. Ma trận yêu cầu: [testing-plan.md](testing-plan.md). Nghiệm thu với dịch vụ và thiết bị thật: [acceptance.md](acceptance.md).

## Các bộ test

| Bộ | Lệnh | Thật | Giả | Chứng minh được |
|---|---|---|---|---|
| API | `make test-api` | Code API | Supabase/LiveKit (`FakeRepo`, `FakeLiveKit`) | Nghiệp vụ, quyền ở API, race/lỗi theo mô hình |
| Bảng (Node) | `make test-board` | `whiteboard-sync`, `boardConnection.ts`, `schedule.ts` | — | Giao thức, lưu đĩa, nối lại, heartbeat |
| RLS | `bash supabase/tests/run.sh` | PostgreSQL, migration, policy | Phần auth/storage của Supabase | SQL/RLS |
| Trình duyệt | `make test-e2e-smoke`, `make test-e2e` | Web (React, component, `api.ts`, `data.ts`, `AuthProvider`), Excalidraw, `whiteboard-sync` thật cục bộ | Supabase và API ở ranh giới mạng; LiveKit không kết nối | Giao diện, luồng người dùng, đồng bộ bảng giữa hai trình duyệt |

`make test` gồm API, bảng và eval E0; **không** gồm test trình duyệt (cần Chromium, chạy riêng).

## Test trình duyệt (Playwright)

### Cài và chạy

```bash
cd apps/web
npm ci
npx playwright install chromium     # lần đầu; Linux/CI: --with-deps
cd ../../services/whiteboard-sync && npm ci   # máy chủ bảng thử cần tsx, ws, jose
```

- `npm run test:e2e:smoke` (hoặc `make test-e2e-smoke`): nhóm `@smoke`, chạy mỗi PR.
- `npm run test:e2e` (hoặc `make test-e2e`): toàn bộ, gồm `@slow` (treo đường truyền thật 40 giây) và `@perf`.
- `npx playwright test --grep @perf`: đo nét bút INK-01 (thời gian xử lý, độ trễ sang học sinh, dung lượng), in số đo; cách đọc ở [tablet-wifi.md](tablet-wifi.md).
- Một tệp hoặc một test: `npx playwright test e2e/board/board.spec.ts -g "BOARD-02"`.

Đo thực tế trên máy phát triển (Windows, 2026-10-20, sau khi thêm trang giới thiệu, song ngữ và ghi chú riêng): đầy đủ **55 test, 3,3 phút** (số worker mặc định); smoke **39 test, 2,0 phút** với `CI=1` (2 worker).

### Môi trường do test tự dựng (`e2e/global-setup.ts`)

- Cổng trống ngẫu nhiên, chỉ `127.0.0.1`. Không dùng 5173 hay 8788–8790, không dừng tiến trình có sẵn.
- Máy chủ bảng thử thật (`services/whiteboard-sync/dev/local-board.ts --e2e`): khóa ký ngẫu nhiên, dữ liệu trong thư mục tạm. Tự xóa khi test đóng stdin của nó (trên Windows, kill không chạy được handler dọn).
- Vite `--mode e2e` không tải nóng (HMR) và dùng thư mục đệm thư viện tạm riêng (`E2E_VITE_CACHE`, xóa khi xong). Lý do: một Vite khác chạy cùng thư mục (dev của người dùng, phiên khác) tối ưu lại `node_modules/.vite` giữa chừng, hoặc sửa mã trong lúc chạy, làm trang đang test hỏng (trang trắng, `ERR_ABORTED`).
- Vite `--mode e2e`: **không nạp file môi trường nào**. `VITE_SUPABASE_URL` và `VITE_API_URL` trỏ tới hai cổng loopback do global-setup giữ ("hố chặn" trả 599). Lời gọi chưa được test mock rơi vào đó và làm test đỏ, không bao giờ tới dịch vụ thật.
- Kết thúc: đóng đúng các tiến trình đã tạo; quá 10 giây thì buộc dừng.

### Bảo vệ chung (`e2e/fixtures/test.ts`)

- Mọi yêu cầu HTTP/WebSocket ra ngoài loopback bị chặn và ghi lại; có là test đỏ (BUILD-02).
- `console.error` và lỗi trang được gom lại; lỗi chưa khai báo bằng `allowConsole(/…/)` là test đỏ (UI-03). Chỉ khai báo lỗi có chủ đích của chính test, ví dụ trình duyệt log HTTP 502 trong test lỗi join.
- `fake`: Supabase/API giả, dữ liệu riêng cho từng test (`e2e/fixtures/fake-backend.ts`). Lời gọi không có handler là test đỏ.
- Mỗi test có browser context mới. Test bảng tạo thêm context độc lập bằng `newContext`, được bảo vệ như trên.

### Phần nào giả, phần nào thật

| Thư mục | Cách chạy web | Giới hạn |
|---|---|---|
| `e2e/ui/auth`, `room`, `history` (UI-03), `sessions` (lỗi thời lượng) | Chế độ thật; Supabase Auth/REST và API trả lời bằng route của Playwright | Test **giao diện**: không chứng minh RLS, quyền API hay hợp đồng thật (pytest và RLS kiểm) |
| `e2e/ui/students`, `sessions`, `history` (HIST), `layout` | Chế độ xem trước (`?preview=`, dữ liệu minh họa trong bộ nhớ, chỉ bản dev) | Như trên; lỗi mô phỏng là lỗi cố định của bản xem trước |
| `e2e/ui/reports` | CSV/chọn tháng dùng preview; quyền giao diện/lỗi/retry dùng API giả ở ranh giới HTTP | 3 ca UI; pytest kiểm logic tháng/quyền/lọc/phân trang; `web-report-csv.test.ts` kiểm quote và vô hiệu công thức. Chưa kiểm Supabase/Excel thật |
| `e2e/ui/teaching-notes` | Preview lưu/sửa/chủ đề/xuất, API giả cho student và xung đột revision, chuyển ngôn ngữ thật | 4 ca UI, có 360 px và bảo vệ HTML. Pytest + PostgreSQL/RLS/hai kết nối kiểm quyền và nguyên tử; chưa kiểm PostgREST dịch vụ thật/Excel/tablet |
| `e2e/board` | Trang `/dev/whiteboard` (chỉ bản dev) với `whiteboard-sync` thật | Kết quả đọc từ nội dung bảng của máy nhận (`window.__devBoardApi`, chỉ có ở bản dev; BUILD-01 kiểm bản production không có). Không thay cho bút trên tablet thật |
| `e2e/build` | Build production vào thư mục tạm (`envDir: false`), phục vụ bằng `vite preview` | Không kiểm triển khai thật (Docker, CDN, HTTPS) |

LiveKit không bao giờ được kết nối. Test đối chứng ROOM-01 trỏ tới `ws://127.0.0.1:9` (không có máy chủ) chỉ để chứng minh bộ đếm kết nối hoạt động.

### Đọc kết quả

- Màn hình: mỗi test một dòng `ok`/`x`. Tên test bắt đầu bằng ID trong ma trận (vd. `BOARD-03`).
- Khi lỗi: `apps/web/test-results/<test>/` có `test-failed-*.png`, `trace.zip` (`npx playwright show-trace <đường dẫn>`) và `error-context.md` (cây trợ năng của trang lúc lỗi). Báo cáo HTML: `npx playwright show-report`.
- CI: job `web-e2e` tải `playwright-report` và `test-results` lên artifact khi lỗi, giữ 7 ngày. Artifact chỉ chứa dữ liệu giả; không ghi video.
- Không chạy lại tự động (`retries: 0`): test chập chờn phải được sửa, không bị che.
- Chú thích `known-gap` trong báo cáo: giới hạn đã biết, test ghi lại hành vi hiện tại.

### Thêm test

1. Đặt tệp vào `e2e/ui`, `e2e/board` hoặc `e2e/build`; import `test`, `expect` từ `e2e/fixtures/test`.
2. Tên test bắt đầu bằng ID trong `testing-plan.md`; gắn `@smoke` nếu là P0 và chạy nhanh, `@slow` nếu chờ thời gian thật, `@perf` nếu là phép đo in số liệu.
3. Chờ điều kiện có ý nghĩa (`expect(...)`, `expect.poll`, sự kiện), không dùng sleep cố định. Với bảng, chờ nội dung ở máy nhận.
4. Lỗi console có chủ đích: `allowConsole(/status of 4\d\d/)` hẹp nhất có thể.
5. Sửa lỗi: viết test đỏ trước, sửa tối thiểu, chạy lại.

## Giới hạn đã biết (2026-10-20)

Tính năng chèn ảnh bảng (2026-10-22): [cách dùng và phạm vi kiểm](whiteboard-images.md). `e2e/board/images.spec.ts` kiểm chọn ảnh → đồng bộ hai trang → tải lại, và viewer hiển thị ảnh từ snapshot mới. Máy chủ bảng/WebSocket thật chạy cục bộ; Auth/API/Storage của phép thử xem lại là giả. Lượt riêng dùng `--grep '@smoke|BOARD-IMG' --workers=2` đạt **52/52**, không retry; output/report đặt trong thư mục tạm riêng để tránh hai phiên ghi cùng artifact. Chưa thay thế nghiệm thu tablet hoặc Supabase thật.

- Song ngữ: bản tiếng Anh chưa có người bản ngữ duyệt. Câu lỗi API có tham số vẫn tiếng Việt; dữ liệu người dùng nhập không dịch. Kiểm "không sót chữ tiếng Việt" chỉ áp cho trang giới thiệu và đăng nhập (trang trong ứng dụng có tên học sinh tiếng Việt).

- **Giao diện Excalidraw là tiếng Anh**: gói `vi-VN` của Excalidraw 0.18.1 dịch 49%, dưới ngưỡng 85% nên thư viện bỏ qua `langCode="vi-VN"`. Ảnh dán bị chặn bằng hộp thoại tiếng Anh "Images are disabled.", không có nút đóng. Cần quyết định (vá bản dịch, ẩn bớt giao diện, hoặc chấp nhận); chưa sửa.
- Thư mục `e2e` chưa được typecheck: web chưa có `@types/node`; Playwright chỉ dịch mã, không kiểm kiểu.
- Chỉ Chromium. Chưa chạy Firefox/WebKit (Safari iPad).
- Bút, tì tay, bàn phím ảo, độ trễ trên tablet thật và buổi học 45–60 phút: chỉ nghiệm thu bằng thiết bị thật.
- Supabase/LiveKit thật: chỉ trong nghiệm thu có ủy quyền (`acceptance.md`, `design-video-token.md` mục 9.3).

Nếu Node 24 trong môi trường công cụ lỗi loader tsx (`uv_os_get_passwd`/ENOMEM), có thể gọi `node --experimental-transform-types node_modules/@playwright/test/cli.js test ...`; global-setup chỉ truyền cờ đó cho máy chủ bảng khi người gọi đã bật. Lệnh npm/CI trên Node 22 mặc định vẫn dùng tsx. Đây là lệnh thay thế đã dùng cục bộ, không phải bằng chứng lệnh npm/make chuẩn đạt trong môi trường bị lỗi.

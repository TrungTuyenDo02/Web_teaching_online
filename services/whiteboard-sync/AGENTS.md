# services/whiteboard-sync: Node + WebSocket

Đọc kèm `AGENTS.md` ở thư mục gốc. File này chỉ ghi điều riêng của máy chủ bảng viết.

## Vai trò

Đồng bộ phần tử Excalidraw giữa các thiết bị cùng một buổi học. Nội dung mỗi buổi ghi ra `WHITEBOARD_DATA_DIR/<id>.json` (mặc định `data/boards` ở thư mục gốc) và nạp lại khi mở phòng; trong RAM giữ thêm `WHITEBOARD_ROOM_LINGER_MS` sau khi mọi người rời.

## Bản đồ file

| File | Nội dung |
|------|----------|
| `src/server.ts` | `createBoardServer`, giao thức JSON (mô tả ở đầu file), giới hạn kích thước, kiểm tra Origin, `POST /rooms/:id/close` và `/purge` (xóa học sinh) cho API |
| `src/auth.ts` | `verifyBoardToken` → `BoardClaims`, `verifyCloseToken` (token do `apps/api/app/services/tokens.py` ký) |
| `src/rooms.ts` | `RoomHub`, `Room`, `Peer`: tách phòng theo buổi học |
| `src/scene.ts` | `BoardElement`, `isBoardElement`, `shouldAccept` (gộp theo version) |
| `src/store.ts` | `SceneStore`: đọc/ghi file JSON mỗi buổi (ghi tạm rồi đổi tên), dấu đóng `<id>.ended`; `errorCode` để log lỗi không kèm nội dung |
| `src/config.ts` | `loadConfig` đọc biến môi trường; `loadRootEnv()` nạp `.env` gốc, chỉ `server.ts` gọi khi chạy trực tiếp (import module không đọc file) |
| `dev/local-board.ts` | Máy chủ bảng thử cho trang `/dev/whiteboard` của web (`npm run dev:local`, `make dev-board-local`): `createBoardServer` thật, khóa ngẫu nhiên mỗi lần chạy, chỉ `127.0.0.1:8788`, cấp token thử ở `127.0.0.1:8789/token` (chỉ Origin Vite, phòng `dev-*`), `POST /pause` giả lập máy chủ cắt kết nối, `POST /hang?line=` treo đường truyền của một tab (qua proxy `127.0.0.1:8790`), dữ liệu trong thư mục tạm. `--lan=<IP>` (`make dev-board-lan LAN_IP=`): cấp token và proxy nghe IP nội bộ đó (máy chủ bảng vẫn 127.0.0.1), Origin chỉ `http://IP:cổng web`, mã ghép nối ngẫu nhiên mỗi lần chạy (`pair=`, 401 nếu thiếu/sai) cho mọi lệnh HTTP; `lanError` từ chối IP không nội bộ/không thuộc máy. `--board-port/--token-port/--line-port=0` + `--e2e` (test trình duyệt của web): cổng ngẫu nhiên, in `E2E_READY {json}`, tắt và xóa thư mục tạm khi stdin đóng. Không có trong image Docker |
| `dev/line-proxy.ts` | Proxy TCP thử: treo đường truyền theo `?line=` (không đóng, giữ dữ liệu hai chiều, chuyển nốt hoặc bỏ khi khôi phục). Dùng cho máy chủ thử và `test/heartbeat.test.ts` |
| `test/*.test.ts` | `node:test`, chạy bằng tsx. `client.test.ts` chạy web client (`apps/web/src/lib/boardConnection.ts`) với máy chủ thật. `crash.test.ts` chạy máy chủ trong tiến trình con (`test/fixtures/board-child.ts`) để chứng minh yêu cầu lỗi không làm sập tiến trình. `heartbeat.test.ts` cho đường truyền treo (phát hiện trong hạn, gửi bù, phản hồi muộn của socket cũ, quay lại tab, stop, 4401/4410, pong chỉ sau xác thực); `server-heartbeat.test.ts` cho việc máy chủ tự gỡ kết nối im lặng (gỡ trong hạn, số thiết bị, socket cũ/mới, tab không ping ứng dụng, phòng rỗng/đã kết thúc, đóng lúc kiểm token, tắt máy chủ dọn timer); `local-board.test.ts` cho máy chủ thử; `env-loading.test.ts` chặn mọi lần đọc file môi trường khi import (`test/fixtures/block-env-read.mjs`) |

## Lệnh (chạy từ thư mục gốc)

- `make dev-board` · `make dev-board-local` (máy chủ thử cho `/dev/whiteboard`) · `make dev-board-lan LAN_IP=<IP>` (thử bằng tablet qua Wi-Fi, [docs/tablet-wifi.md](../../docs/tablet-wifi.md)) · `make test-board` · `cd services/whiteboard-sync && npm run typecheck`

## Lưu ý

- Các test helper web (lịch, CSV, ngôn ngữ, xuất ghi chú) cần cả phụ thuộc web (`make install-web`) vì bộ ngôn ngữ hiện có hook React. Job CI board cài cả web và board; không thêm React vào package của máy chủ bảng.

- Đổi claim trong token thì sửa cùng lúc `src/auth.ts` và `apps/api/app/services/tokens.py`, kèm test hai phía.
- Đổi giao thức hoặc giới hạn kích thước tin thì sửa cùng lúc `apps/web/src/lib/boardConnection.ts` (giới hạn lô của web phải nhỏ hơn hẳn giới hạn ở đây).
- Không log nội dung phần tử trên bảng (có thể là bài làm của học sinh).
- Mọi đầu vào trước xác thực phải được bắt lỗi trong handler: mỗi WebSocket có listener `error`, URL giải mã trong `try`. Không dùng `uncaughtException` toàn cục để che lỗi. Lỗi kiểu này test bằng tiến trình con (`crash.test.ts`), vì test cùng tiến trình không thấy tiến trình chết.
- Import `src/config.ts`/`src/server.ts` không đọc `.env` (có test). Đừng thêm lời gọi `loadRootEnv()` ở cấp module; điểm khởi động mới thì tự gọi. Lệnh `make test`/`make build-web` vẫn có thể đụng file môi trường ở chỗ khác (Vite nạp `apps/web/.env*`, API nạp `.env` khi gọi `get_settings`): khi không được đọc bí mật, chạy trên bản sao chỉ chứa mã nguồn (file `git ls-files -co --exclude-standard`).
- Học sinh chỉ xem: `update` từ token `role` khác `teacher` bị bỏ qua (quyết định 14).
- Heartbeat (quyết định 21): sau xác thực, máy chủ trả `{type:"pong", n}` cho `{type:"ping", n}` (chỉ số thứ tự). Ping trước xác thực bị đóng 4401 như mọi tin khác. Riêng máy chủ ping khung điều khiển WebSocket mỗi `heartbeatMs` (mặc định 15 s, test truyền ngắn hơn qua `Config`); một chu kỳ không có pong hay tin nào thì `terminate()`, handler `close` gỡ khỏi phòng. Không dựa vào ping ứng dụng (tab nền bị hoãn timer). Kết nối đóng trong lúc chờ kiểm token thì không vào phòng.

# services/whiteboard-sync: Node + WebSocket

Đọc kèm `AGENTS.md` ở thư mục gốc. File này chỉ ghi điều riêng của máy chủ bảng viết.

## Vai trò

Đồng bộ phần tử Excalidraw giữa các thiết bị cùng một buổi học. Không lưu xuống đĩa: nội dung phòng giữ trong RAM thêm `WHITEBOARD_ROOM_LINGER_MS` sau khi mọi người rời để nối lại khi rớt mạng.

## Bản đồ file

| File | Nội dung |
|------|----------|
| `src/server.ts` | `createBoardServer`, giao thức JSON (mô tả ở đầu file), giới hạn kích thước, kiểm tra Origin |
| `src/auth.ts` | `verifyBoardToken` → `BoardClaims` (token do `apps/api/app/services/tokens.py` ký) |
| `src/rooms.ts` | `RoomHub`, `Room`, `Peer`: tách phòng theo buổi học |
| `src/scene.ts` | `BoardElement`, `isBoardElement`, `shouldAccept` (gộp theo version) |
| `src/config.ts` | `loadConfig` đọc `.env` gốc |
| `test/*.test.ts` | `node:test`, chạy bằng tsx |

## Lệnh (chạy từ thư mục gốc)

- `make dev-board` · `make test-board` · `cd services/whiteboard-sync && npm run typecheck`

## Lưu ý

- Đổi claim trong token thì sửa cùng lúc `src/auth.ts` và `apps/api/app/services/tokens.py`, kèm test hai phía.
- Đổi giao thức thì sửa cùng lúc `apps/web/src/hooks/useBoardSync.ts`.
- Không log nội dung phần tử trên bảng (có thể là bài làm của học sinh).

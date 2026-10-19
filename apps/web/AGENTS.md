# apps/web: React + TypeScript + Vite

Đọc kèm `AGENTS.md` ở thư mục gốc. File này chỉ ghi điều riêng của web.

## Vai trò

Đăng nhập (Supabase Auth), danh sách buổi học, phòng học gồm video (LiveKit) và bảng viết (Excalidraw đồng bộ qua `whiteboard-sync`). Đọc dữ liệu trực tiếp từ Supabase trong giới hạn RLS; thao tác nhạy cảm đi qua API.

## Bản đồ file

| File | Nội dung |
|------|----------|
| `src/main.tsx`, `src/App.tsx` | Khởi động, định tuyến, `RequireAuth` |
| `src/auth/AuthProvider.tsx` | `AuthProvider`, `useAuth` |
| `src/lib/env.ts` | Biến `VITE_*` (chỉ biến công khai) |
| `src/lib/supabase.ts` | Client Supabase (có thể `null` khi chưa cấu hình) |
| `src/lib/api.ts` | `apiFetch`, `joinSession`, `endSession`, kiểu `JoinResponse` (khớp `apps/api/app/models.py`) |
| `src/pages/` | `LoginPage`, `DashboardPage`, `RoomPage` |
| `src/components/VideoPanel.tsx` | Nơi duy nhất dùng LiveKit ở web |
| `src/components/Whiteboard.tsx` | Excalidraw: chỉnh bút, chặn chạm nhầm ở đây |
| `src/hooks/useBoardSync.ts` | Giao thức WebSocket với `services/whiteboard-sync` |
| `src/brand.ts`, `src/styles.css` | Tên, màu thương hiệu |

## Lệnh (chạy từ thư mục gốc)

- `make dev-web` · `cd apps/web && npm run typecheck` · `make build-web`
- Chưa có test tự động cho web: kiểm bằng typecheck, build và thử tay. Nói rõ phần nào chưa thử tay.

## Lưu ý

- Không đặt khóa bí mật trong web (hook chặn khi thấy tên khóa bí mật trong `apps/web`).
- Đổi giao thức bảng viết thì sửa cùng lúc `useBoardSync.ts` và `services/whiteboard-sync/src/server.ts`.
- Vùng chạm ≥ 44 px, kiểm trên khổ tablet và điện thoại; mọi chuỗi hiển thị bằng tiếng Việt.

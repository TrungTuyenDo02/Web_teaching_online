# Tiến độ

Sổ bàn giao giữa các phiên làm việc. Hook `SessionStart` in file này cho Claude Code mỗi lần mở; hook `Stop` nhắc cập nhật khi có code thay đổi mà file này chưa được sửa. Cách ghi: xem `docs/AGENTS.md`.

## Giai đoạn hiện tại

Giai đoạn 1: phòng học, bảng viết, buổi học.

## Đang làm

(trống)

## Việc tiếp theo (Giai đoạn 1, theo thứ tự)

1. Thử bút Android trên bảng viết Excalidraw (độ trễ, chặn tay chạm nhầm); chỉnh `apps/web/src/components/Whiteboard.tsx` theo kết quả. Cần người thử trên tablet thật.
2. Màn hình giáo viên: tạo học sinh, tạo buổi học (ghi vào `students`, `sessions` qua Supabase với RLS).
3. Lưu ảnh bảng cuối buổi vào bucket `boards` và gắn vào `sessions.board_snapshot_path`.
4. Tác vụ đặt `no_show` cho buổi quá giờ không ai vào.
5. Chặn vào phòng nếu học sinh chưa có `consent_at` (nếu giáo viên xác nhận muốn bật).

## Chưa thử với dịch vụ thật

- Supabase thật, LiveKit thật, bút trên tablet Android.

## Nhật ký (mới nhất ở trên)

- 2026-10-19: Thêm `AGENTS.md`/`CLAUDE.md` cho từng mục (`apps/api`, `apps/web`, `services/whiteboard-sync`, `supabase`, `docs`), sổ tiến độ này và hook Claude Code trong `.claude/`. Không đổi code ứng dụng.
- Trước đó: bộ khung Giai đoạn 1 (API 13 test, whiteboard-sync 14 test, RLS kiểm trên PostgreSQL 16, web build và typecheck đạt). Chi tiết ở `README.md`.

# Hoàn thiện bàn giao Giai đoạn 1

> Thực hiện tuần tự trong workspace hiện tại. Chủ dự án yêu cầu hoàn thiện GĐ1, ít code và chưa chạy thử; không khởi chạy dịch vụ/thiết bị hoặc nghiệm thu Cloud. Không commit.

**Goal:** Chốt phần chuẩn bị của phòng học/bảng/buổi học, để lần nghiệm thu sau làm theo một thứ tự rõ ràng.

**Architecture:** Giữ web/API/máy chủ bảng/Supabase/LiveKit hiện có; dùng cơ chế finalize, retry và dọn dữ liệu sẵn có. Lỗi token video vẫn mở; không thay kiến trúc hoặc đánh dấu an toàn khi chưa có bằng chứng.

**Tech Stack:** React, FastAPI, Node/ws, Supabase, LiveKit; không thêm dependency/migration.

**Spec:** Yêu cầu chủ dự án 2026-10-22 và phạm vi GĐ1 trong `AGENTS.md`; căn cứ `docs/progress.md`, `docs/acceptance.md`, `docs/design-video-token.md`.

## Constraints and rulings

- Lần này chỉ hoàn thiện hướng dẫn và kế hoạch vận hành; phần chức năng chính đã có code/test từ các lần trước. Không đọc file môi trường hay sửa cấu hình đang chạy.
- Không tự chốt thời hạn backup, lưu dữ liệu đã xóa, phương án thu hồi token mới hoặc triển khai production.
- Phần chưa chạy thử giữ trạng thái chờ; test cũ không phải kết quả kiểm lần này. Backlog duy nhất vẫn là `docs/progress.md`.

## Review focus

- Không hướng dẫn áp lại 0001–0010; không bắt 0011 làm điều kiện cho bảng ảnh GĐ1.
- Không hướng dẫn xóa volume bảng hoặc quay lui API làm mất files trong snapshot v2.
- Không hứa tự retry khi tác vụ nền đang tắt; không coi giảm TTL một mình là đóng lỗi token.
- Không coi bản sao DB là bản sao đủ tệp Storage; phục hồi phải xử lý lại yêu cầu xóa.

## Các bước đã thực hiện

- [x] Đối chiếu phạm vi chức năng GĐ1, thay đổi đang có và sổ bàn giao; giữ nguyên code của các phiên khác.
- [x] Soạn runbook khởi động/kết thúc/khôi phục lỗi/nâng cấp/sao lưu tại `docs/operations.md`.
- [x] Cập nhật acceptance: schema hiện tại, ảnh bảng và dữ kiện token đã có, các mục chờ thử.
- [x] Nối README/kiến trúc/sổ bàn giao; ghi rõ phần đã chuẩn bị và phần còn mở.
- [x] Kiểm diff, đường dẫn tài liệu và giới hạn phạm vi; không chạy test sản phẩm theo yêu cầu hiện tại.

## Các cổng còn chờ sau bàn giao

- [ ] Chốt và triển khai cơ chế sửa lỗi token video, kiểm cục bộ rồi xác minh Cloud riêng.
- [ ] Nghiệm thu ảnh/bảng/video/quyền/kết thúc/xem lại/xóa bằng dữ liệu thử.
- [ ] Buổi tablet 45–60 phút, backup/restore và CI trước pilot.

Các cổng trên chưa hoàn thành; không đánh dấu GĐ1 sẵn sàng dạy thật. OCR, M1b.2 và mở rộng GĐ2/GĐ3 không thuộc lần hoàn thiện này.

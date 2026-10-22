# Chèn ảnh đề bài lên bảng

Trong phòng học (hoặc trang thử `/dev/whiteboard`), giáo viên chờ **Bảng đã kết nối**, bấm **Chèn ảnh đề bài**, rồi chọn ảnh từ laptop/tablet. Ảnh xuất hiện giữa vùng bảng đang nhìn; dùng công cụ chọn để kéo, đổi kích thước và dùng bút viết lên ảnh. Học sinh nhận cả ảnh lẫn nét viết. Nút này chỉ dành cho giáo viên; ảnh phải được tải xong trước khi xuất hiện trên bảng.

Nhận JPEG, PNG hoặc WebP, tối đa 10 MiB đầu vào. Trình duyệt vẽ lại ảnh để bỏ metadata, thu cạnh dài về tối đa 2560 px. Ảnh sau xử lý tối đa 2 MiB; mỗi phòng tối đa 20 ảnh và tổng 6 MiB. Hãy cắt phần đề cần dùng nếu ảnh bị từ chối vì quá lớn. Bản đầu chưa hỗ trợ PDF, ảnh động hoặc ảnh lấy qua URL. Dùng nút chèn ảnh thay cho kéo thả/dán từ clipboard.

Ảnh đã chèn được giữ khi tải lại/nối lại bảng. Kết thúc buổi bằng luồng hiện có để lưu cả ảnh và nét viết; giáo viên/học sinh có quyền với buổi học xem lại tại **Xem lại bảng**. Ảnh nằm trong snapshot ở bucket riêng tư `boards`, không có URL công khai, không gửi AI. Xóa hẳn học sinh dùng cùng luồng dọn bảng/snapshot hiện có. Xóa một ảnh trên bảng không giải phóng hạn mức phòng ngay; tệp vẫn được giữ để hỗ trợ hoàn tác.

## Lưu trữ và tương thích

Máy chủ bảng nhận ảnh theo mảnh trên WebSocket đã xác thực, kiểm kiểu/kích thước/nội dung và tính SHA256 làm ID, ghi bền tệp trước ACK. Tệp nằm riêng trong `<session>.images/` cạnh dữ liệu nét; không gửi lại base64 theo mỗi nét bút. Máy nhận kiểm hash và nạp tệp trước khi hiển thị phần tử ảnh. Purge xóa cả thư mục ảnh.

Snapshot có ảnh dùng `{version:2,elements,files}`; snapshot cũ dạng mảng vẫn đọc được. API kiểm đủ tệp và hạn 20 MiB rồi lưu bằng upload intent/đường dẫn Storage hiện có. Không cần migration hoặc thư viện mới. Nâng cấp đồng bộ web, API và máy chủ bảng; web chỉ bật nút khi máy chủ công bố hỗ trợ ảnh.

## Kiểm tra

- Server/client: `services/whiteboard-sync/test/images.test.ts`, `web-board-files.test.ts` kiểm tải/nhận/nối lại/restart, phân quyền phòng, tệp lỗi, hash, đóng và purge.
- API: `apps/api/tests/test_board_images.py` kiểm close/finalize/Repository giữ đủ tệp và từ chối snapshot thiếu/quá lớn.
- Trình duyệt: `apps/web/e2e/board/images.spec.ts` kiểm chọn ảnh, đồng bộ hai trang, tải lại và **Xem lại bảng** bằng Storage giả.

Đã kiểm cục bộ; chưa nghiệm thu chèn ảnh trên tablet thật hoặc lưu/xem lại qua Supabase thật. Trang thử LAN chỉ dùng dữ liệu tạm, không thay thế buổi học được lưu trên Supabase.

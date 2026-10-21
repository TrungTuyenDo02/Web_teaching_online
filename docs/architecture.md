# Kiến trúc

Modular monolith cộng dịch vụ có sẵn: một API nhỏ, một máy chủ bảng viết nhỏ, còn lại dùng dịch vụ quản lý (Supabase, LiveKit). Phù hợp khi một người tự vận hành và muốn chi phí thấp. Sơ đồ ở [flows.md](flows.md).

## Thành phần

| Thành phần | Công nghệ | Việc làm | Giữ bí mật nào |
|---|---|---|---|
| Web | React 19, TypeScript, Vite | Giao diện thương hiệu riêng cho giáo viên và học sinh | Chỉ khóa anon Supabase |
| API | FastAPI, PyJWT, livekit-api | Kiểm tra quyền vào phòng, cấp token LiveKit và bảng viết, điểm danh, kết thúc buổi học | Service role Supabase, LiveKit secret, khóa ký bảng viết |
| Máy chủ bảng viết | Node, ws, jose | Đồng bộ nét vẽ Excalidraw theo buổi học | Khóa kiểm tra token bảng viết |
| Dữ liệu | Supabase (PostgreSQL, Auth, Storage) | Hồ sơ, buổi học, bài tập, ảnh bài làm; RLS chặn truy cập chéo | |
| Video | LiveKit | Camera, micro (WebRTC) | |
| Bot trợ giúp | OpenAI Responses qua httpx ở API; PostgreSQL full-text RAG | Tool chỉ đọc hướng dẫn/bài giảng đúng quyền; tắt mặc định, không lưu transcript; chưa đo model thật | Khóa OpenAI chỉ ở API |
| AI (GĐ3) | Chưa chọn | Gợi ý chấm, giáo viên duyệt | Khóa API của nhà cung cấp |

## Ranh giới tin cậy

- Trình duyệt không bao giờ được tin. Quyền đọc dữ liệu do RLS quyết định ở cơ sở dữ liệu. Các thao tác nhạy cảm (vào phòng, điểm danh, kết thúc buổi) đi qua API, không ghi trực tiếp từ trình duyệt.
- API dùng khóa service role nên bỏ qua RLS: mọi kiểm tra quyền phải nằm trong code API (`_load_session_for_member`) và có test.
- Bot chỉ cho model đề xuất truy vấn tìm kiếm. Actor/vai trò lấy từ phiên và profiles, không nhận từ tool args. RPC 0010 chỉ service_role được gọi, lọc bài giảng trước khi gửi provider; kiểm lại nguồn sau khi sinh câu trả lời. Không gửi ghi chú riêng/hồ sơ tự động. Cấu hình, dữ liệu và giới hạn: [assistant.md](assistant.md).
- Token bảng viết sống ít nhất 2 giờ theo cấu hình mặc định, được kéo dài tới hết khung giờ vào phòng nếu cần, mang theo id buổi học; máy chủ bảng viết chỉ cho kết nối vào đúng phòng đó. Dấu đóng/xóa lưu trên đĩa chặn token cũ sau khi kết thúc, kể cả khi khởi động lại máy chủ bảng.
- Token video cũng lấy thời hạn lớn hơn giữa cấu hình (mặc định 2 giờ) và thời gian còn lại tới hết khung giờ vào phòng. Một lần thu hồi chưa chặn được toàn bộ thời hạn token trên Cloud; lỗi còn mở, xem [design-video-token.md](design-video-token.md) mục 9.3. Chưa áp dụng hướng sửa mới.

## Dữ liệu và lưu giữ

- Ảnh bài làm: bucket `submissions` (riêng tư), đường dẫn `<student_id>/<submission_id>/<tên file>`.
- Snapshot JSON của bảng cuối buổi: bucket `boards`, cùng quy ước thư mục theo `student_id`. PNG là bản tải thủ công trên giao diện.
- Thời gian lưu giữ cấu hình bằng `SUBMISSION_RETENTION_DAYS` (chưa có tác vụ thực thi, cần làm trước khi dùng với dữ liệu thật).

## Mở rộng

- Học sinh tăng: video là khoản chi chính. Đổi gói LiveKit hoặc tự dựng LiveKit (mã nguồn mở) mà không đổi giao diện, vì token do API cấp.
- Máy chủ bảng viết chạy một tiến trình, giữ phòng đang hoạt động trong bộ nhớ và lưu scene định kỳ ra `data/boards`, kèm dấu đóng/xóa trên đĩa để phục hồi sau khởi động lại. Nếu cần chạy nhiều tiến trình thì phải thiết kế đồng bộ/lưu trữ dùng chung; hiện chưa thêm Redis hay dịch vụ mới.

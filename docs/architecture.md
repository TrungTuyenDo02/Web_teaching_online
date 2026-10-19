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
| AI (GĐ3) | Chưa chọn | Gợi ý chấm, giáo viên duyệt | Khóa API của nhà cung cấp |

## Ranh giới tin cậy

- Trình duyệt không bao giờ được tin. Quyền đọc dữ liệu do RLS quyết định ở cơ sở dữ liệu. Các thao tác nhạy cảm (vào phòng, điểm danh, kết thúc buổi) đi qua API, không ghi trực tiếp từ trình duyệt.
- API dùng khóa service role nên bỏ qua RLS: mọi kiểm tra quyền phải nằm trong code API (`_load_session_for_member`) và có test.
- Token bảng viết sống ngắn (mặc định 2 giờ), mang theo id buổi học; máy chủ bảng viết chỉ cho kết nối vào đúng phòng đó.

## Dữ liệu và lưu giữ

- Ảnh bài làm: bucket `submissions` (riêng tư), đường dẫn `<student_id>/<submission_id>/<tên file>`.
- Ảnh bảng cuối buổi: bucket `boards`, cùng quy ước thư mục theo `student_id`.
- Thời gian lưu giữ cấu hình bằng `SUBMISSION_RETENTION_DAYS` (chưa có tác vụ thực thi, cần làm trước khi dùng với dữ liệu thật).

## Mở rộng

- Học sinh tăng: video là khoản chi chính. Đổi gói LiveKit hoặc tự dựng LiveKit (mã nguồn mở) mà không đổi giao diện, vì token do API cấp.
- Máy chủ bảng viết giữ nội dung trong bộ nhớ và chỉ chạy một tiến trình. Nếu cần chạy nhiều tiến trình hoặc không mất bảng khi khởi động lại, thêm Redis hoặc lưu snapshot định kỳ.

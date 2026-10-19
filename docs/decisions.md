# Các quyết định thiết kế

Mỗi quyết định ghi lý do và điều gì khiến phải xem lại.

## 1. Bảng viết đồng bộ thay cho chia sẻ màn hình tablet

- **Quyết định:** tablet là thiết bị viết trong web app; nét vẽ truyền dưới dạng dữ liệu. Laptop giữ camera và micro.
- **Lý do:** tài liệu của Twilio nói trình duyệt di động không hỗ trợ API chia sẻ màn hình; Discord mặc định chỉ 720p 30 FPS nên chữ viết tay dễ mờ. Nét vẽ dạng dữ liệu luôn sắc nét và dùng ít băng thông.
- **Xem lại nếu:** thử bút trên tablet Android cho kết quả không dùng được (độ trễ, chặn tay chạm nhầm). Khi đó cân nhắc app Android riêng có chia sẻ màn hình, tốn công hơn nhiều.
- **Việc cần làm trước:** thử bút trên đúng chiếc tablet.

## 2. Excalidraw cho bảng viết

- **Quyết định:** dùng `@excalidraw/excalidraw` (giấy phép MIT, không cần license key, không watermark) và tự dựng đồng bộ (`services/whiteboard-sync`).
- **Lý do:** muốn thương hiệu riêng, không có watermark của bên thứ ba. tldraw dùng production cần license key và bản miễn phí buộc hiện chữ "made with tldraw".
- **Đánh đổi:** tự dựng và bảo trì phần đồng bộ. Excalidraw mặc định vẽ kiểu nguệch ngoạc, nên giao diện đặt `currentItemRoughness: 0` cho môn Toán.
- **Xem lại nếu:** đồng bộ gặp lỗi khó (hoàn tác nhiều người, mất mạng) tốn nhiều công, thì thử tldraw sync.

## 3. LiveKit cho video, đổi được

- **Quyết định:** LiveKit; mọi chỗ gọi nằm ở `services/tokens.py` (API) và `VideoPanel.tsx` (web).
- **Lý do:** mã nguồn mở và tự dựng được, có SDK Python cho phần AI sau này. Gói Build miễn phí 5.000 phút, gói Ship 50 USD/tháng có 150.000 phút (xác nhận lại trên trang giá trước khi dùng).
- **So với Daily:** Daily có 10.000 phút miễn phí rồi 0,004 USD/phút, rẻ hơn khi dưới khoảng 23 học sinh (mỗi học sinh 8 buổi, 60 phút, 2 người trong phòng), đắt hơn khi nhiều hơn.
- **Xem lại nếu:** cần làm nhanh nhất với ít học sinh thì Daily đơn giản hơn.

## 4. Tablet chế độ `board` không vào phòng video

- **Lý do:** tránh tiếng vọng khi hai thiết bị cùng bật micro, và không bị tính thêm phút video.
- **Cách làm:** API trả `livekit: null` khi `mode=board`.

## 5. API là nơi cấp quyền, RLS là lớp bảo vệ cuối

- Các thao tác nhạy cảm đi qua API dùng service role và kiểm tra quyền trong code (có test).
- Trình duyệt chỉ đọc trực tiếp từ Supabase những gì RLS cho phép.
- API trả 404 thay vì 403 cho buổi học không thuộc về người gọi.

## 6. Vai trò lấy từ bảng `profiles`

- Không tin claim vai trò trong JWT. Người dùng mới đăng ký mặc định là học sinh; giáo viên được nâng quyền thủ công.
- Policy `profiles_update_own` chặn người dùng tự đổi `role` (đã kiểm thử).

## 7. Xác thực JWT bằng HS256

- Hiện dùng chuỗi bí mật JWT của Supabase. Dự án Supabase mới có thể dùng khóa bất đối xứng; khi đó đổi sang JWKS ở `apps/api/app/auth.py`.

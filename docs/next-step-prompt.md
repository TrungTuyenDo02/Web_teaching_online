# Prompt làm tiếp: nghiệm thu bảng trên tablet thật

Soạn ngày 2026-10-20 sau khi đối chiếu cấu trúc, code và sổ bàn giao. Sao chép nội dung dưới đây sang phiên làm việc tiếp theo.

```text
Tiếp tục dự án gia-su-online ở bước thử bảng trên laptop và tablet Android thật cùng Wi-Fi.

Đầu phiên đọc AGENTS.md gốc, docs/progress.md, docs/tablet-wifi.md, docs/acceptance.md và AGENTS.md ở các thư mục liên quan. Kiểm tra git status/diff, giữ nguyên mọi thay đổi có sẵn. docs/claude-code-plan.md và assessment-and-plan.md có các mục lịch sử đã cũ; đối chiếu code và progress, không lấy các mục đó làm backlog hiện tại.

Hiện trạng:
- Giai đoạn 1 đã có quản lý học sinh/buổi học, video, tablet chỉ bảng, lưu/xem lại bảng, retry kết thúc và xóa học sinh, heartbeat/reconnect, CI RLS trong cấu hình.
- Trang /dev/whiteboard và hai lệnh dev-board-lan/dev-web-lan đã có; không xây lại môi trường thử. Đã kiểm bằng Chrome headless và test giao thức, chưa nghiệm thu tablet/bút/Wi-Fi thật. Checklist 16 mục trong docs/tablet-wifi.md còn trống.
- Theo lần kiểm gần nhất, Supabase thật mới áp đến 0003; 0004–0007 chưa áp. Token video cũ vào lại sau khi kết thúc vẫn là lỗi mở. Hai việc này độc lập với lần thử bảng Wi-Fi không cần Supabase/API/LiveKit.

Mục tiêu phiên này: giúp tôi chạy và ghi kết quả thử bảng bằng thiết bị thật, rồi xử lý lỗi có bằng chứng trong phạm vi đó.

1. Đọc code liên quan và trình bày kế hoạch ngắn. Kiểm tra chỉ đọc IP Wi-Fi hiện tại, cổng 5173/8788/8789/8790 và tiến trình đang dùng cổng. Không mặc định IP vẫn là 192.168.1.9, không lấy IP WSL/Hyper-V. Không dừng tiến trình đang có của tôi. Nếu không xác định được card Wi-Fi thì hỏi thông tin còn thiếu.
2. Chọn WEB_PORT còn trống, dùng cùng IP/cổng cho hai lệnh:
   make dev-board-lan LAN_IP=<IP_WIFI> WEB_PORT=<PORT>
   make dev-web-lan LAN_IP=<IP_WIFI> WEB_PORT=<PORT>
   Tự khởi động môi trường thử khi công cụ cho phép, hoặc đưa đúng lệnh để tôi chạy. Nếu make/tsx lỗi môi trường, báo nguyên nhân và dùng lệnh thành phần tương đương trong phạm vi an toàn; không đổi package/framework để né lỗi. Giữ --mode lan không nạp file môi trường. Kiểm tra địa chỉ lắng nghe, đưa URL chính xác và chỉ chỗ lấy mã ghép nối.
3. Hướng dẫn tôi mở URL trên hai máy: tablet là giáo viên, laptop là học sinh, cùng dev-1. Đi checklist theo nhóm nhỏ: kết nối/viết/tì tay; cuộn/tẩy/xoay; mất Wi-Fi/gửi bù/khóa màn hình/đổi ứng dụng; PNG/đổi vai trò/treo 40 giây; dùng liên tục 45–60 phút. Thu thông tin thiết bị và kết quả tôi quan sát trước khi ghi Đạt/Không đạt. Mục chưa làm để Chưa thử. Không suy diễn thử headless thành thử bút thật; BroadcastChannel chỉ xác nhận tab cùng trình duyệt, hai máy phải nhìn nét trực tiếp.
4. Nếu lỗi, phân biệt web, token, WebSocket hay bút/giao diện. Ghi thao tác tái hiện, kết quả mong đợi/thực tế và thời gian. Với lỗi tái hiện tự động được, viết test đỏ trước khi sửa, sửa tối thiểu rồi kiểm lại. Với lỗi chỉ thấy trên thiết bị thật, ghi rõ giới hạn test tự động và nhờ tôi thử lại bản sửa. Không tự sửa vì nghi ngờ khi chưa có bằng chứng.
5. Tuân thủ giới hạn: chỉ dữ liệu giả; không đọc/in/sửa file bí mật; không tự đổi firewall, network profile hay chứng chỉ; không mở 0.0.0.0/tunnel/Internet; không ghi Supabase/LiveKit thật, áp migration, commit hoặc push trong tác vụ này. Giữ mặc định local, giới hạn IP/Origin/phòng dev-*, mã ghép nối ngẫu nhiên và trang thử chỉ development. Không mở Giai đoạn 2/3 hoặc tự chọn kiến trúc sửa token video.
6. Nếu sửa code, chạy make test, make lint, make build-web; bảo đảm công cụ không đọc file bí mật (dùng bản sao mã nguồn không chứa bí mật khi cần). Lệnh lỗi môi trường thì ghi rõ lệnh chuẩn, lệnh thay thế và kết quả thật. Cập nhật kết quả vào docs/tablet-wifi.md, tóm tắt đúng phạm vi vào docs/acceptance.md và docs/progress.md; đổi luồng thì sửa docs/flows.md. Thử xong dừng các tiến trình do phiên này tạo.

Kết thúc báo ngắn: kết quả thiết bị thật, lỗi đã sửa, kiểm tra thực chạy, mục chưa thử và bước tiếp theo. Bảng Wi-Fi đạt chưa có nghĩa toàn bộ Giai đoạn 1 đạt; sau đó mới chuẩn bị áp 0004–0007 theo acceptance và nghiệm thu tích hợp khi có quyền tương ứng. Nếu tôi chưa có tablet sẵn, hoàn tất phần chuẩn bị, ghi Chưa thử và bàn giao; không tự đánh dấu nghiệm thu đạt hay chuyển sang tính năng khác.
```

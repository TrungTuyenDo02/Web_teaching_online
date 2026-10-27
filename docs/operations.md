# Vận hành phòng học Giai đoạn 1

Đây là hướng dẫn đã chuẩn bị, **chưa chạy nghiệm thu**. Chủ dự án yêu cầu hoãn chạy thử ngày 2026-10-22. Trạng thái và việc tiếp theo vẫn ở [progress.md](progress.md); ca thử nằm trong [acceptance.md](acceptance.md). Lỗi token video còn mở nên chưa dùng cho pilot với học sinh thật.

## 1. Chuẩn bị trước khi bật môi trường

| Mục | Điều kiện |
|---|---|
| Schema | 0001–0010 đã áp theo sổ; không chạy lại. 0011 chỉ cho bài tập M2.1, không cần cho ảnh bảng |
| Phiên bản | Nâng web, API và máy chủ bảng cùng phiên bản hỗ trợ snapshot ảnh v2 |
| Dữ liệu bảng | Giữ nguyên thư mục `WHITEBOARD_DATA_DIR`; Docker dùng volume `board-data` ở `/srv/data` |
| Đường kết nối | Web dùng URL công khai; API đóng/purge qua URL nội bộ; Origin phải khớp địa chỉ web |
| Tác vụ nền | `NO_SHOW_INTERVAL_SECONDS` mặc định 300; bằng 0 là tắt retry/dọn/sinh lịch nền, không dùng như chế độ vận hành bình thường |
| AI | Không cần bật AI/OCR để dạy, viết hoặc chèn ảnh; OCR tiếp tục hoãn |

Không chép bí mật vào log, ảnh chụp màn hình hoặc tài liệu bàn giao. Không sửa cấu hình đang chạy khi có buổi học. Môi trường LAN `/dev/whiteboard` chỉ là bảng thử tạm, không lưu lên Supabase và không thay phòng học có đăng nhập.

## 2. Khởi động và dừng

Khi đến lúc chạy thử, trên môi trường đã cấu hình:

1. Đối chiếu schema với sổ đã áp; không áp lại migration chỉ vì một probe lỗi. Nếu schema không khớp, dừng để xác định nguyên nhân.
2. Chạy máy chủ bảng trước (`make dev-board`), rồi API (`make dev-api`), rồi web (`make dev-web`) bằng các terminal riêng. Đây là lệnh development, không phải cấu hình hosting production.
3. Chạy `python -m app.preflight` từ `apps/api` bằng Python của venv. Preflight kiểm kết nối/cấu hình, không chứng minh quyền RLS hoặc toàn luồng đã đạt.
4. Thực hiện ca thử được ghi trong acceptance với tài khoản thử. Laptop vào phòng chính; tablet dùng **Dùng tablet**, không nối video.
5. Kết thúc bằng nút **Kết thúc**, xử lý **Còn việc chờ** nếu có, kiểm bảng đã lưu rồi mới dừng dịch vụ. Khởi động lại không thay cho kết thúc buổi.

Địa chỉ IP của laptop có thể đổi khi đổi Wi-Fi: chạy lại chế độ LAN bằng IP hiện tại và nhập mã ghép nối mới. Phòng học production cần địa chỉ HTTPS/WSS ổn định đã được triển khai; chưa chốt hosting trong lần này.

### 2b. Thử với người ở mạng khác qua Cloudflare quick tunnel (chưa có VPS)

Một địa chỉ HTTPS tạm `https://<tên>.trycloudflare.com` trỏ vào `vite preview` (bản build), `/api` và `/board` (WebSocket) đi qua proxy của preview tới API và máy chủ bảng trên laptop (`vite.config.ts`, chế độ `tunnel`). Có HTTPS nên camera/micro dùng được trên điện thoại; LiveKit và Supabase vẫn là dịch vụ Cloud. Không cần tài khoản Cloudflare. Hạn chế: địa chỉ đổi mỗi lần chạy lại, laptop phải bật suốt buổi, không có cam kết ổn định; chỉ để thử ngắn, không thay hosting.

Cài một lần: `winget install --id Cloudflare.cloudflared`. Cổng 8000 trên máy này đang bị dự án khác dùng nên API chạy cổng 8010. Bốn cửa sổ PowerShell, từ thư mục gốc dự án:

```powershell
# 1. Tunnel: chép địa chỉ https://....trycloudflare.com in ra
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4173

# 2. Máy chủ bảng (thay <URL> bằng địa chỉ ở bước 1, không có / ở cuối)
cd services/whiteboard-sync; $env:CORS_ORIGINS = "<URL>"; npm run dev

# 3. API: bảng đi qua /board của cùng địa chỉ
cd apps/api; $env:CORS_ORIGINS = "<URL>"; $env:WHITEBOARD_PUBLIC_URL = "<URL>/board" -replace '^https', 'wss'
.venv\Scripts\uvicorn app.main:app --port 8010

# 4. Web: build chế độ tunnel rồi phục vụ ở 127.0.0.1:4173
make tunnel-web
```

Kiểm nhanh: mở `<URL>` trên điện thoại bằng 4G (không cùng Wi-Fi), đăng nhập, vào phòng; bảng phải báo đã kết nối. Biến đặt bằng `$env:` chỉ sống trong cửa sổ đó, không sửa file môi trường. Preview chỉ nhận host `*.trycloudflare.com`/localhost; máy chủ bảng chặn Origin khác `<URL>`. Tắt tunnel (Ctrl+C ở cửa sổ 1) là địa chỉ hết dùng được; nhớ kết thúc buổi trước khi tắt API/bảng.

## 3. Xử lý lỗi thường gặp

| Dấu hiệu | Làm trước | Điều kiện dừng/chưa được coi là xong |
|---|---|---|
| Vào phòng báo 502 | Kiểm LiveKit và preflight; thử lại khi dịch vụ phục hồi | Đổi auto-create không sửa được lỗi CreateRoom của API |
| Tablet mất kết nối | Giữ tab, kiểm mạng; chờ tự nối/gửi bù | Không xóa dữ liệu trang hoặc khởi động lại máy chủ khi còn nét chưa xác nhận |
| Chèn ảnh lỗi | Giữ ảnh gốc; chọn JPEG/PNG/WebP qua nút riêng; cắt phần đề nếu vượt hạn | Không đưa URL ngoài/base64 thủ công vào scene; ảnh chưa ACK chưa được coi là đã lưu |
| Kết thúc báo còn việc chờ | Dùng **Thử lại ngay**; giữ dữ liệu bảng và để API/bảng hoạt động | `finalized_at`/snapshot chưa hoàn tất; không sửa trực tiếp DB để bỏ cảnh báo |
| Tắt vòng lặp nền để debug | Khi xong debug, lập lịch bật lại cấu hình vận hành và restart API lúc không có buổi | Khi bằng 0, thông báo tự thử lại không đồng nghĩa tác vụ nền đang chạy |
| Xóa học sinh còn dở | Dùng **Xóa tiếp** hoặc retry nền hiện có | Không xóa tay hàng DB để làm mất dấu việc cần dọn; không xóa thư mục học sinh khác |
| Token video cũ vào lại | Giữ lỗi mở, ghi thời điểm/ID kỹ thuật, xem thiết kế token | Xóa phòng hoặc giảm TTL cấu hình riêng lẻ không chứng minh đã chặn token cũ |

Chỉ ghi mã lỗi, thời điểm và ID kỹ thuật cần thiết; không log ảnh/nét viết, tên học sinh hoặc token.

## 4. Nâng cấp và quay lui

1. Chọn lúc không có buổi đang diễn ra; đợi finalize/xóa dở được xử lý hoặc ghi nhận rõ công việc còn chờ.
2. Chuẩn bị bản sao DB, tệp Storage và dữ liệu bảng theo mục 5 trước thao tác khó hoàn tác.
3. Nâng đồng bộ web/API/bảng; giữ volume và quyền truy cập dữ liệu hiện có. Không dùng lệnh xóa volume để sửa lỗi khởi động.
4. Nếu phải quay lui, dùng phiên bản đọc được snapshot v2 khi đã có ảnh. Nếu chưa có bản tương thích, dừng nâng cấp để xử lý; không cho bản cũ lưu đè snapshot mất files.
5. Không rollback migration đã có dữ liệu chỉ để phù hợp code cũ. B2 video cần API tự tạo phòng; không để auto-create tắt cùng bản API không hỗ trợ cơ chế đó. Mọi thay đổi production vẫn cần được cho phép riêng.

## 5. Sao lưu và phục hồi — chuẩn bị, chưa thực hiện

Cần có ba phần cùng thời điểm hợp lý: DB, tệp trong bucket riêng tư `boards`/`submissions` nếu đang dùng, và dữ liệu `WHITEBOARD_DATA_DIR` gồm scene/ảnh/dấu đóng. Bản sao DB của Supabase không chứa nội dung tệp Storage; xem [tài liệu Supabase](https://supabase.com/docs/guides/platform/backups).

- Chọn thời điểm không có buổi học/ghi dữ liệu để giảm sai lệch giữa các phần; ghi phiên bản code, migration và thời điểm sao lưu. Không đặt backup chứa dữ liệu học sinh trong Git.
- Lưu ở nơi hạn chế truy cập; thời hạn giữ và người được truy cập **chưa được chủ dự án chốt**. Chưa có sổ yêu cầu xóa độc lập bền; không coi hướng dẫn này là cơ chế thực thi retention.
- Phục hồi thử trên môi trường tách biệt, không đè dự án thật. Sau phục hồi: kiểm schema, tệp, quyền, dấu đóng bảng và các yêu cầu xóa phát sinh sau thời điểm backup.
- Giữ môi trường phục hồi chưa cho học sinh đăng nhập cho đến khi xử lý lại dữ liệu/tài khoản phải xóa. Bản backup cũ có thể làm chúng xuất hiện lại.
- Chỉ đưa môi trường phục hồi trở lại sử dụng sau khi hoàn tất ca thử mục 3 trong acceptance. Đến nay chưa có kết quả restore thực tế.

## 6. Điều kiện cho pilot

Phải đóng lỗi token video, kiểm toàn luồng bằng dữ liệu thử (gồm ảnh khi xem lại và xóa), hoàn tất buổi 45–60 phút, xác minh CI, chốt chính sách backup/xóa và phục hồi được bản sao. Những việc này đang chờ; checklist có hướng dẫn không có nghĩa đã đạt.

LiveKit tự làm mới token trong phiên, nên rút TTL một mình chưa giải quyết toàn bộ cơ chế token cũ; xem [tài liệu token LiveKit](https://docs.livekit.io/frontends/reference/tokens-grants/) và [kết quả/thiết kế của dự án](design-video-token.md). Không thêm hệ thống thu hồi mới trong lần bàn giao ít code này.

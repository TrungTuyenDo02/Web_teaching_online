# Thử bảng viết bằng tablet Android qua Wi-Fi

Laptop chạy môi trường thử, tablet mở trang qua Wi-Fi, viết bằng bút, laptop thấy nét (và ngược lại). Chỉ dữ liệu giả, không cần Supabase/API/LiveKit, không có học sinh thật. Dùng đúng component `Whiteboard` và máy chủ bảng thật.

## An toàn của chế độ này

- Chỉ bật khi chạy `make dev-board-lan`/`make dev-web-lan`; `make dev-board-local`/`make dev-web` vẫn chỉ nghe `127.0.0.1`.
- Chỉ nghe trên IP Wi-Fi bạn chọn (phải là IP nội bộ 10.x, 172.16–31.x, 192.168.x của chính laptop), không nghe `0.0.0.0`. Máy chủ bảng thật (cổng 8788) vẫn chỉ nghe `127.0.0.1`; tablet đi qua cổng 8789 (cấp token) và 8790 (WebSocket qua proxy thử).
- Mỗi lần chạy: khóa ký token ngẫu nhiên và **mã ghép nối** ngẫu nhiên (dạng `ABCD-EFGH`), chỉ trong RAM, hết hiệu lực khi Ctrl+C. Không có mã thì người khác cùng Wi-Fi không lấy được token, không bấm được "Ngắt máy chủ"/"Treo đường truyền".
- Chỉ nhận trang từ đúng địa chỉ `http://<IP>:<cổng web>`, chỉ phòng `dev-*`, dữ liệu trong thư mục tạm, xóa khi tắt.
- Web chạy với `--mode lan`: không nạp file môi trường nào (không phát cấu hình `VITE_*` ra Wi-Fi). Các trang khác của ứng dụng sẽ báo chưa cấu hình; chỉ dùng `/dev/whiteboard`.
- Máy chủ web dev (Vite) cho người cùng Wi-Fi xem được mã nguồn web (không có bí mật). Chỉ chạy ở Wi-Fi nhà/tin cậy, tắt khi thử xong. Không dùng tunnel, không mở cổng trên router.

## HTTP hay HTTPS

Lần thử này dùng HTTP/WS thường: dữ liệu giả, Wi-Fi nhà, và các API trang thử dùng đã kiểm là chạy được khi trang **không** ở chế độ bảo mật (mở bằng IP): WebSocket, sự kiện bút (Pointer Events), tải ảnh PNG (Blob), `sessionStorage`, `BroadcastChannel`. Excalidraw chỉ cần chế độ bảo mật cho dán ảnh từ clipboard và mã hóa tệp ảnh, cả hai đều đã tắt ở bảng của dự án.

Cần HTTPS/WSS khi: dữ liệu thật hoặc học sinh thật; mạng không tin cậy (quán cà phê, Wi-Fi chung); qua Internet hay 4G; dùng camera/micro (LiveKit, trình duyệt chỉ cho phép ở HTTPS); bản chạy thật (luôn HTTPS/WSS). Hướng dẫn này không cài chứng chỉ hay đổi trust store.

Android Chrome có thể cảnh báo "tải xuống không an toàn" khi tải PNG từ trang HTTP: chọn "Giữ lại". Cảnh báo này không có ở bản chạy HTTPS.

## Các bước (Windows + Android)

1. **Cùng Wi-Fi**: laptop và tablet vào cùng một mạng Wi-Fi (không dùng mạng "khách"/guest: router thường chặn các máy trong mạng khách nhìn thấy nhau).
2. **Chọn IP của laptop**: PowerShell chạy `ipconfig`, tìm mục **Wireless LAN adapter Wi-Fi** → dòng **IPv4 Address**, ví dụ `192.168.1.9`. Không dùng IP của `vEthernet (WSL...)` hay `VirtualBox`/`Hyper-V` (tablet không tới được). Chạy với IP sai thì lệnh ở bước 3 in danh sách IP hợp lệ của máy.
3. **Cửa sổ terminal 1** (thư mục gốc dự án):
   ```bash
   make dev-board-lan LAN_IP=192.168.1.9
   ```
   Lệnh in: địa chỉ để mở, **mã ghép nối**, và lệnh cho cửa sổ 2.
4. **Cửa sổ terminal 2**:
   ```bash
   make dev-web-lan LAN_IP=192.168.1.9
   ```
   Cổng 5173 bận thì thêm `WEB_PORT=5175` vào **cả hai** lệnh.
5. **Mở trên laptop và tablet** (Chrome trên Android): `http://192.168.1.9:5173/dev/whiteboard`. Gõ đúng `http://`, không có `s`.
6. **Nhập mã ghép nối** đang hiện ở cửa sổ 1 (không phân biệt hoa thường, gạch ngang tùy ý), bấm "Ghép nối". Mỗi tab nhập một lần; chạy lại máy chủ thử thì nhập mã mới.
7. Chọn vai trò trên mỗi máy: "Giáo viên — được viết" hoặc "Học sinh — chỉ xem", cùng phòng `dev-1`. Hai máy cùng hiện "2 thiết bị".
8. Thử xong: Ctrl+C ở cả hai cửa sổ (dữ liệu thử và mã ghép nối bị xóa).

Dòng "Tab học sinh cùng trình duyệt: đã nhận nét mới nhất" chỉ xác nhận giữa các tab **trong cùng một trình duyệt** (`BroadcastChannel`). Với hai thiết bị khác nhau, trang ghi "Máy khác (tablet/laptop kia) không báo về đây: nhìn nét trên máy đó" — hãy nhìn trực tiếp màn hình máy kia, hoặc so số "Đã nhận từ máy chủ" bên học sinh với "Đã gửi lên máy chủ" bên giáo viên.

## Cách khác: cáp USB (không cần Wi-Fi)

Dùng khi không có Wi-Fi tin cậy, hoặc để thử bút mà không lẫn độ giật của Wi-Fi. Không dùng Bluetooth: trang web không gửi dữ liệu qua Bluetooth được, còn chia sẻ mạng qua Bluetooth chậm và giật hơn Wi-Fi nên làm sai số đo.

Chuẩn bị một lần:
- Tablet: Cài đặt → Thông tin máy → chạm 7 lần vào "Số hiệu bản tạo" để bật Tùy chọn nhà phát triển → bật **Gỡ lỗi USB**.
- Laptop: cài **Android SDK Platform-Tools** (công cụ chính thức của Google, có `adb`), ví dụ `winget install Google.PlatformTools`, rồi mở terminal mới. Cắm cáp, trên tablet chọn "Cho phép gỡ lỗi USB".

Mỗi lần thử:
1. Cửa sổ 1: `make dev-board-local`. Cửa sổ 2: `make dev-web` (phải đúng cổng 5173; cổng bận thì tắt Vite kia trước).
2. Cửa sổ 3: `make tablet-usb` (chuyển cổng 5173, 8789, 8790 của tablet về laptop qua cáp).
3. Tablet và laptop cùng mở `http://localhost:5173/dev/whiteboard`. Không cần mã ghép nối, không cần sửa firewall: mọi cổng vẫn chỉ nghe trong laptop.
4. Thử xong: `adb reverse --remove-all`, Ctrl+C hai cửa sổ.

Mục 8, 9 (tắt Wi-Fi) khi dùng cáp: rút cáp rồi cắm lại (cắm lại phải chạy lại `make tablet-usb`), hoặc dùng mục 14. Kết quả mất mạng thật vẫn phải thử qua Wi-Fi.

Đã kiểm 2026-10-21 trên laptop (chưa có tablet, chưa có `adb`): trang `http://localhost:5173/dev/whiteboard` với `make dev-board-local` kết nối được hai vai trò ("2 thiết bị", học sinh "Chỉ xem"); máy chủ cấp token trả `ws://127.0.0.1:8790`, đúng cổng `make tablet-usb` chuyển. Đường qua cáp thật **chưa thử**.

## Đo độ trễ và dung lượng nét bút

**Trên laptop, tự động** (bút giả lập, máy chủ bảng thật, không mạng): `cd apps/web && npx playwright test --grep @perf`. In dòng `INK-01 {...}`:
- `teacherEventMs`: thời gian trang giáo viên xử lý một sự kiện bút. Lớn hơn khoảng cách giữa hai sự kiện bút (8 ms ở 120 Hz, 16 ms ở 60 Hz) thì trình duyệt gộp sự kiện và Excalidraw chỉ lấy một điểm mỗi lần, nét viết nhanh bị gãy góc.
- `latencyToStudentMs`: từ lúc giáo viên xử lý xong đến lúc nét có trên bảng học sinh (chưa gồm mạng thật và vẽ ra màn hình).
- `sentKB`, `finalElementKB`, `resendFactor`: đang vẽ thì cứ mỗi 40 ms lại gửi cả nét từ đầu, nên tổng gửi lớn hơn nhiều lần kích thước nét. Hệ số phụ thuộc nhịp sự kiện trong test (test chạy chậm hơn thời gian thật), chỉ dùng để so trước/sau khi sửa.

Kết quả 2026-10-21 (laptop này, Chromium headless, 3 lần): nét 242 điểm; `teacherEventMs` p50 19–20, p95 40–42 ms; `latencyToStudentMs` p50 71–72, p95 103–109 ms; gửi 1,3 MB cho nét cuối cùng 11 KB.

**Trên tablet thật** (bổ sung cho bảng kết quả bên dưới):
- Mực dưới đầu bút: quay chậm bằng điện thoại (240 khung hình/giây) khi kẻ một đường nhanh, đếm khung hình từ đầu bút tới đầu nét mực (1 khung ≈ 4,2 ms). Nghiên cứu (Annett và cs., Graphics Interface 2014) cho thấy người viết nhận ra độ trễ từ khoảng 50 ms.
- Tablet sang laptop: đặt hai màn hình cạnh nhau, quay chậm, đếm khung hình từ lúc nét hiện trên tablet tới lúc hiện trên laptop.
- Dung lượng: khi nối bằng cáp, mở `chrome://inspect` trên laptop → tablet → Inspect → tab Network → WS, xem kích thước các khung `update` khi viết một nét dài.

## Lỗi ở đâu

| Hiện tượng trên tablet | Tầng lỗi | Kiểm tra |
|---|---|---|
| Trình duyệt báo không mở được trang / quá thời gian chờ (`ERR_CONNECTION_TIMED_OUT`, `REFUSED`) | **Web** (cửa sổ 2, cổng 5173) | Cửa sổ 2 có chạy đúng `LAN_IP`? Laptop và tablet cùng Wi-Fi (không phải mạng khách)? Gõ `http://` chứ không phải `https://`? Firewall (xem dưới) |
| Trang mở được, báo "Trang web đã tải nhưng không gọi được máy chủ cấp token …:8789" | **Cấp token** (cửa sổ 1, cổng 8789) | Cửa sổ 1 có chạy, cùng `LAN_IP`? Firewall chặn 8789? Thử mở `http://<IP>:8789/token` trên tablet: trang trắng (lỗi 403) nghĩa là tới được; quá thời gian chờ nghĩa là bị chặn |
| "Máy chủ bảng thử không nhận trang ở …" | Lệch địa chỉ | Hai lệnh khác `LAN_IP` hoặc `WEB_PORT`, hoặc đang mở bằng địa chỉ khác (vd. `localhost` trên laptop): mở đúng địa chỉ cửa sổ 1 in ra |
| Hiện ô "Mã ghép nối", báo mã không đúng | Ghép nối | Gõ lại mã đang hiện ở cửa sổ 1; máy chủ thử vừa chạy lại thì mã đã đổi |
| Có bảng nhưng mãi "Đang kết nối…"/"Mất kết nối, đang thử lại", không bao giờ "Bảng đã kết nối" | **WebSocket** (cổng 8790) | Đã lấy được token (tức 8789 thông) nhưng 8790 bị chặn: firewall. Trên laptop vẫn kết nối được là bình thường (đi trong máy) |

## Firewall Windows

Không cần sửa gì nếu tablet đã vào được. Không tắt hẳn firewall.

Ghi nhận trên laptop này (2026-10-20, chỉ đọc, chưa sửa): Wi-Fi đang là mạng **Public**, và có sẵn quy tắc cho phép kết nối vào "Node.js JavaScript Runtime" trên **Public**. Vì thế tablet có thể vào được ngay, nhưng cũng có nghĩa là mọi máy chủ Node nghe ra ngoài sẽ mở cả khi ở Wi-Fi công cộng. Đề xuất (bạn tự quyết):

1. Đặt Wi-Fi nhà là Private: Settings → Network & Internet → Wi-Fi → tên mạng → Network profile type → **Private network**.
2. Bỏ Public khỏi quy tắc Node: Windows Defender Firewall with Advanced Security → Inbound Rules → "Node.js JavaScript Runtime" (cả hai dòng) → Properties → Advanced → bỏ chọn **Public**.

Nếu firewall chặn (sau khi làm như trên, hoặc máy khác), chỉ mở đúng cổng, chỉ cho mạng Private, chỉ máy cùng mạng con. PowerShell **Run as Administrator**:

```powershell
New-NetFirewallRule -DisplayName "Gia su - bang thu qua Wi-Fi" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173,8789,8790 -Profile Private -RemoteAddress LocalSubnet
# Thử xong thì gỡ:
Remove-NetFirewallRule -DisplayName "Gia su - bang thu qua Wi-Fi"
```

Đổi `WEB_PORT` thì thay 5173 bằng cổng đó. Cổng 8788 không cần mở (chỉ nghe trong máy).

## Checklist thiết bị thật

**Lần chuẩn bị 2026-10-20:** máy chủ thử đã chạy và kiểm từ laptop (Wi-Fi Qualcomm QCA9377, IP `192.168.1.9/24`, mạng Public; `WEB_PORT=5174` vì 5173 đang có Vite khác; 8788 chỉ `127.0.0.1`, 5174/8789/8790 chỉ `192.168.1.9`; trang 200, cấp token không Origin 403, thiếu mã 401). Chủ dự án tạm dừng trước khi mở trên tablet: **chưa có kết quả thiết bị thật, cả 16 mục Chưa thử**; chưa ghi thông tin thiết bị. Lần sau chạy lại hai lệnh (mã ghép nối mới) và điền bảng dưới.

Ghi lại trước khi thử:

| Mục | Giá trị |
|---|---|
| Ngày, người thử | |
| Tablet (hãng, mẫu) | |
| Android (Cài đặt → Thông tin máy) | |
| Trình duyệt tablet + phiên bản (Chrome → Cài đặt → Giới thiệu về Chrome) | |
| Bút (bút đi kèm/S Pen/bút thụ động) | |
| Laptop: Windows + trình duyệt + phiên bản | |
| Wi-Fi (băng tần 2,4/5 GHz nếu biết), IP laptop | |

Kết quả: điền Đạt / Không đạt / Chưa thử và ghi chú (lỗi thấy được, thời gian, ảnh chụp nếu có).

| # | Thao tác | Mong đợi | Kết quả | Ghi chú |
|---|---|---|---|---|
| 1 | Tablet: giáo viên. Laptop: học sinh, cùng `dev-1` | Hai máy "Bảng đã kết nối · 2 thiết bị"; laptop ghi "Chỉ xem" | | |
| 2 | Viết chậm bằng bút (chữ, số) | Nét mượt, không đứt; hiện trên laptop trong khoảng 1 giây | | |
| 3 | Viết nhanh (gạch, ký liên tục, nhiều nét liền) | Không mất nét, không nét lạ; laptop hội tụ đủ | | |
| 4 | Tì lòng bàn tay lên màn hình khi viết | Không sinh nét lạ (bật "Pen mode" của Excalidraw nếu chưa tự bật: nút bút ở đầu thanh công cụ) | | |
| 5 | Ngón tay: kéo để cuộn, chụm hai ngón để zoom | Cuộn/zoom, không vẽ bằng ngón tay khi đang ở Pen mode | | |
| 6 | Chọn nét (công cụ chọn) rồi xóa; dùng tẩy (Eraser) | Nét mất ở cả laptop | | |
| 7 | Xoay dọc ↔ ngang | Bảng không mất nét; thanh công cụ Excalidraw và bảng thuộc tính nét không che chỗ đang viết (ghi lại nếu che) | | |
| 8 | Tắt Wi-Fi tablet, viết tiếp 2–3 nét | Tablet báo "Mất kết nối, đang thử lại" trong khoảng 15 giây; laptop thấy "1 thiết bị" trong khoảng 30 giây | | |
| 9 | Bật lại Wi-Fi | Tablet nối lại, nét viết lúc mất mạng hiện trên laptop (gửi bù); hai máy "2 thiết bị" | | |
| 10 | Khóa màn hình tablet 1–2 phút, mở lại | "Đang kiểm tra kết nối bảng…" rồi "Bảng đã kết nối"; viết tiếp được, laptop nhận | | |
| 11 | Chuyển sang ứng dụng khác 1–2 phút rồi quay lại Chrome | Như mục 10 | | |
| 12 | "Tải ảnh bảng" trên tablet, mở ảnh trong Thư viện/Files | Có tệp PNG, đúng các nét (Chrome có thể cảnh báo tải xuống không an toàn: chọn Giữ lại; ghi lại) | | |
| 13 | Đổi chiều: laptop giáo viên viết bằng chuột, tablet học sinh | Tablet thấy nét, không vẽ được, "Chỉ xem" | | |
| 14 | Trên tablet bấm "Treo đường truyền tab này 40 giây" (tablet là giáo viên) | Tablet báo mất kết nối khoảng 15 giây; laptop "1 thiết bị" trong khoảng 30 giây; sau 40 giây hội tụ | | |
| 15 | Dùng liên tục 45–60 phút (viết, xóa, cuộn, xoay xen kẽ) | Không chậm dần, không nóng/tụt pin bất thường, không rớt kết nối; ghi % pin đầu/cuối | | |
| 16 | Bất kỳ lỗi nào khác thấy được | Ghi thời điểm, thao tác vừa làm, chữ trên màn hình | | |

Sau khi thử, chép kết quả (tóm tắt) vào `docs/acceptance.md` mục tablet và `docs/progress.md`.

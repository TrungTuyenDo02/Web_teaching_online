# Nghiệm thu Giai đoạn 1 với dịch vụ thật

Dành cho chủ dự án (giáo viên) và người thử. Ghi kết quả thật vào cột **Kết quả**: `Đạt`, `Lỗi` (kèm mô tả ngắn, không chép dữ liệu học sinh), `Chưa thử`. Chỉ dùng **dữ liệu giả** (tên "Em Thử A", email kiểu `thu-a@example.com`), không dùng học sinh thật.

Cập nhật hướng dẫn: 2026-10-22. **Chủ dự án yêu cầu chưa chạy thử**; các mục chưa có kết quả vẫn để chờ. Vận hành và phục hồi: [operations.md](operations.md). Kế hoạch bàn giao: [phase1-handoff](superpowers/plans/2026-10-22-phase1-handoff.md).

## 0. Kết quả đã ghi nhận từ các phiên trước

Các dòng dưới là lịch sử, không phải lần kiểm mới. Phiên chèn ảnh 2026-10-22 ghi nhận 296 test API, 84 test bảng, 52 test trình duyệt; phiên video sau đó ghi nhận thêm room.spec 8/8. Test mô phỏng không thay nghiệm thu dịch vụ/thiết bị thật; chi tiết môi trường và lệnh trong progress.

| Mục | Cách kiểm | Kết quả |
|-----|-----------|---------|
| Migration 0001–0008 áp được, RLS, verifier | `supabase/tests/run.sh` trên PostgreSQL 16.15 (gói Ubuntu, có contrib), `pgcrypto` 1.3 thật, `gen_salt('bf')` chạy được; verifier 14/14 | Đạt cục bộ |
| Ghi chú riêng: lưu cùng phiên bản, lưu khi xóa đang khóa hàng | `teaching_notes_test.sh`, hai kết nối PostgreSQL độc lập | Đạt 2/2 |
| Rollback ghi chú | `teaching_notes_rollback_test.sh`: có dữ liệu bị chặn, bảng trống gỡ được và áp lại được | Đạt cục bộ |
| Bắt tay lưu bảng/xóa học sinh, hai kết nối độc lập | `handshake_test.sh`, 6 thứ tự | Đạt 6/6 |
| Script bắt tay không báo đạt sai | `handshake_negative_test.sh`: SQL lỗi, kết nối đóng, treo, kết quả chữ/rỗng, thiếu `;`, ghi hụt, bắt tay viết sai | Đạt 8/8 (đều bị bắt, đúng mã thoát) |
| `verify_migrations.sql` phân biệt đúng | Chạy trên DB chỉ có 0001–0003 (báo thiếu 0004–0007) và sau khi áp đủ (đạt hết) | Đạt |
| Cấu hình thật, chỉ đọc | `python -m app.preflight` (không in URL/khóa) | Biến đủ; PostgREST bằng service role đạt; bucket `boards`, `submissions` riêng tư; JWKS 1 khóa; LiveKit liệt kê phòng được |
| Schema Supabase thật | Chủ dự án áp và báo verifier, nhật ký 2026-10-21 | **0001–0010 đã áp, 22/22; 0011 chưa áp theo sổ**; chưa kiểm lại Cloud lần này |
| Máy chủ bảng | như trên | Không kết nối được (chưa chạy `make dev-board` lúc kiểm), chưa phải lỗi |
| Token video cấp trước khi kết thúc | Phòng tạm tên ngẫu nhiên, danh tính giả trên LiveKit Cloud (`wss`), `livekit-api` 1.2.2, client `livekit` 1.1.21; gọi đúng `close_livekit_room` của API | **Lỗi (hở đã xác nhận)**: client bị ngắt với lý do `ROOM_DELETED`, nhưng dùng lại token cũ thì vào được, giữ kết nối ≥ 15 s, `list_participants` thấy người đó trong phòng. Xem mục 5 |
| CI trên GitHub (`rls`, `web-e2e`) | Đã có push theo sổ | Chưa xác minh kết quả job |

## 1. Đối chiếu schema trước nghiệm thu — chưa thực hiện lần này

Theo sổ mới nhất: **0001–0010 đã áp**, chủ dự án báo verify 22/22 ngày 2026-10-21. **Không chạy lại các migration này.** Migration **0011 chưa áp theo sổ**, chỉ phục vụ giao/nộp/trả bài M2.1; không phải điều kiện cho bảng ảnh GĐ1.

Khi chủ dự án tiếp tục nghiệm thu:

1. Đối chiếu lịch sử migration với sổ bàn giao. Nếu không khớp, xác định nguyên nhân trước khi áp gì thêm; không suy ra `already exists` là toàn bộ migration đã hoàn tất.
2. Chạy `supabase/verify_migrations.sql` chỉ đọc: hiện **25 mục**, mục 1–22 cho schema đến 0010, mục 23–25 cho 0011. Nếu chưa áp 0011, ghi ba mục đó chưa đạt/chưa áp, không đánh dấu 25/25.
3. Chạy máy chủ bảng và `python -m app.preflight` từ `apps/api` bằng venv. Ghi riêng kết quả từng probe; preflight hiện kiểm cả chức năng ngoài GĐ1 nên không gộp thiếu 0011 thành hỏng bảng ảnh.
4. Nếu cần dùng bài tập M2.1, lập bước áp 0011 riêng khi được cho phép, có bản sao và không có buổi đang học; OCR vẫn hoãn. Không chạy trong lần hoàn thiện tài liệu này.
5. Ghi ngày, phạm vi và kết quả thực tế vào progress; không thay cột chưa thử bằng kết quả test giả.

Hoàn tác 0008 trước khi có dữ liệu: gỡ code/UI ghi chú tương ứng rồi dùng `supabase/rollback/0008_private_teaching_notes.sql`. Script từ chối nếu có bất kỳ note/chủ đề/liên kết nào; không bỏ dữ liệu thật để quay lui. Không tự gỡ 0004–0007 trong khi code phòng học/xóa dữ liệu còn dùng các cột đó.

## 2. Kiểm thử tích hợp (cần: đã áp mục 1, API + máy chủ bảng + web đang chạy, dữ liệu giả)

Chuẩn bị: `make dev-api`, `make dev-board`, `make dev-web`; preflight đạt mọi mục. Laptop đăng nhập giáo viên; trình duyệt ẩn danh (hoặc máy khác) đăng nhập học sinh.

| # | Bước | Kỳ vọng | Kết quả |
|---|------|---------|---------|
| 2.1 | GV thêm "Em Thử A", "Em Thử B"; tạo tài khoản đăng nhập cho cả hai | Danh sách hiện đủ; đăng nhập được bằng tài khoản vừa tạo | Chưa thử |
| 2.2 | GV tạo buổi cho A (bắt đầu sau 5 phút), sửa giờ, tạo buổi thứ hai rồi hủy | Giờ mới hiện đúng; buổi hủy hiện "Đã hủy"; tạo trùng giờ bị từ chối bằng lỗi tiếng Việt | Chưa thử |
| 2.3 | Đăng nhập A | Chỉ thấy buổi của A, không thấy B, không thấy ghi chú của GV | Chưa thử |
| 2.4 | A mở đường dẫn phòng học buổi của B (lấy id từ máy GV) | "Không tìm thấy" (404), không lộ buổi tồn tại | Chưa thử |
| 2.5 | GV vào lớp trên laptop; tablet mở "Dùng tablet" | Tablet chỉ có bảng, không xin quyền camera/micro, không có ô video | Chưa thử |
| 2.6 | A vào lớp | Thấy và nghe GV; nét GV viết trên tablet hiện ở laptop và máy A trong ~1 s; A không viết được | Chưa thử |
| 2.7 | Tắt Wi-Fi tablet 30 s khi đang viết, bật lại | Bảng báo mất kết nối rồi tự nối; nét viết lúc mất mạng được gửi bù, ba máy giống nhau | Chưa thử |
| 2.8 | Tải lại trang trên máy A giữa buổi | Vào lại được, bảng còn nguyên | Chưa thử |
| 2.9 | GV bấm "Kết thúc" | Cả ba máy hiện "Buổi học đã kết thúc"; video ngắt; trang GV không còn "Còn việc chờ" sau ≤ 1 phút | Chưa thử |
| 2.10 | Trang "Buổi đã học" > "Xem lại bảng" (GV và A) | Thấy đúng bảng cuối buổi; Storage có `boards/<id A>/<id buổi>.json` | Chưa thử |
| 2.11 | Sau 2.9, mở lại tab học sinh cũ / gọi lại join | Join trả 409; bảng không mở lại (token cũ bị chặn) | Chưa thử |
| 2.12 | Token video cũ sau khi kết thúc | Code cũ: **vào lại được** (đã xác nhận bằng script, mục 0). Với API có B2 (thu hồi + xóa phòng): tắt mạng máy A ngay trước khi GV kết thúc, bật lại sau 10 s; kỳ vọng A **không** vào lại phòng video. Vào lại được thì ghi lại; dù không vào lại, một lần thử không chứng minh P1 (mục 5) | Code cũ: Lỗi (mức SDK). B2: Chưa thử |
| 2.17 | Sau 2.9 và sau khi hủy một buổi học sinh đã vào trước, xem LiveKit Cloud > Rooms (hoặc log API "Đã xóa … phòng video") | Phòng của buổi đã kết thúc mất ngay; phòng buổi hủy mất sau một chu kỳ vòng lặp nền (~5 phút cộng thời gian chạy); không xóa phòng không thuộc ứng dụng | Chưa thử |
| 2.13 | GV ngừng dạy A rồi "Xóa hẳn" | Xong trong vài giây; A không đăng nhập được; Storage không còn thư mục `<id A>/` trong `boards`, `submissions` | Chưa thử |
| 2.14 | Xóa khi máy chủ bảng tắt (`Ctrl+C` ở `make dev-board`), rồi bật lại | Lần đầu "Đang xóa, chưa xong" + "Xóa tiếp"; bật lại rồi bấm "Xóa tiếp" (hoặc chờ vòng lặp nền ~5 phút) thì xong | Chưa thử |
| 2.15 | Sau 2.13–2.14, kiểm B | B vẫn đăng nhập được, buổi và bảng của B còn nguyên | Chưa thử |
| 2.16 | Chạy lại preflight và `verify_migrations.sql` | Vẫn đạt | Chưa thử |
| 2.18 | GV chèn ảnh JPEG/PNG/WebP trên laptop, xem trên tablet và máy A; đổi kích thước, viết lên ảnh, tải lại A | Ảnh/nét đầy đủ, giống nhau; A không có nút chèn ảnh | Chưa thử |
| 2.19 | Kết thúc buổi có ảnh, GV/A mở Xem lại bảng; B thử truy cập bảng A | GV/A thấy ảnh và nét, B không đọc được; bảng cũ không ảnh vẫn mở được | Chưa thử |
| 2.20 | Xóa A sau buổi có ảnh rồi kiểm dữ liệu bảng trên máy chủ và Storage | Không còn tệp ảnh/scene của A, dấu chặn phòng còn theo cơ chế purge; B không bị ảnh hưởng | Chưa thử |

**Chạy thử trên stack cục bộ (2026-10-26):** Supabase CLI ở máy (Postgres/Auth/REST/Storage, áp 0001–0012) + LiveKit mã nguồn mở `--dev` + máy chủ bảng + API, dữ liệu giả, bằng script gọi API/PostgREST/Storage/WebSocket (không qua giao diện). Đạt: 2.1–2.4, 2.5 (phần token: board không có video), 2.6 (nét GV tới HS, HS không gửi được; không có hình/tiếng), 2.8, 2.9, 2.10/2.19 (bảng không ảnh), 2.11, 2.13, 2.14, 2.15, 0012 (HS không ký được URL ảnh chữa trước khi trả, ký được sau khi trả). Đây **không** thay cho cột Kết quả bên dưới: chưa có Supabase/LiveKit Cloud thật, giao diện, tablet, camera/micro; 2.7, 2.12, 2.17, 2.18, 2.20 chưa thử. LiveKit mã nguồn mở không có thu hồi token nên không kiểm được L2/L4.

Mục 2.13–2.14 là lần đầu gọi Storage list/delete thật; nếu lỗi, chép mã HTTP trong log API (không chép tên học sinh).

## 3. Sao lưu và khôi phục

Chưa thử. Cần chủ dự án quyết định trước (quyết định 19, "Chưa chốt"):

1. **Bản sao lưu giữ dữ liệu đã xóa bao lâu.** Bản sao lưu của Supabase chứa cơ sở dữ liệu (kể cả `auth.users`), không chứa tệp Storage. Khôi phục một bản cũ hơn lúc xóa học sinh sẽ **đưa hồ sơ, buổi học và tài khoản đăng nhập của học sinh đã xóa trở lại** (đăng nhập lại được), còn tệp bảng thì không.
2. **Có ghi sổ yêu cầu xóa không** (chỉ id, không tên) để sau khi khôi phục chạy xóa lại. Hiện chưa có sổ này: sau khi khôi phục, GV phải tự xóa lại những học sinh đã xóa sau thời điểm sao lưu.
3. **Có giữ số liệu tối thiểu sau khi xóa không** (vd. số buổi đã dạy để tính tiền).

Cách thử khi đã quyết định, dùng dự án Supabase thử riêng hoặc PostgreSQL cục bộ, không khôi phục đè dự án thật:

| # | Bước | Kỳ vọng | Kết quả |
|---|------|---------|---------|
| 3.1 | Xem gói Supabase có sao lưu nào (Database > Backups), tần suất, thời hạn | Ghi lại | Chưa thử |
| 3.2 | Sao lưu logic: `pg_dump` bằng chuỗi kết nối của dự án (Project Settings > Database; mật khẩu chỉ nhập ở máy GV) | Có tệp `.sql`/`.dump` | Chưa thử |
| 3.3 | Tạo "Em Thử C" sau khi sao lưu, rồi xóa "Em Thử A" | | Chưa thử |
| 3.4 | Khôi phục bản 3.2 vào PostgreSQL cục bộ/dự án thử, chạy `verify_migrations.sql` | Đạt; thấy A xuất hiện lại (đúng như cảnh báo ở trên), C không có | Chưa thử |
| 3.5 | Làm theo quy trình xóa lại đã chốt ở câu 2 phía trên | A không còn dùng được | Chưa thử |

Máy chủ bảng: thư mục `data/boards` (Docker: volume `board-data`) giữ bảng đang dạy và dấu `.ended`. Mất thư mục này thì bảng chưa kết thúc mất nội dung chưa lưu, và token bảng cũ còn hạn (tối đa đến hết khung giờ vào phòng) có thể mở lại phòng đã đóng. Không cần sao lưu lâu dài, chỉ cần không xóa khi đang có buổi.

## 4. Tablet Android và buổi thử 45–60 phút

Thiết bị: laptop GV (camera, micro), tablet Android có bút, một máy học sinh (điện thoại hoặc laptop khác). Ghi model tablet, phiên bản Android, trình duyệt (Chrome) và phiên bản.

Thử trước bằng dữ liệu giả, chưa cần Supabase/LiveKit: [tablet-wifi.md](tablet-wifi.md) (laptop + tablet cùng Wi-Fi, có bảng ghi kết quả). Cập nhật 2026-10-22, theo phản hồi chủ dự án trên bảng thử LAN: nét khá ổn, độ trễ chấp nhận được; tì tay không sinh nét thừa; mất Wi-Fi tự nối/gửi bù; khóa màn hình rồi mở, bảng còn và nét mới đồng bộ. Vòng thử nhanh kết thúc; nét hơi mờ chưa xác định màn hình/nguyên nhân. Chưa nghiệm thu buổi 45–60 phút hoặc toàn luồng có Supabase/LiveKit; không coi cả 16 mục đã đạt.

### 4.1 Tablet (trước buổi thử, 10–15 phút)

| # | Kiểm | Kỳ vọng | Kết quả |
|---|------|---------|---------|
| T1 | Mở "Dùng tablet" trên Chrome Android | Chỉ có bảng, không xin quyền camera/micro | Chưa thử |
| T2 | Viết chữ tiếng Việt có dấu, công thức nhỏ bằng bút | Nét liền, không trễ thấy rõ, không mất đầu nét | Đã thử bảng LAN: nét khá ổn, hơi mờ, độ trễ chấp nhận được; công thức/đầu nét chưa xác nhận riêng |
| T3 | Đặt lòng bàn tay lên màn hình khi viết | Không vẽ thêm vệt lạ, không cuộn/zoom bảng | Bảng LAN: không sinh nét thừa theo phản hồi 2026-10-22; cuộn/zoom chưa xác nhận riêng |
| T4 | Hai ngón cuộn/zoom bảng, rồi viết tiếp | Cuộn được; viết tiếp không lệch vị trí | Chưa thử |
| T5 | Xoay ngang ↔ dọc khi đang có nét | Bảng không mất nét, không tải lại, nút vẫn bấm được (≥ 44 px) | Chưa thử |
| T6 | Tẩy, hoàn tác, chọn màu bằng bút/ngón | Dùng được, nút đủ to | Chưa thử |
| T7 | Tắt màn hình 1 phút, mở lại | Bảng tự nối lại, nét mới vẫn đồng bộ | Đạt trên bảng LAN theo phản hồi 2026-10-22: bảng còn, nét mới hiện trên laptop |
| T8 | Chuyển Wi-Fi ↔ 4G | Nối lại, không mất nét | Chưa thử |
| T9 | Dán/kéo ảnh vào bảng | Bị chặn, có thông báo tiếng Việt | Chưa thử |

### 4.2 Buổi thử 45–60 phút

| Phút | Việc | Ghi lại |
|------|------|---------|
| 0–5 | GV vào lớp trên laptop, mở tablet; HS vào trên máy thứ ba | Thời gian vào được; tiếng/hình hai chiều |
| 5–35 | Dạy như thật: viết liên tục trên tablet, nói qua laptop | Độ trễ nét; chữ có rõ trên máy HS (điện thoại); tiếng có vọng/rè |
| ~20 | Tắt Wi-Fi máy HS 30 s rồi bật | HS tự vào lại, bảng đủ nét |
| ~25 | Xoay tablet hai lần; đặt tay lên màn hình khi viết | Như T3, T5 |
| ~30 | Tải lại trang tablet | Bảng còn nguyên |
| 35–45 | Bảng dài: viết kín nhiều màn hình, cuộn qua lại | Không chậm dần; pin, nhiệt tablet |
| 45 | GV bấm "Kết thúc" | Cả ba máy hiện đã kết thúc trong vài giây |
| sau đó | "Buổi đã học" > "Xem lại bảng" trên máy GV và HS | Bảng đầy đủ, giống lúc kết thúc |
| sau đó | Phút video trên LiveKit Cloud dashboard | Chỉ tính laptop GV và máy HS (tablet không vào video) |

Lỗi trong buổi thử: ghi giờ, máy, thao tác vừa làm, và đoạn log API/máy chủ bảng quanh thời điểm đó (log chỉ có id, không có nội dung bảng).

## 5. Lỗi còn mở

- **Token video cũ vào lại phòng đã đóng: VẪN MỞ** (quyết định 18, "Còn hở"; đã xác nhận 2026-10-20 trên LiveKit Cloud). Ai giữ token còn hạn (đến hết khung giờ vào phòng) mà nối lại sau khi GV kết thúc thì vào được một phòng video mới cùng tên. Trường hợp thật: trang học sinh đang mở, mất mạng đúng lúc kết thúc, rồi có mạng lại (SDK tự nối lại); hoặc dùng token cố ý. Hậu quả: tốn phút video, hai người cùng giữ token cũ có thể gặp nhau sau giờ học.
  - **Đã làm (cục bộ, chưa commit, chưa deploy):** thiết kế B2 ([design-video-token.md](design-video-token.md)): `/join` main tạo phòng (lỗi → 502 "Chưa mở được phòng video, thử lại"), mọi chỗ xóa phòng đều thu hồi token GV/HS (`RemoveParticipant` + `revoke_token_ts`) trước, token video có `nbf` lùi về lúc đọc trạng thái, vòng lặp nền xóa phòng của buổi đã đóng theo `ListRooms`.
  - **Kết quả kiểm thử (không phải bảo đảm):** 2026-10-20, `make test` đạt (API 128 test, gồm 21 test xác định và 400 seed ngẫu nhiên cho phòng video). Các test chỉ chứng minh code đúng **theo mô hình LiveKit giả** (thu hồi theo phòng + identity, sống qua tạo lại phòng, có hạn 660 s; thu hồi khi phòng không tồn tại không được ghi nhận). LiveKit Cloud **chưa** được kiểm theo mô hình này.
  - **G4 đã có logic cục bộ:** phòng mới có nhãn sở hữu HMAC gắn với tên phòng và môi trường, sweeper dọn được phòng tạo muộn sau xóa học sinh/buổi học. Phòng không có nhãn hợp lệ hoặc DB lỗi được giữ lại. Chưa kiểm metadata trên Cloud; giới hạn khóa/phạm vi thay đổi ở thiết kế mục 10.
  - **Kiểm tra sau hoàn tất logic G4/G10:** API **141 test đạt** (gồm 13 ca ownership/xóa bù mới và 400 seed sẵn có); board **65/65**, Ruff, typecheck và web build đạt bằng lệnh thành phần trên bản sao không chứa bí mật. Lệnh `make` lỗi khởi chạy; `npm test` board lỗi môi trường tsx, dùng Node 24 transform-types thay thế. Chi tiết lệnh/kết quả trong progress.
  - **Vì sao vẫn mở (cập nhật):** Cloud đã được thử trên dự án dev; không còn coi toàn bộ T1–T14 là chưa chạy. T3/T3B cho thấy xóa phòng không chặn token chưa thu hồi. T8b xác nhận thu hồi hết hiệu lực trong khoảng 6–12 phút; token còn hạn có thể vào lại, kể cả phòng đã bị xóa. G2/G9/G11 vẫn cần giải pháp và xác minh; T4/T10 còn chưa thử. Không suy rộng cấu hình dev thành cấu hình production đã kiểm.
  - **Thử trên LiveKit Cloud (dự án hiện có, chủ dự án chỉ định làm dev, 2026-10-20):** T1, T2, T5, T6, T7, T12, T13, T14 đạt; **T3 và T3B không đạt**: xóa phòng không chặn token cũ chưa thu hồi (token vào lại và phòng xuất hiện lại dù auto-create tắt). Thu hồi chặn được, kể cả khi thu hồi lúc phòng không tồn tại (T7). T8: thu hồi giữ ít nhất 6 phút, sau đó phòng tự đóng nên chưa đo được thời hạn thật; T4, T10 chưa thử. Chi tiết: design-video-token.md mục 9.3. Lỗi **vẫn mở**.
  - **L4 thu hồi lại theo chu kỳ (2026-10-26, cục bộ, chưa commit):** chủ dự án duyệt hướng thu hồi định kỳ. Vòng lặp nền riêng mỗi 2 phút thu hồi lại GV/HS của buổi đã đóng tới khi token hết hạn, không cần migration ([design-video-token.md](design-video-token.md) mục 9.4). Test mô hình đạt; **T16 đạt trên Cloud dev (2026-10-27)**: thu hồi lặp lại mỗi 2 phút giữ token cũ bị từ chối ở +1/6/12/16/20 phút khi phòng có người giữ (vượt 6–12 phút của một lần thu hồi). Còn hở khi API ngừng lâu hơn 6 phút và với buổi của học sinh đã xóa hẳn.
  - **Đóng lỗi khi:** cơ chế ứng dụng ngăn token cũ/cấp lại vào buổi đã đóng trong phạm vi yêu cầu đã chốt, có kiểm cục bộ và bằng chứng trên LiveKit dev cho reconnect muộn, API restart/ngừng, lỗi thu hồi và tạo phòng muộn. T3/T3B là hành vi nhà cung cấp đã biết, không chờ nó tự đổi thành đạt. Phải xử lý hoặc chốt rõ giới hạn G2/G4/G9/G11 và kiểm cấu hình triển khai trước pilot; xóa phòng, metadata danh tính hoặc giảm TTL riêng lẻ chưa đáp ứng điều kiện này.
- Máy chủ bảng chưa chạy lúc preflight: chạy `make dev-board` rồi preflight lại.

## 6. Việc chủ dự án cần làm

1. Áp 0004–0008 theo mục 1, chạy `verify_migrations.sql` và preflight, ghi kết quả; 0008 dành cho tính năng ghi chú riêng.
2. Quyết định ba câu ở mục 3 và chọn cách chặn token video cũ ở mục 5.
3. Push nhánh lên GitHub để job CI `rls` chạy (hoặc báo để Claude Code commit khi được yêu cầu).
4. Chạy mục 2 với dữ liệu giả, rồi mục 4 với tablet thật; điền cột Kết quả.

## 7. Mở rộng M1a: báo cáo tháng (ngoài nghiệm thu GĐ1 ban đầu)

Code cục bộ có test API/CSV/Chromium; chưa xác nhận qua Supabase thật. Các bước dưới dùng dữ liệu giả sau khi môi trường mục 1 sẵn sàng.

| # | Bước | Kỳ vọng | Kết quả dịch vụ thật |
|---|------|---------|---------------------|
| R1 | GV mở Báo cáo tháng, đổi tháng, đối chiếu các buổi đã bấm kết thúc | Đếm theo ngày bắt đầu đã xếp lịch ở giờ Việt Nam, từ đầu tháng đến trước đầu tháng sau; hủy/live không tính | Chưa thử |
| R2 | Dùng tài khoản HS mở `/reports` và gọi API báo cáo | Không đọc được báo cáo giáo viên; API 403, không trả danh sách | Chưa thử |
| R3 | GV ngừng dạy một HS, sau đó xóa hẳn HS giả | Ngừng dạy vẫn có trong báo cáo; đang xóa/đã xóa không có. Không giữ số liệu sau xóa | Chưa thử |
| R4 | Tải CSV, mở bằng Excel/phần mềm bảng tính | Chữ Việt đúng, tên chứa dấu nháy/dấu phẩy không vỡ cột, tên mở đầu `=` không chạy công thức; không có thông tin phụ huynh/ghi chú | Chưa thử |

## 8. Mở rộng M1a: ghi chú riêng và chủ đề (cần 0008)

| # | Bước | Kỳ vọng | Kết quả dịch vụ thật |
|---|------|---------|---------------------|
| N1 | GV mở Ghi chú riêng, chọn HS/tháng; sửa note của buổi completed, tạo/chọn chủ đề rồi lưu, tải lại trang | Nội dung và chủ đề còn đúng; note không xuất hiện ở lịch sử HS | Chưa thử |
| N2 | HS và GV khác mở URL/API note buổi của A; thử đọc session_notes/session_topics qua PostgREST | API 404 với note buổi; không có hàng riêng qua RLS, không lộ nội dung | Chưa thử |
| N3 | Hai tab GV mở cùng note, tab 1 lưu rồi tab 2 lưu phiên bản cũ | Tab 2 nhận 409, giữ bản nháp, tải lại trước khi lưu; note và chủ đề không ghi nửa chừng | Chưa thử |
| N4 | Chọn tháng sát biên VN, tải Markdown/CSV | Chỉ buổi completed của đúng HS/tháng; dữ liệu nhập không chạy HTML/công thức; đổi ngôn ngữ không đổi tháng nghiệp vụ | Chưa thử |
| N5 | Xóa hẳn HS giả, kiểm note/liên kết và dữ liệu HS khác | Note/liên kết của A mất theo buổi, không giữ nội dung đánh giá; dữ liệu của B còn | Chưa thử |

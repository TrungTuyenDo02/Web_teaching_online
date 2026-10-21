# Nghiệm thu Giai đoạn 1 với dịch vụ thật

Dành cho chủ dự án (giáo viên) và người thử. Ghi kết quả thật vào cột **Kết quả**: `Đạt`, `Lỗi` (kèm mô tả ngắn, không chép dữ liệu học sinh), `Chưa thử`. Chỉ dùng **dữ liệu giả** (tên "Em Thử A", email kiểu `thu-a@example.com`), không dùng học sinh thật.

Cập nhật lần cuối: 2026-10-20.

## 0. Đã kiểm tra tự động (2026-10-20)

| Mục | Cách kiểm | Kết quả |
|-----|-----------|---------|
| Migration 0001–0008 áp được, RLS, verifier | `supabase/tests/run.sh` trên PostgreSQL 16.15 (gói Ubuntu, có contrib), `pgcrypto` 1.3 thật, `gen_salt('bf')` chạy được; verifier 14/14 | Đạt cục bộ |
| Ghi chú riêng: lưu cùng phiên bản, lưu khi xóa đang khóa hàng | `teaching_notes_test.sh`, hai kết nối PostgreSQL độc lập | Đạt 2/2 |
| Rollback ghi chú | `teaching_notes_rollback_test.sh`: có dữ liệu bị chặn, bảng trống gỡ được và áp lại được | Đạt cục bộ |
| Bắt tay lưu bảng/xóa học sinh, hai kết nối độc lập | `handshake_test.sh`, 6 thứ tự | Đạt 6/6 |
| Script bắt tay không báo đạt sai | `handshake_negative_test.sh`: SQL lỗi, kết nối đóng, treo, kết quả chữ/rỗng, thiếu `;`, ghi hụt, bắt tay viết sai | Đạt 8/8 (đều bị bắt, đúng mã thoát) |
| `verify_migrations.sql` phân biệt đúng | Chạy trên DB chỉ có 0001–0003 (báo thiếu 0004–0007) và sau khi áp đủ (đạt hết) | Đạt |
| Cấu hình thật, chỉ đọc | `python -m app.preflight` (không in URL/khóa) | Biến đủ; PostgREST bằng service role đạt; bucket `boards`, `submissions` riêng tư; JWKS 1 khóa; LiveKit liệt kê phòng được |
| Schema Supabase thật | như trên | **0004, 0005, 0006, 0007 chưa áp** |
| Máy chủ bảng | như trên | Không kết nối được (chưa chạy `make dev-board` lúc kiểm), chưa phải lỗi |
| Token video cấp trước khi kết thúc | Phòng tạm tên ngẫu nhiên, danh tính giả trên LiveKit Cloud (`wss`), `livekit-api` 1.2.2, client `livekit` 1.1.21; gọi đúng `close_livekit_room` của API | **Lỗi (hở đã xác nhận)**: client bị ngắt với lý do `ROOM_DELETED`, nhưng dùng lại token cũ thì vào được, giữ kết nối ≥ 15 s, `list_participants` thấy người đó trong phòng. Xem mục 5 |
| CI trên GitHub (job `rls`) | | Chưa chạy (chưa push) |

## 1. Áp migration 0004–0008 (chủ dự án làm)

Đã áp: 0001, 0002, 0003; **0004–0007 chủ dự án áp 2026-10-20**, báo `verify_migrations.sql` 10/10 dòng `true` (bản kiểm trước khi có 0008). Chủ dự án cũng đã chạy 0008 cùng ngày; bản kiểm 14 dòng: **14/14 `true`** (chủ dự án gửi kết quả). Chưa chạy preflight sau khi áp. **Không chạy lại 0001–0008.**

Bốn file 0004–0007 chỉ thêm cột, chỉ mục và một bảng mới; không xóa hay đổi dữ liệu có sẵn, trừ 0004 đánh dấu mọi buổi `completed` cũ là đã xong (để API không đóng lại hàng loạt). 0008 thêm 3 bảng riêng, RLS và RPC; không chép hay đổi summary/homework_note cũ. Tính năng ghi chú riêng cần 0008; nghiệm thu phòng học vẫn cần 0004–0007.

1. Dừng API đang chạy (nếu có). Code API hiện tại cần các cột này; áp xong mới chạy lại.
2. Nếu gói Supabase có sao lưu: Database > Backups, ghi lại thời điểm bản sao gần nhất.
3. Supabase Dashboard > SQL Editor > New query. Dán **toàn bộ** nội dung từng file, bấm Run, theo đúng thứ tự, mỗi file một lần:
   1. `supabase/migrations/0004_session_finalize.sql`
   2. `supabase/migrations/0005_student_deleting.sql`
   3. `supabase/migrations/0006_board_upload_intents.sql`
   4. `supabase/migrations/0007_upload_intent_cleaned.sql`
   5. `supabase/migrations/0008_private_teaching_notes.sql`
   6. `supabase/migrations/0009_weekly_slots.sql` (lịch hằng tuần, thêm 2026-10-20; chủ dự án đã áp 0004–0008, **chỉ cần chạy 0009**)

   File nào báo lỗi thì dừng, không chạy file sau, chụp lỗi (không kèm dữ liệu) gửi lại. Lỗi `already exists` nghĩa là file đó đã áp trước rồi: không chạy lại, chuyển sang file sau.
4. Kiểm tra sau áp: dán `supabase/verify_migrations.sql` vào SQL Editor, Run. Cả 16 dòng cột `dat` phải là `true`. Nếu mới áp đến 0007 thì 4 mục 0008 chưa đạt, chưa dùng ghi chú riêng; chưa áp 0009 thì 2 mục cuối chưa đạt, chưa dùng lịch hằng tuần.
5. Trên máy chạy API: `cd apps/api && .venv/Scripts/python -m app.preflight` (Linux/macOS: `.venv/bin/python`). Phải thấy `ĐẠT migration 0004…0009` (0008 có 3 probe, 0009 có 2). Muốn có dòng máy chủ bảng đạt thì chạy `make dev-board` trước.
6. Ghi vào `docs/progress.md`: ngày áp, kết quả bước 4 và 5.

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
  - **Vì sao vẫn mở:** (1) chưa tắt auto-create trên Cloud (production hiện vẫn tự tạo phòng, nên khi chưa deploy B2 thì lỗi y như cũ); (2) giả định về thu hồi và nhãn metadata trên Cloud chưa xác minh (T5–T8, T14; kịch bản `apps/api/scripts/livekit_dev_check.py` đã chạy offline trên mô hình, **chưa chạy trên Cloud**); (3) còn phản ví dụ theo mô hình: G2 (thu hồi hết hạn khi phòng mồ côi còn và vòng lặp nền không chạy), G9 (thu hồi lỗi rồi phòng đã xóa, lần thử lại không ghi nhận được), G11 (token máy chủ tự cấp lại). Chi tiết mục 7–8 thiết kế.
  - **Thử trên LiveKit Cloud (dự án hiện có, chủ dự án chỉ định làm dev, 2026-10-20):** T1, T2, T5, T6, T7, T12, T13, T14 đạt; **T3 và T3B không đạt**: xóa phòng không chặn token cũ chưa thu hồi (token vào lại và phòng xuất hiện lại dù auto-create tắt). Thu hồi chặn được, kể cả khi thu hồi lúc phòng không tồn tại (T7). T8: thu hồi giữ ít nhất 6 phút, sau đó phòng tự đóng nên chưa đo được thời hạn thật; T4, T10 chưa thử. Chi tiết: design-video-token.md mục 9.3. Lỗi **vẫn mở**.
  - **Đóng lỗi khi:** T1, T3, T5–T8, T14 đạt trên dự án LiveKit dev riêng, chủ dự án chấp nhận hoặc xử lý G2/G4/G9/G11, và B2 đã chạy trên production với auto-create tắt.
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

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

## 7. Xác thực JWT: ES256 qua JWKS, HS256 cho dự án cũ

- Dự án Supabase của giáo viên ký ES256 (kiểm 2026-10-19). API lấy khóa công khai từ `/auth/v1/.well-known/jwks.json`, lưu trong bộ nhớ.
- HS256 chỉ được chấp nhận khi có `SUPABASE_JWT_SECRET`. Mỗi nhánh chỉ nhận đúng thuật toán của nó (chặn tấn công đổi thuật toán).

## 8. Giáo viên tạo tài khoản đăng nhập cho học sinh

- **Quyết định (2026-10-19):** không cho tự đăng ký. Giáo viên nhập email và mật khẩu tạm; API (service role) tạo tài khoản Supabase và gắn vào `students.profile_id`.
- **Lý do:** học sinh có thể là trẻ vị thành niên; giáo viên kiểm soát ai có quyền vào.

## 9. "Xóa" học sinh là ngừng dạy

- **Quyết định (2026-10-19):** nút mặc định đặt `students.active = false`, giữ lịch sử. "Xóa hẳn" (`DELETE /api/students/{id}`) chỉ được với học sinh đã ngừng dạy, có hộp xác nhận, xóa dây chuyền buổi học, bài tập, bài nộp và xóa cả tài khoản đăng nhập.
- **Cập nhật (2026-10-20):** xóa hẳn dọn cả bảng viết và tệp, làm tiếp được khi lỗi (quyết định 19).

## 10. Tạo buổi học và tài khoản học sinh đi qua API

- **Quyết định (2026-10-19):** web gọi `POST /api/sessions` và `POST /api/students/{id}/account` thay vì ghi thẳng Supabase.
- **Lý do:** cần kiểm tra nghiệp vụ có test (đúng học sinh của mình, không trùng giờ, tối đa 4 giờ); tạo tài khoản cần service role.
- **Còn hở:** RLS `sessions_teacher_all` vẫn cho giáo viên ghi thẳng, và hai yêu cầu cùng lúc có thể tạo buổi trùng giờ. Chấp nhận khi chỉ có một giáo viên; nhiều giáo viên thì thêm ràng buộc trong migration.

## 11. `no_show` do API đặt định kỳ

- Vòng lặp trong `lifespan` của API, 5 phút một lần, cập nhật idempotent nên chạy nhiều bản API cũng không sao.
- **Xem lại nếu:** chạy API dạng serverless (không có tiến trình sống lâu): chuyển sang `pg_cron` của Supabase.

## 12. Một cửa ghi dữ liệu: chỉ giáo viên, chỉ qua API (chuẩn bị cho trợ lý AI)

- **Quyết định (2026-10-19):** thêm, sửa, xóa học sinh và buổi học chỉ qua API, chỉ giáo viên (`require_teacher`), chỉ với học sinh của mình (khác thì 404). Migration `0003_api_only_writes.sql` bỏ quyền ghi của trình duyệt trên `students`, `sessions` và che cột riêng tư (`notes`, `guardian_*`, `consent_at`).
- **Lý do:** một nơi duy nhất kiểm tra nghiệp vụ và có test. Sau này trợ lý AI (chatbot/agent) chỉ là một "người dùng" nữa của cùng API.
- **Quy tắc cho trợ lý AI sau này (chưa làm):**
  - Gọi đúng các endpoint này bằng token của giáo viên đang dùng, không bao giờ dùng service role. Nhờ vậy agent không làm được gì vượt quyền giáo viên.
  - Công cụ của agent lấy từ OpenAPI (`/openapi.json`); docstring mỗi endpoint là mô tả công cụ, nên viết rõ khi thêm endpoint.
  - Thao tác không hoàn tác được (xóa hẳn học sinh, hủy buổi) phải để giáo viên bấm xác nhận, agent chỉ đề xuất.
  - Không gửi `notes`, liên hệ phụ huynh hay bài làm cho dịch vụ AI bên ngoài khi chưa có quyết định riêng về dữ liệu trẻ vị thành niên.
- **Thêm thao tác ghi mới:** viết endpoint trong API kèm test, không mở lại quyền ghi trên bảng cho trình duyệt.

## 13. Một giáo viên kiêm quản trị viên (chốt 2026-10-19)

- Hai vai trò: giáo viên (toàn quyền, cũng là quản trị viên, cấp tài khoản) và học sinh. Không có vai trò quản trị riêng.
- Không cần cách ly nhiều giáo viên; giữ cột `teacher_id` vì đã có sẵn.
- Học sinh không tự đăng ký, không tự lấy lại mật khẩu: giáo viên đặt lại (`POST /api/students/{id}/password`). Tắt "Allow new users to sign up" trong Supabase Auth.
- Học sinh: xem buổi học, xem bài về nhà, nộp bài, xem điểm, AI giải đáp lý thuyết (GĐ3), lịch học (làm sau).
- Phạm vi chỉ môn Toán.

## 14. Học sinh chỉ xem bảng viết (chốt 2026-10-19)

- Máy chủ `whiteboard-sync` bỏ qua tin `update` từ token có `role` khác `teacher` (có test); web mở Excalidraw ở chế độ xem (`viewModeEnabled`) cho học sinh.
- **Xem lại nếu:** muốn cho học sinh lên bảng làm bài. Khi đó thêm quyền viết theo từng buổi trong token, không mở cho mọi học sinh.

## 15. Buổi đã dạy = buổi giáo viên bấm "Kết thúc" (chốt 2026-10-19)

- Chỉ `POST /api/sessions/{id}/end` của giáo viên đưa buổi sang `completed`; không tự kết thúc khi quá giờ. Số buổi đã dạy là số buổi `completed` của từng học sinh (`completed_sessions` trong `GET /api/students`).
- Buổi quên bấm kết thúc vẫn ở `live`, giáo viên bấm kết thúc sau vẫn được (không giới hạn giờ).
- Bấm kết thúc thì đóng phòng ngay trên mọi thiết bị (sơ đồ 3b): API ghi dữ liệu trước, ghi `left_at` điểm danh, rồi xóa phòng LiveKit và gọi `whiteboard-sync` đóng phòng bảng. Đóng phòng lỗi không làm hỏng việc tính buổi; việc còn thiếu được thử lại (quyết định 18).
- Số buổi đã dạy, điểm bài nộp sẽ dùng để đánh giá học sinh (GĐ2, chưa làm).

## 16. Nộp bài và AI (chốt 2026-10-19, làm ở GĐ2 và GĐ3)

- Nộp bài: chụp ảnh bằng máy hoặc chọn ảnh có sẵn trên máy (`<input type="file" accept="image/*">`, không ép mở camera).
- AI cho học sinh chỉ được: giải thích lý thuyết Toán, và cho điểm bài làm. **Không đưa lời giải, không giải hộ bài tập.**
- Điểm AI là gợi ý cho giáo viên duyệt trước khi học sinh thấy (sơ đồ 8), nhất quán với việc điểm dùng để đánh giá học sinh.

## 17. Lưu bảng viết: file JSON trên máy chủ bảng, bản cuối vào Storage (2026-10-19)

- **Đang dạy:** `whiteboard-sync` ghi nội dung mỗi buổi ra `data/boards/<id buổi>.json` sau 2 giây kể từ nét cuối (ghi file tạm rồi đổi tên). Phòng mở lại hoặc máy chủ khởi động lại thì nạp lại. Một tiến trình nên chưa cần Redis.
- **Kết thúc buổi:** lệnh đóng phòng ghi bản cuối và dấu đóng `<id buổi>.ended` cạnh file bảng (khởi động lại máy chủ bảng vẫn chặn token cũ; nét đến sau lúc đóng bị bỏ qua), rồi trả nội dung cuối. Gọi lại được, kể cả sau khởi động lại; lỗi đĩa trả 500, không trả nội dung như đã lưu; API lưu vào bucket `boards` tại `<student_id>/<session_id>.json` và ghi `sessions.board_snapshot_path`. Lưu JSON thay cho ảnh PNG: nét luôn sắc khi phóng to, nhẹ, không cần trình duyệt của giáo viên còn mở.
- **Xem lại:** trang "Buổi đã học" và "Xem lại bảng" (Excalidraw chỉ xem). Storage RLS sẵn có: giáo viên, hoặc đúng học sinh (thư mục đầu là `student_id`).
- **Còn thiếu:** file trên đĩa máy chủ bảng (`.json`, `.ended`) không tự xóa (cần chính sách giữ dữ liệu); xóa hẳn học sinh chưa xóa file trong bucket `boards`; ảnh chèn vào bảng (`files`) chưa được đồng bộ và lưu, nên web chặn chèn ảnh (ẩn nút ảnh; ảnh dán/kéo thả bị gỡ kèm thông báo).
- **Khoảng mất dữ liệu:** máy chủ bảng chết đột ngột thì mất tối đa ~2 giây nét cuối trên đĩa; nếu trang của giáo viên còn mở, máy giáo viên gửi bù khi máy chủ lên lại (có test). Trang giáo viên cũng đóng thì phần đó mất. Chưa đo bằng tắt tiến trình thật.

## 18. Kết thúc buổi gọi lại được, việc đóng phòng lưu bền trong `sessions` (2026-10-20)

- **Không thêm hàng đợi:** cột `sessions.finalized_at` (migration 0004). Buổi `completed` mà cột này rỗng là còn việc chờ: ghi `left_at`, xóa phòng LiveKit, đóng bảng và lưu bản cuối. Mỗi bước gọi lại được, nên thử lại là chạy lại cả chuỗi (`app/services/finalize.py`).
- **Ai thử lại:** `POST /end` gọi lại (bấm lặp, mất phản hồi, nút "Thử lại ngay") trả 200, không tính thêm buổi, không ghi đè `ended_at`/nội dung; vòng lặp nền của API (cùng chu kỳ `NO_SHOW_INTERVAL_SECONDS`) xử lý buổi kết thúc quá 1 phút, kể cả sau khi API khởi động lại.
- **Không ghi đè trạng thái:** join/sửa/hủy/kết thúc ghi có điều kiện theo trạng thái đã đọc (`update_session(..., expected_status)`, một câu `UPDATE ... WHERE status = ...`). Buổi `completed`/`cancelled` không quay về `live`; hai thiết bị giáo viên vào cùng lúc vẫn vào được.
- **Vào lớp đúng lúc kết thúc (sửa 2026-10-20):** join ghi điểm danh rồi mới đọc lại trạng thái buổi; `/end` ghi `completed` rồi mới đóng điểm danh. Một trong hai bên luôn thấy bên kia: hoặc `/end` đóng lượt điểm danh đó, hoặc join thấy buổi đã xong, tự đóng lượt của mình và trả 409 không kèm token (có test cho cả hai thứ tự, kể cả thiết bị thứ hai của giáo viên).
- **Còn hở:** token cấp ngay trước khi `/end` ghi `completed` vẫn hợp lệ; token bảng bị máy chủ bảng chặn sau khi đóng, còn token video dùng sau khi phòng LiveKit đã bị xóa có thể tạo lại phòng (LiveKit mặc định tự tạo phòng khi có người vào) — **đã xác nhận 2026-10-20 trên LiveKit Cloud**: sau `close_livekit_room` client bị ngắt (`ROOM_DELETED`), dùng lại token cũ thì vào được và có tên trong `list_participants` (phòng tạm, danh tính giả; chi tiết `docs/acceptance.md`). Cách chặn chờ chủ dự án chọn: webhook `participant_joined` đá người vào phòng của buổi đã xong, tắt tự tạo phòng, hoặc token video ngắn hạn cấp lại định kỳ.
- **Xem lại nếu:** có nhiều tiến trình API chạy song song (khi đó cần khóa theo buổi để không đóng/lưu chồng), hoặc cần biết từng bước nào lỗi để hiện cho giáo viên.

## 19. Xóa hẳn học sinh theo từng bước, làm tiếp được (2026-10-20)

- **Phạm vi xóa:** nội dung bảng trên máy chủ bảng (`<id buổi>.json`), tệp dưới `<student_id>/` trong bucket `boards` và `submissions`, buổi học, điểm danh, bài tập, bài nộp, gợi ý chấm AI (xóa dây chuyền), tài khoản Auth và `profiles`, hồ sơ học sinh. Chỉ dữ liệu của đúng học sinh đó.
- **Giữ lại:** dấu `<id buổi>.ended` trên máy chủ bảng (chỉ chứa thời điểm) để token cũ không mở lại phòng; `ai_usage_log` (đã tách khỏi bài nộp theo khóa ngoại, không có nội dung bài).
- **Làm tiếp được:** `students.deleting_at` (migration 0005) là dấu bền. Thứ tự: dọn bảng và tệp, rồi xóa buổi học, tài khoản, hồ sơ. Hồ sơ còn đến bước cuối nên lần thử lại luôn biết cần dọn gì. Lỗi thì API trả 502 kèm phần chưa xong; web hiện "Đang xóa, chưa xong" và nút "Xóa tiếp"; vòng lặp nền làm tiếp sau 1 phút.
- **Không tạo lại dữ liệu đã xóa:** buổi học của học sinh đang xóa trả 404 (không vào lớp, không kết thúc); finalize nền bỏ qua; máy chủ bảng sau khi xóa không còn gì để trả về.
- **Lưu bảng chạy cùng lúc với xóa (bắt tay qua cơ sở dữ liệu, migration 0006):** trước khi tải bảng lên, finalize ghi một hàng `board_upload_intents` rồi mới đọc `deleting_at`; việc xóa ghi `deleting_at` rồi mới đọc các hàng đó. Mỗi bên là một câu lệnh trên cùng Postgres nên ít nhất một bên thấy bên kia: finalize thấy đang xóa thì không tải; bên xóa thấy hàng còn mới thì chưa dọn Storage, trả "bảng viết đang được lưu" và vòng lặp nền làm tiếp (không cần ai bấm lại). Không dùng khóa trong RAM, nên đúng cả khi chạy nhiều tiến trình API.
- **Quá hạn không phải bằng chứng thôi ghi (sửa 2026-10-20, migration 0007):** Storage không có ghi có điều kiện, nên không chứng minh được một uploader treo (hoặc yêu cầu HTTP đã gửi mà máy này hết thời gian chờ) sẽ không ghi muộn. Vì vậy hàng `board_upload_intents` **chỉ do chính uploader xóa** khi đã biết chắc kết quả: chưa ghi gì (thấy đang xóa trước khi tải), hoặc đã ghi xong và đã giữ file (học sinh còn học) hay gỡ file (học sinh đang/đã xóa). Lỗi, timeout, chết giữa chừng: hàng ở lại.
- **"Đã dọn lần này" khác "không còn ghi muộn":** bên xóa và vòng lặp nền không bao giờ xóa hàng, chỉ ghi `cleaned_at` mỗi lần đã xóa file. Quá 10 phút (`UPLOAD_LEASE`) chỉ có nghĩa là bên xóa thôi chờ (dọn Storage, xóa hồ sơ) và vòng lặp nền bắt đầu canh. `sweep_stale_uploads` mỗi chu kỳ: học sinh đang/đã xóa thì xóa đường dẫn `<student_id>/<session_id>.json` (không có thì thôi) và ghi `cleaned_at`; học sinh còn học thì không đụng gì (file là snapshot hợp lệ, hàng giữ phòng khi em bị xóa sau này). Lỗi Storage thì để chu kỳ sau. Hàng cố ý không có khóa ngoại để còn sau khi hồ sơ đã xóa; chỉ chứa id.
- **Bảo đảm đạt được (có test với FakeRepo):** mọi lần ghi có thể còn xảy ra đều còn một hàng bền; file của học sinh đang/đã xóa, kể cả ghi muộn sau khi hồ sơ đã xóa và uploader chết trước bước kiểm tra lại, bị xóa ở chu kỳ vòng lặp nền kế tiếp mà không cần ai bấm lại; snapshot hợp lệ và dữ liệu học sinh khác không bị đụng.
- **Phiên đăng nhập cũ:** token Supabase đã cấp vẫn hợp lệ đến khi hết hạn, nhưng API trả 403 vì không còn hồ sơ và RLS không còn hàng nào khớp. Token bảng bị máy chủ bảng chặn. Token video: còn vào lại được phòng nếu token chưa hết hạn (quyết định 18, đã xác nhận).
- **Chưa chốt, cần chủ dự án quyết định:** (1) dữ liệu đã xóa còn trong bản sao lưu của Supabase bao lâu, và có cần ghi nhận yêu cầu xóa để không khôi phục lại khi restore; (2) có giữ lại thông tin tối thiểu (vd. số buổi đã dạy để tính tiền) sau khi xóa hay không. Hiện tại: xóa ngay, không giữ gì ngoài dấu đóng bảng.
- **Giới hạn còn lại:** (1) file ghi muộn có thể tồn tại đến một chu kỳ vòng lặp nền (`NO_SHOW_INTERVAL_SECONDS`, mặc định 5 phút) trước khi bị xóa; DELETE trả 204 nghĩa là mọi dữ liệu đang có đã xóa và lần ghi muộn (nếu có) đang được canh, không có nghĩa là chắc chắn không còn ghi muộn. (2) Vòng lặp nền phải chạy (cần service key, `NO_SHOW_INTERVAL_SECONDS` > 0). (3) Hàng chưa xác nhận được canh mãi; sau khi xóa học sinh còn lại `student_id`, `session_id` (UUID, không liên kết gì) — gắn với câu hỏi giữ dữ liệu ở trên. (4) Mỗi chu kỳ xử lý tối đa 100 hàng, xoay vòng theo `cleaned_at`. (5) Bắt tay "ghi rồi đọc" dựa trên việc mọi tiến trình dùng chung một Postgres; đã kiểm bằng hai kết nối `psql` độc lập trên PostgreSQL 16 với đủ 6 thứ tự xen kẽ ở mức câu lệnh (`supabase/tests/handshake_test.sh`, chạy trong `run.sh` và CI), chưa kiểm qua PostgREST của Supabase thật. Chưa thử API Storage list/delete thật và bảng `board_upload_intents` trên Supabase thật.

## 20. Giao diện theo DESIGN.md, ưu tiên dễ dùng (2026-10-20)

- **Áp dụng:** tokens trong `apps/web/src/styles/tokens.css`, nền giấy kẻ ô, `Window` có title bar, viền đậm, bóng cứng, pastel. Bố cục lưới, cửa sổ không chồng nhau, không kéo thả, không dựng desktop giả.
- **Khác DESIGN.md có chủ đích:** không có nút đóng/thu nhỏ giả trên title bar (ba chấm chỉ trang trí, `aria-hidden`); nút thật trên title bar cao ≥ 44 px (AGENTS.md) thay cho 18 px minh họa. Nút chính dùng periwinkle, title bar hồng dùng `--pink-200` vì chữ `--ink-900` trên `--pink-400` chỉ đạt 4.3:1. Phòng học không có taskbar/trang trí, chỉ một thanh mỏng không phủ canvas.
- **Font:** không tải từ dịch vụ ngoài (học sinh vị thành niên, mạng yếu). Silkscreen không có dấu tiếng Việt nên font pixel chỉ dùng cho tên tệp ASCII; chữ Việt dùng font hệ thống (Segoe UI/Roboto) và serif Cambria/Noto Serif/Times New Roman. Georgia bị bỏ vì thiếu glyph dấu chồng ("ắ", "ầ"), trình duyệt ghép dấu rời (thấy trên ảnh chụp).
- **Xem trước:** `?preview=teacher|student` chỉ trong bản development, dữ liệu minh họa trong bộ nhớ, cùng component thật; bản production không chứa mã này.
- **Xem lại nếu:** muốn dùng font riêng (tự host tệp font có tiếng Việt trong `public/`), hoặc thêm chế độ tối.

## 21. Heartbeat cho bảng viết (2026-10-20)

- **Vấn đề:** đường truyền rớt mà TCP không đóng (mất sóng, đổi mạng, Offline của DevTools) thì trình duyệt không có sự kiện close; bảng vẫn báo "đã kết nối", nét tới chậm vài phút (đến khi TCP tự hết hạn). `readyState === OPEN` hay `send()` không lỗi không chứng minh máy chủ còn nhận được.
- **Cách làm:** heartbeat ở tầng ứng dụng, do trình duyệt chủ động: sau khi nhận `init`, cứ 5 giây gửi `{type:"ping", n}`, máy chủ trả `{type:"pong", n}` (chỉ số thứ tự, không token, không nội dung). Không có pong trong 10 giây: bỏ socket cũ (gỡ mọi handler, phản hồi muộn của nó bị bỏ qua), báo mất kết nối, nối lại theo backoff sẵn có. Nối lại mà không có `init` trong 10 giây: bỏ và thử lại. Backoff chỉ đặt lại khi nhận `init` (mở được socket chưa đủ). 4401/4410 vẫn dừng hẳn.
- **Vì sao 5 s/10 s:** mỗi ping vài chục byte, không đáng kể so với nét vẽ; chờ 10 giây đủ rộng cho 4G giật vài giây (không nối lại oan); báo mất kết nối chậm nhất khoảng 15 giây sau khi đường truyền treo. Đo trên Chrome: 13,4 s (proxy treo) và 14,3 s (Offline của DevTools).
- **Tab ẩn, máy ngủ:** timer bị trình duyệt hoãn nên không dựa vào việc timer chạy đúng giờ. Khi tab hiện lại, có mạng lại hoặc được focus, và ở mỗi nhịp heartbeat: pong mới nhất cũ hơn 2 chu kỳ thì hiện "Đang kiểm tra kết nối bảng…" và ping ngay; đang chờ nối lại thì nối ngay (vẫn chỉ một socket).
- **Nét vẽ:** "đã gửi" chỉ có giá trị trên kết nối hiện tại; mỗi lần nối lại, `init` là mốc và phần máy chủ chưa có được gửi bù (gồm nét đã `send` ngay trước khi đường truyền treo).
- **Máy chủ tự gỡ kết nối im lặng (bổ sung cùng ngày):** heartbeat của web chỉ giúp trình duyệt biết; máy chủ vẫn giữ peer của kết nối treo nên số thiết bị đếm thừa. Máy chủ ping bằng khung điều khiển WebSocket (`ws.ping()`) mỗi 15 giây cho mọi kết nối; pong hay bất kỳ tin nào nhận được đều tính là còn sống; hết một chu kỳ mà không có gì thì `terminate()`, handler `close` sẵn có gỡ khỏi phòng và gửi số thiết bị mới (chỉ chạy một lần mỗi socket; peer là đối tượng riêng nên không gỡ nhầm kết nối mới sau khi nối lại). Phòng rỗng thì theo đúng quy tắc giữ phòng/lưu đĩa sẵn có; buổi đã kết thúc không mở lại. Log chỉ id buổi.
  - Không dùng ping ứng dụng của web làm căn cứ: trình duyệt hoãn timer ở tab nền nên ping đó có thể ngừng dù đường truyền tốt. Pong khung điều khiển do trình duyệt tự trả lời ở tầng mạng, không cần JavaScript chạy.
  - Vì sao 15 giây: gỡ sau 15–30 giây, rộng hơn hạn 10 giây của web (máy chủ không ngắt trước khi web tự thấy, không ngắt oan khi 4G giật vài giây); mỗi chu kỳ chỉ vài byte. Bị ngắt oan thì web nối lại và gửi bù như khi rớt mạng. Đo trên Chrome headless: tab khỏe thấy bớt một thiết bị sau 28,3 s và 28,9 s.
  - Kèm theo: kết nối đóng trong lúc chờ kiểm token (`await verifyBoardToken`) trước đây vẫn được thêm vào phòng và không bao giờ bị gỡ; nay bỏ qua nếu socket không còn mở.
- **Chưa làm:** chưa đo trên 4G/tablet thật; thiết bị di động khóa màn hình có thể bị gỡ sau 15–30 giây (web nối lại khi mở máy).
- **Xem lại nếu:** thấy nối lại oan trên 4G yếu (tăng hạn chờ pong của web hoặc `heartbeatMs` của máy chủ), hoặc số thiết bị cần cập nhật nhanh hơn 30 giây.

## 22. Tích hợp đặc tả Tutor vào nền tảng hiện tại theo từng mốc (2026-10-20)

- **Đã được chủ dự án chọn:** giữ nền tảng hiện tại, tích hợp `TUTOR_PLATFORM_SPEC.md` theo từng mốc; không khởi tạo một ứng dụng thứ hai. Quy trình và cổng: `docs/platform-workflow.md`; bàn giao duy nhất: `docs/progress.md`.
- **Giữ:** Supabase Auth/JWT và vai trò từ profiles, FastAPI/Repository/Supabase migrations, React/Vite/npm, video và bảng hiện có. M0 bổ sung clock chung và eval offline; M1a bắt đầu bằng báo cáo xác định trước Teacher-Ops.
- **Báo cáo tháng hiện hành:** đếm completed theo scheduled_start trong khoảng tháng Việt Nam nửa mở; không đòi điểm danh/finalized_at. Loại học sinh đang xóa, không giữ số liệu sau xóa hẳn, không xuất ghi chú/phụ huynh. Đây là quyết định triển khai báo cáo đọc hiện trạng, chưa duyệt thay điều kiện completed hoặc chính sách lưu trữ.
- **Làm tiếp:** mỗi lát gồm quyền, Repository/FakeRepo, API, web, test và tài liệu. Bảng mới cần RLS/test; không tự đổi Cloud, gọi AI bằng dữ liệu học sinh hay deploy trong quyền thực hiện cục bộ này.
- **Xem lại nếu:** có yêu cầu tính tiền/lưu số liệu sau xóa, thay định nghĩa buổi hoàn thành, thay auth/stack hoặc chọn nhà cung cấp AI. Các phần này cần quyết định riêng trước khi áp dụng; nghiệm thu GĐ1 và lỗi token video vẫn mở.

## 23. Ghi chú sau buổi tách riêng, lưu cùng chủ đề bằng giao dịch có phiên bản (2026-10-20)

- **Lý do:** summary/homework_note hiện có thể được học sinh xem; không dùng chúng để chứa đánh giá riêng. Chủ đề dự kiến của buổi cũng chưa chứng minh đã dạy, nên không tự dùng làm quyền truy xuất Tutor.
- **Cách làm:** 0008 thêm session_notes, teaching_topics thuộc giáo viên và session_topics. Chỉ buổi completed có note/chủ đề đã dạy. Vai trò và quyền lấy từ profiles, session, student; học sinh/giáo viên khác nhận 404 với note buổi, RLS không trả hàng riêng. Mọi ghi qua API/Repository, RPC chỉ service_role được gọi.
- **Đồng thời:** RPC khóa học sinh rồi buổi, kiểm deleting_at, completed, chủ đề sở hữu và expected_revision trước khi ghi. Note và liên kết chủ đề commit cùng lúc; phiên bản cũ trả 409. Khi không chắc yêu cầu lưu đã thành công, giao diện giữ bản nháp và cho tải lại bản đã lưu trước khi sửa tiếp. Không thêm khóa trong RAM hay thay finalize.
- **Xóa và xuất:** xóa buổi/học sinh kéo theo note và liên kết bằng FK; danh mục chủ đề độc lập của giáo viên giữ lại. Xuất theo học sinh/tháng VN, Markdown đặt dữ liệu trong fence, CSV escape và vô hiệu công thức; không xuất thông tin phụ huynh hoặc token.
- **Giới hạn:** đây là khai báo chủ đề của giáo viên, chưa có tài liệu/Tutor. API/RLS/RPC đã kiểm cục bộ, chưa thử PostgREST/Supabase thật. Giữ cách tính completed hiện hành; chưa thay bằng điều kiện hai bên có media/điểm danh. Hoàn tác schema chỉ khi các bảng trống, code tương ứng đã gỡ; script không xóa dữ liệu đang dùng.
- **Xem lại nếu:** cần nhiều người cùng biên tập, phân loại mức độ nắm bài theo thang cố định, lưu lịch sử sửa note, xóa/lưu trữ danh mục chủ đề hoặc nối Tutor. Không tự lưu nội dung note trong audit/log.

## 24. Giao diện hai ngôn ngữ, font Nunito, trang giới thiệu (2026-10-20)

- **Yêu cầu:** chủ dự án muốn chế độ tiếng Anh–tiếng Việt, font tròn dễ đọc, trang giới thiệu cùng kiểu với ứng dụng, tối ưu điện thoại/tablet.
- **Cách làm:** không thêm thư viện i18n. Câu tiếng Việt trong code là khóa tra bản tiếng Anh (`apps/web/src/lib/i18n-en.ts`); thiếu bản dịch thì hiện tiếng Việt, test quét mã nguồn bắt khóa thiếu. Câu lỗi tiếng Việt của API được dịch khi hiển thị, logic so khớp dùng câu gốc. Ngôn ngữ lưu trên máy (localStorage), mặc định tiếng Việt. Font Nunito từ gói `@fontsource-variable/nunito` (OFL, chỉ tệp font) đóng gói vào bản build, không gọi Google Fonts. Trang giới thiệu ở `/` cho khách; người đã đăng nhập vẫn thấy trang chính ở `/`.
- **Giới hạn:** tên học sinh, môn, nội dung do người dùng nhập giữ nguyên. Câu lỗi API có tham số (vd. "Chưa xóa xong: …") vẫn tiếng Việt. Giao diện Excalidraw là tiếng Anh ở cả hai chế độ (gói vi-VN 49%). LiveKit dùng giao diện tiếng Anh của thư viện. Bản tiếng Anh do Claude Code viết, chưa có người bản ngữ duyệt.
- **Xem lại nếu:** cần thêm ngôn ngữ thứ ba, số nhiều phức tạp, hoặc dịch nội dung người dùng: khi đó cân nhắc thư viện (cần duyệt).

## 25. Lịch hằng tuần sinh buổi học thật, chống trùng bằng khóa (lịch, ngày) trong DB (2026-10-20)

- **Lý do:** spec M1 cần lịch cố định theo tuần; buổi sinh ra phải đi qua đúng luồng buổi học hiện có (vào lớp, kết thúc, báo cáo, ghi chú) và không được sinh trùng khi API chạy nhiều tiến trình.
- **Cách làm:** 0009 thêm `weekly_slots` và `sessions.slot_id/slot_date` unique. API sinh 28 ngày tới theo giờ Việt Nam, vòng lặp nền bổ sung; ngày trùng giờ bỏ qua và báo. Khóa (lịch, ngày) nên hủy/dời một buổi không làm nó bị sinh lại. Ngừng lịch hủy các buổi scheduled tương lai của lịch, giữ buổi đã học.
- **Giới hạn:** chưa có lịch cách tuần, nghỉ lễ, sửa giờ lịch (ngừng rồi tạo mới). Kiểm trùng giờ vẫn là đọc rồi ghi. Chưa áp 0009 lên Supabase thật.
- **Xem lại nếu:** cần ngoại lệ ngày nghỉ, nhiều giáo viên, hoặc Teacher-Ops tạo lịch qua chat (dùng lại cùng router, qua thẻ xác nhận).

## 26. Linh vật trợ giúp trong website, nội dung theo vai trò (2026-10-21)

- **Yêu cầu:** chủ dự án cung cấp hình tham chiếu, chọn bot ở góc website gia sư và xác nhận câu trả lời phải khác nhau giữa giáo viên/học sinh.
- **Cách làm bước đầu:** ảnh nền trong suốt chuẩn bị từ tham chiếu bằng imagegen (prompt/provenance trong `apps/web/src/assets/helper-mascot.md`), nút mở khung chat trong AppShell, hướng dẫn xác định theo vai trò đọc từ AuthProvider/profiles. Giáo viên có hướng dẫn học sinh/lịch/báo cáo/ghi chú; học sinh có lịch của mình, vào lớp, lịch sử/bảng và trợ giúp tài khoản. Người dùng tự mở và thao tác trên trang hiện có; không tự ghi dữ liệu qua chat. Không gắn vào vùng phòng học/bảng viết.
- **Riêng tư và giới hạn:** hội thoại chỉ trong bộ nhớ component, mất khi rời trang/tải lại/đổi tài khoản; không log, không lưu DB/localStorage, không gọi model hoặc đọc hồ sơ cá nhân. Trả lời theo hướng dẫn cố định, chưa phải Teacher-Ops/Tutor hay bot giải kiến thức. Chuỗi VI/EN; nút tối thiểu 44 px, thu gọn bằng nút/Escape, tôn trọng giảm chuyển động. Không thêm thư viện/dịch vụ mới.
- **Bước sau:** nếu cần trao đổi kiến thức hay thao tác nghiệp vụ bằng AI, nối theo `platform-workflow.md`: chọn provider/model/ngân sách/chính sách dữ liệu, kiểm quyền ở API/RLS, thẻ xác nhận ghi và bộ eval thích hợp. Linh vật không tự cấp quyền cho AI đọc ghi chú riêng hoặc giải bài tập của học sinh.

## 27. Bot OpenAI chỉ đọc, RAG văn bản lọc quyền trước khi gửi model (2026-10-21)

- **Yêu cầu đã chốt:** chủ dự án chọn OpenAI API; nguồn gồm hướng dẫn ứng dụng và bài giảng giáo viên cung cấp, hành vi khác nhau theo vai trò.
- **Cách làm:** Responses/function calling qua httpx sẵn có, chỉ tool `search_knowledge`; Repository/RPC 0010 lấy actor từ phiên, vai trò từ profiles. RAG full-text PostgreSQL, chunk trong DB; không thêm vector store, SDK lớn hoặc framework. Giáo viên nhập văn bản gắn chủ đề, không tự lấy note riêng/lời giải tham chiếu. HS cần tài liệu được công bố và chủ đề đã học.
- **Vận hành:** tắt mặc định, key/model chỉ ở API; quota DB theo người dùng/toàn ứng dụng, trần output mỗi request, không retry tự động. Không lưu transcript, `store:false`; vẫn cần kiểm retention nhà cung cấp. Giới hạn lượt không phải trần tiền.
- **Nghiệm thu:** API/RLS/UI kiểm cục bộ bằng dữ liệu giả, chưa gọi OpenAI thật. Bài giảng HS tắt riêng chờ E6/E7; bộ kiểm fail-closed không thay eval đối kháng. Chưa hoàn tất Teacher-Ops/Tutor. Cấu hình và giới hạn: [assistant.md](assistant.md).
- **Xem lại nếu:** cần tìm kiếm ngữ nghĩa, nhập PDF/ảnh, nhiều tài liệu, transcript bền hoặc tool ghi nghiệp vụ; đo chất lượng/chi phí trước khi mở rộng.

## 28. Ảnh đề bài đồng bộ và lưu cùng snapshot bảng (2026-10-22)

- **Yêu cầu đã chốt:** giáo viên chọn ảnh từ máy lên bảng và giữ ảnh khi xem lại buổi học. Chủ dự án đã yêu cầu triển khai.
- **Cách làm:** chuẩn hóa qua canvas ở web, chuyển theo mảnh trên socket bảng đã xác thực; máy chủ tính hash nội dung và ghi bền trước ACK. Ảnh nằm riêng cạnh scene, chỉ ID đi cùng phần tử/nét. Máy nhận nạp và kiểm hash tệp trước khi hiển thị. Hash phía web dùng SHA256 thuần TypeScript vì LAN HTTP không có `crypto.subtle`.
- **Lưu/xóa:** snapshot version 2 chứa elements/files, reader vẫn nhận mảng cũ. Dùng cùng upload intent, bucket riêng tư và quyền xem lại hiện có; purge dọn cả thư mục ảnh. Không thêm migration, dịch vụ hoặc thư viện; không gửi ảnh AI.
- **Giới hạn:** đầu vào 10 MiB, ảnh chuẩn hóa tối đa 2560 px/2 MiB; mỗi phòng 20 tệp/6 MiB, snapshot tối đa 20 MiB. Ảnh đã xóa khỏi scene vẫn giữ để hoàn tác và tính hạn mức. Chưa hỗ trợ PDF/ảnh động/URL. Nâng cấp đồng bộ ba thành phần web/API/bảng.
- **Xem lại nếu:** cần nhiều trang đề lớn, kho ảnh dùng lại hoặc giải phóng dung lượng giữa buổi; khi đó đánh giá lưu blob riêng thay vì mở rộng snapshot tùy tiện. Cách dùng và phạm vi kiểm thử: [whiteboard-images.md](whiteboard-images.md).


## 29. Giai đoạn 2: chữa bài trên ảnh, hồ sơ học sinh, yêu cầu làm lại (2026-10-22)

- **Yêu cầu đã chốt:** chủ dự án cho làm GĐ2 song song với nghiệm thu GĐ1, chọn Excalidraw làm công cụ chữa bài và cần trạng thái "cần làm lại".
- **Chữa trên ảnh:** Excalidraw toàn màn hình (cùng thư viện, cùng cách viết bút như bảng), ảnh gốc khóa làm nền, xuất JPEG thành tệp `submission_files.kind = 'annotated'` (cột có từ 0001) qua API, gỡ metadata như ảnh nộp. Không lưu scene để sửa lại; "Chữa tiếp" tạo ảnh mới từ ảnh chữa. Giáo viên xóa được ảnh chữa, không xóa được ảnh gốc. OCR chỉ gửi ảnh gốc.
- **Cần làm lại:** không thêm trạng thái DB. Trả bài kèm `redo` giữ lượt nộp ở `returned` (học sinh đọc nhận xét, ảnh chữa) và đưa bài tập về `assigned`; web hiểu "assigned + đã có lượt nộp" là "Cần làm lại". Bắt buộc có nhận xét. Không migration, không policy mới.
- **Hồ sơ học sinh:** trang chỉ đọc `/students/:id` gom dữ liệu đã có qua RLS; lọc theo học sinh phía trình duyệt (một giáo viên, ít học sinh).
- **Giới hạn đã biết:** RLS 0001 cho học sinh đọc mọi `submission_files` của bài mình, nên ảnh chữa đọc được qua Supabase ngay khi lưu dù giao diện chỉ hiện khi đã trả. Chưa giới hạn số lần làm lại.
- **Xem lại nếu:** cần giấu ảnh chữa tới lúc trả (policy theo `kind` + trạng thái), cần sửa lại nét đã lưu (lưu scene), hoặc báo cáo cần phân biệt "chưa nộp" với "cần làm lại" ở DB.

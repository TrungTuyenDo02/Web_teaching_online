# Đánh giá khả thi và kế hoạch thực hiện

> Đây là bản đánh giá lịch sử ngày 19/10/2026; nhiều mục thiếu dưới đây đã được triển khai sau đó. Hiện trạng và kế hoạch giao Claude Code cập nhật ngày 20/10 ở [claude-code-plan.md](claude-code-plan.md), tiến độ thực tế ở [progress.md](progress.md).

Ngày: 19/10/2026. Đã đọc tài liệu, mã nguồn ứng dụng, migration, test và cấu hình triển khai; chạy kiểm tra cục bộ. Không sửa code ứng dụng, không đọc nội dung file `.env`. Workspace có thay đổi đồng thời trong phiên; đánh giá đã cập nhật theo trang `StudentsPage` và quyết định 8–9 mới xuất hiện.

## Kết luận

Đề tài khả thi cho một giáo viên quản lý nhiều học sinh và dạy từng buổi 1-1. Kiến trúc hiện tại phù hợp để tiếp tục: React cho giao diện, FastAPI cho nghiệp vụ nhạy cảm, Supabase cho tài khoản/dữ liệu, LiveKit cho video, WebSocket riêng cho bảng. Tablet chỉ truyền dữ liệu bảng viết phù hợp yêu cầu nét rõ và không thêm thiết bị video.

Đây là bộ khung có các luồng chính và test, chưa đủ bằng chứng để dùng ngay cho buổi học thật. Hai điều kiện cần kiểm chứng đầu tiên là trải nghiệm bút trên đúng tablet và hoạt động đồng thời của laptop giáo viên, tablet giáo viên, thiết bị học sinh qua dịch vụ thật. Rủi ro lớn nhất về code là độ bền dữ liệu bảng, đóng phòng và quyền riêng tư theo cột.

Khả thi kỹ thuật chưa chứng minh hiệu quả kinh doanh hoặc chất lượng AI chấm bài. Cần pilot để đo thao tác giáo viên, khả năng học sinh tự vào lớp, lỗi thực tế và chi phí.

## Cấu trúc và hiện trạng

| Khu vực | Đã có | Còn thiếu đáng chú ý |
|---|---|---|
| `apps/api/app` | JWT HS256, Repository/PostgREST, join/end/me, kiểm tra quyền/giờ/trạng thái, điểm danh, ký token | Tạo tài khoản học sinh; đóng kết nối thật; cập nhật trạng thái chống cạnh tranh; tương thích signing key dự án thật |
| `apps/web/src/pages` | Đăng nhập, danh sách buổi sắp học, phòng học; mới có quản lý học sinh | Tài khoản đăng nhập học sinh, tạo/sửa/hủy buổi trên web, lịch sử buổi, quên mật khẩu |
| `StudentsPage.tsx` | Thêm/sửa, ghi nhận đồng ý, ngừng dạy/dạy lại, xóa hẳn học sinh đã ngừng dạy | Chưa thử với Supabase thật; xóa hẳn chưa dọn Storage/Auth theo `decisions.md` |
| `components/VideoPanel.tsx`, `Whiteboard.tsx` | Video, Excalidraw, tải PNG về máy | Kiểm chứng bút/chạm tay; lưu và mở lại bảng; điều chỉnh video cho lớp 1-1 |
| `hooks/useBoardSync.ts` | Gửi phần tử thay đổi mỗi nhịp 40 ms, gộp phần tử, thử nối lại | ACK/resync, token refresh, ảnh/binary và test frontend khi mất mạng |
| `services/whiteboard-sync` | Xác thực, tách phòng, gộp version/nonce, giới hạn payload, kiểm tra Origin | Lưu bền, đóng phòng, heartbeat, giới hạn tài nguyên theo phòng/người dùng |
| `supabase/migrations` | Schema GĐ1/GĐ2, RLS, bucket riêng tư; schema AI dự kiến | Quyền theo cột, quan hệ dữ liệu, RLS nhiều giáo viên; chưa có chức năng GĐ2/GĐ3 hoàn chỉnh |
| CI, Docker, Makefile | Khung test/lint/build và triển khai | CI chưa chạy RLS; chưa kiểm chứng Docker, HTTPS/WSS và backup/restore thật |
| `docs` | Kiến trúc, quyết định, sơ đồ, tiến độ | README còn mô tả chưa có trang học sinh; một số mô tả cần đối chiếu lại code |

Điểm tốt cần giữ: vai trò lấy từ `profiles`, người ngoài buổi học nhận 404, chế độ `board` không nhận token video, LiveKit được cô lập, các bảng có RLS và hai backend có test. Chưa cần đổi stack hoặc tách thêm microservice.

## Những vấn đề cần xử lý

Các phát hiện dưới đây dựa trên code. Chưa thực hiện kiểm thử khai thác trên Supabase thật; rủi ro hành vi trình duyệt cần test tái hiện trước khi sửa.

### Ưu tiên trước buổi dạy thật

1. **Kết thúc buổi học chưa đóng phòng đang hoạt động.** `apps/api/app/routers/sessions.py:end_session` chỉ cập nhật database. Chưa đóng video, chưa báo máy chủ bảng, chưa đưa học sinh/tablet ra khỏi phòng. Token bảng chỉ kiểm tra lúc xác thực kết nối. Cần chặn cấp quyền mới, đóng kết nối hiện có và xử lý token cũ; test cả máy đang trong phòng và máy dùng lại token. LiveKit có API quản lý phòng/participant; hết hạn token không tự ngắt người đang kết nối. Cách thu hồi còn phụ thuộc Cloud hay tự host. [Token lifecycle](https://docs.livekit.io/frontends/reference/tokens-grants/), [quản lý participant](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/).

2. **Bảng có thể mất khi restart server.** `RoomHub` chỉ giữ RAM và dọn phòng sau thời gian chờ khi hết người. PNG tải thủ công chưa thay cho lưu bảng. Cần scene JSON định kỳ để phục hồi và PNG cuối buổi để xem lại; lưu binary riêng nếu cho chèn ảnh. Một tiến trình cộng lưu snapshot đủ cho MVP, chưa cần Redis.

3. **Nối lại chưa bảo đảm gửi đủ dữ liệu.** `useBoardSync` ghi version đã gửi ngay sau `socket.send`, chưa có ACK. Khi server mất scene, hook không xóa trạng thái version đã gửi; nhận `init` rỗng rồi flush có thể không gửi lại phần tử không đổi. Đây là rủi ro suy ra từ code, chưa có test trình duyệt tái hiện trong phiên này. Cần test restart, mất mạng trước ACK, hai phía sửa đồng thời và nối lại sau khi phòng bị dọn.

4. **Ghi chú riêng chưa được cách ly khỏi học sinh.** UI mới ghi “Ghi chú riêng (học sinh không thấy)”, nhưng `students_self_select` cho học sinh đọc hàng của mình. RLS lọc hàng, không tự che cột `notes`. Dù UI học sinh chưa hiển thị, người dùng vẫn có thể gọi Data API trực tiếp nếu có quyền SELECT thông thường. Cần tách dữ liệu riêng hoặc thiết kế quyền theo cột/view, kèm test quyền học sinh.

5. **Nơi kiểm soát trạng thái chưa thống nhất.** `sessions_teacher_all` cho giáo viên cập nhật session trực tiếp, trong khi kiến trúc nói nghiệp vụ nhạy cảm qua API. Cần quy định rõ trường web được ghi và trường chỉ API ghi. Join/end hiện đọc rồi cập nhật tách rời, chưa có transaction/cập nhật theo trạng thái kỳ vọng; cần test hai thao tác chạy đồng thời.

6. **Xác thực phải tương thích dự án Supabase thật.** API chỉ nhận HS256. Nếu dự án ký ES256/RS256 thì đăng nhập web có thể thành công nhưng join API thất bại. Đối chiếu signing key thực tế, hỗ trợ JWKS khi cần, kiểm tra issuer/audience và test xoay khóa. Supabase khuyến nghị khóa bất đối xứng cho production. [Tài liệu chính thức](https://supabase.com/docs/guides/auth/signing-keys).

7. **Bút Android chưa được kiểm chứng.** Nét thẳng và `touch-action: none` chưa chứng minh chặn chạm tay tốt. Thử bút, đặt lòng bàn tay, tẩy, zoom/pan, undo, đổi hướng màn hình trong 45–60 phút. CSS `.small` còn đặt vùng chạm tối thiểu 36 px, thấp hơn yêu cầu 44 px.

### Hoàn thiện trong Giai đoạn 1

- `RoomPage` giữ một `joinPromise` không khóa theo `sessionId`/`mode`: khi đổi route mà component không unmount có nguy cơ dùng kết quả join cũ. Viết test đổi buổi và đổi `main`/`board`.
- Giao thức bảng chỉ truyền `elements`, chưa truyền `files`: phần tử ảnh không đủ để máy khác có nội dung ảnh. Hỗ trợ hoặc ẩn chèn ảnh trong MVP.
- Server giới hạn 2.000 phần tử/update nhưng client chưa chia lô. Test scene lớn, buổi học dài, giới hạn bộ nhớ/tần suất và heartbeat.
- Token bảng hết hạn khi nối lại hiện chỉ làm hook ngừng retry; cần lấy token mới hoặc thông báo thao tác rõ ràng.
- Điểm danh ghi lúc yêu cầu join, chưa chứng minh thiết bị kết nối thành công; `left_at` chưa được cập nhật. Chưa dùng để tính thời lượng hoặc thu phí.
- Phép so sánh entry point `import.meta.url === file://${process.argv[1]}` trong `server.ts` trả false với đường dẫn Windows trong phép kiểm tra cục bộ. Cần test khởi động tiến trình trên Windows và dùng API URL/path chuẩn. `.pathname` trong `config.ts` cũng cần kiểm chứng trên Windows.
- Chưa có test frontend/E2E; test server chưa chứng minh hook reconnect, restart, ảnh hoặc đóng phòng.
- Tài liệu nhắc `SUBMISSION_RETENTION_DAYS` nhưng `Settings` chưa khai báo và chưa có tác vụ dọn dữ liệu. Cần thống nhất và thực thi giữ/xóa dữ liệu. Với xóa hẳn học sinh, dọn Storage/Auth phải có retry để tránh dữ liệu mồ côi.

### Lưu lại cho GĐ2 hoặc khi có nhiều giáo viên

- Policy INSERT bài nộp chưa ngăn học sinh tự điền `score`, `teacher_comment`, `returned_at`, chưa buộc assignment thuộc đúng học sinh. Chặn trước khi mở nộp bài.
- `profiles_select`, quyền giáo viên trên bucket `boards`, `ai_usage_log` rộng hơn phạm vi học sinh của từng giáo viên. Test hiện chỉ có một giáo viên nên chưa chứng minh cách ly giữa giáo viên.
- Policy tạo session chưa buộc học sinh thuộc cùng giáo viên. Cần kiểm tra quan hệ này trước khi hỗ trợ nhiều giáo viên.
- Đây là việc phải ghi nhận để thiết kế đúng, chưa phải yêu cầu triển khai GĐ2/GĐ3 ngay.

## Kế hoạch thực hiện

Giữ phạm vi một giáo viên. API tiếp tục qua `Repository`, Supabase giữ Auth/PostgreSQL/Storage với RLS, tablet chỉ bảng, LiveKit xử lý video. Chỉ cân nhắc app Android hoặc đổi bảng sau khi thử nghiệm cho thấy trình duyệt không đạt.

Ước lượng dành cho một lập trình viên toàn thời gian, quen stack, có thiết bị và tài khoản thử. Mỗi lát phải có test, chạy được từ đầu đến cuối rồi mới sang lát tiếp; sửa lỗi phải có test tái hiện trước. Đây là dự toán, không phải cam kết tiến độ.

| Thứ tự | Công việc | Điều kiện nghiệm thu | Công sức dự kiến |
|---|---|---|---|
| 0 | Thử ba thiết bị qua Supabase/LiveKit thật trên HTTPS/WSS, với dữ liệu giả | Viết 45–60 phút, đo độ trễ/chạm tay; tablet không mở video/micro | 1–3 ngày |
| 1 | Quyền ghi chú riêng, xác thực thật, khởi động Windows, quy tắc ghi trạng thái | Test quyền đạt; đăng nhập/join đúng signing key; server chạy bằng lệnh tài liệu | 3–5 ngày |
| 2 | Hoàn thiện trang học sinh đã có; tạo tài khoản qua API theo quyết định 8; tạo/sửa/hủy buổi | Giáo viên tự chuẩn bị buổi trên web, học sinh đăng nhập và chỉ thấy buổi của mình | 4–6 ngày |
| 3 | Vào học, viết, mất mạng/nối lại, autosave/restore, kết thúc, xem lại bảng | Hai phía hội tụ scene; restart phục hồi; end đóng cả ba thiết bị; xem lại PNG | 5–8 ngày |
| 4 | Triển khai, RLS trong CI, backup/restore, cảnh báo lỗi/hạn mức, giữ/xóa dữ liệu | Triển khai lặp lại được, khôi phục được dữ liệu thử, không log nội dung học sinh | 3–5 ngày |
| 5 | Pilot 3–5 học sinh, sửa lỗi theo ảnh hưởng | 5–10 buổi trọn vẹn; giáo viên tự vận hành; không còn lỗi mất bảng hoặc sai quyền chưa giải quyết | Khoảng 1 tuần lịch |

Tổng dự kiến **4–7 tuần đến MVP đã pilot**, tùy bút và lỗi tích hợp. Bán thời gian cần dài hơn. Không lấy số test đạt làm tỷ lệ phần trăm hoàn thành sản phẩm.

Ngưỡng nghiệm thu đề xuất, cần điều chỉnh sau đo: nét tại máy viết dưới 50 ms, sang máy học sinh dưới 250 ms ở mạng thử thông thường; mất mạng 30 giây rồi nối lại không mất nét; refresh phục hồi bản đã lưu và giới hạn mất dữ liệu không vượt chu kỳ autosave đã công bố. Đây là mục tiêu, chưa phải kết quả đã đạt.

Đã ghi nhận quyết định mới: giáo viên tạo tài khoản học sinh; thiếu `consent_at` chỉ cảnh báo, không chặn vào lớp; ngừng dạy là thao tác mặc định thay cho xóa hẳn. Không tự đổi các lựa chọn này trong phiên đánh giá. Còn cần chốt quyền học sinh viết bảng hay chỉ xem, vào trước giáo viên, thời hạn lưu dữ liệu và nội dung snapshot.

MVP tập trung đăng nhập, quản lý học sinh tối thiểu, buổi học, camera/micro, bảng tablet, phục hồi, lưu/xem lại bảng, đóng phòng, phân quyền và triển khai. Hồ sơ chi tiết/lịch lặp/nhắc lịch/giao–nộp–chữa bài thuộc GĐ2; không tiếp tục mở rộng chúng trong đợt GĐ1 này.

Sau khi GĐ1 ổn định, có thể dự toán GĐ2 thêm 3–5 tuần cho hồ sơ/lịch và giao–nộp–chữa–trả bài. GĐ3 bắt đầu bằng thử nghiệm tập bài được phép sử dụng, rubric, đo lỗi đọc chữ/nhận xét và chi phí; giáo viên duyệt trước khi trả. Chưa thể dự toán AI production đáng tin cậy khi thiếu tập đánh giá và tiêu chí chất lượng.

## Chi phí và quy mô

Chi phí theo thời lượng dạy và lượng video truyền, không chỉ số tài khoản. Công thức gần đúng: `số buổi × phút/buổi × 2` participant-minutes cho lớp có hai máy video. Tablet chỉ bảng không thêm participant video.

Ví dụ 20 học sinh × 8 buổi/tháng × 60 phút = 160 giờ dạy và 19.200 participant-minutes. Đây là ví dụ tính tải, không phải dự báo doanh thu.

Trang giá kiểm tra trong phiên niêm yết LiveKit Build 0 USD với 5.000 phút WebRTC và 50 GB downstream; Ship 50 USD/tháng với 150.000 phút và 250 GB downstream, vượt mức lần lượt 0,0005 USD/phút và 0,12 USD/GB. Phải tính cả GB; không suy ra tổng hóa đơn chỉ từ số phút. Giá có thể thay đổi. [Nguồn chính thức](https://livekit.com/pricing).

Còn API/bảng WebSocket, database, Storage, backup và tên miền. Đo GB video và dung lượng snapshot qua pilot rồi chốt ngân sách; chưa có đủ số đo để đưa tổng chi phí tháng đáng tin cậy. Hiện chưa cần tự host video chỉ để giảm hóa đơn.

## Kiểm tra đã chạy trong phiên

| Kiểm tra | Kết quả thực tế |
|---|---|
| `make test`, `make lint`, `make build-web` | Đã thử; `make.exe` không khởi chạy trong môi trường này, chuyển sang lệnh thành phần |
| API pytest | 13 test đạt; cảnh báo Starlette/httpx và không ghi được cache pytest |
| Ruff check/format API | Đạt, 17 file đúng định dạng |
| Typecheck web và whiteboard-sync | Đạt |
| `npm.cmd test` whiteboard-sync | Lỗi môi trường `tsx`: `uv_os_get_passwd`/ENOMEM, test chưa chạy |
| `node --experimental-transform-types --test test/scene.test.ts test/server.test.ts` | 14 test đạt trên Node 24.21.0; chưa chứng minh đường chạy tsx/Node 22 đạt |
| Build web mặc định | Biên dịch module xong, lỗi EPERM khi chuẩn bị `dist/assets` có sẵn |
| Build web với `--outDir node_modules/.cache/assessment-build-20261019` | Đạt; còn cảnh báo chunk lớn |
| PostgreSQL/RLS | Chưa chạy lại, thiếu `psql` trong PATH; kết quả cũ trong README không tính là kết quả phiên này |
| Dịch vụ thật, tablet, Docker, E2E trình duyệt | Chưa thử |

Build cho thấy riêng Whiteboard khoảng 1.093 KB / gzip 345 KB và VideoPanel khoảng 659 KB / gzip 177 KB, còn các chunk phụ. Đây là kích thước artifact, chưa phải số đo dung lượng thực tải hay thời gian vào lớp trên 4G.

Việc tiếp theo hợp lý nhất: lát 0 với ba thiết bị và dữ liệu giả, đồng thời chuẩn bị test cho đóng phòng, phục hồi bảng và quyền đọc ghi chú riêng; chưa mở rộng bài tập hoặc AI.

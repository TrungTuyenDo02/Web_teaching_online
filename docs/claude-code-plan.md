# Rà soát lộ trình và kế hoạch giao Claude Code

Ngày: 20/10/2026. Phạm vi: Giai đoạn 1, một giáo viên, lớp 1-1, học sinh chỉ xem bảng. Đối chiếu mã nguồn đang có trong workspace, không chỉ bản đã commit. Phiên này chỉ sửa tài liệu; không đọc file `.env`, không sửa ứng dụng hoặc migration.

## Cập nhật sau khi Claude Code thực hiện lát 1–3

Đã đối chiếu lại `store.ts`, `rooms.ts`, `boardConnection.ts`, `finalize.py`, router sessions/students, migration 0004, test và CI. Dùng mục này cùng `docs/progress.md` để giao việc tiếp theo; các phát hiện ban đầu bên dưới được giữ làm lịch sử.

| Phần việc | Hiện trạng | Giới hạn còn lại |
|---|---|---|
| Lát 0: tài liệu và thử bút | Có hướng dẫn chung và sổ bàn giao | Chưa nghiệm thu tablet/ba thiết bị; README và kiến trúc còn cần đồng bộ |
| Lát 1: đóng bảng lưu bền | Có dấu `.ended`, kiểm tra sau restart, chặn update đến muộn, xử lý lỗi đĩa | Test cục bộ đạt; chưa thử crash/mất điện và thiết bị thật |
| Lát 2: kết thúc có retry | Có `finalized_at`, dịch vụ finalize, retry nền, `/end` gọi lặp và cập nhật theo trạng thái kỳ vọng | Nhật ký chưa xác nhận áp 0004 thật; RLS chưa chạy lại; còn khe hở cấp token khi join đồng thời end |
| Lát 3: đồng bộ bảng lớn/mất mạng | Có lô 500 phần tử/1 MB, điều tiết gửi, resync, xử lý versionNonce, chặn ảnh | Có 8 ca client chạy với server thật cục bộ; chưa phải test giao diện Excalidraw/RoomPage hoặc bút thật |
| Lát 4: xóa học sinh đầy đủ | Chưa làm | Router vẫn xóa hồ sơ trước Auth, chưa dọn Storage/file bảng và chưa có retry bền |
| Lát 5: nghiệm thu/vận hành | Chưa hoàn tất | CI chưa có job RLS; chưa kiểm chứng dịch vụ thật, backup/restore và pilot |

### Thứ tự từ thời điểm này

1. **Trước khi chạy API mới với Supabase thật:** xác nhận migration `0004_session_finalize.sql` đã áp. Nhật ký đang ghi chưa áp; phiên rà soát này không kết nối Supabase nên không khẳng định trạng thái thật đã thay đổi. Chạy RLS trên DB thử tách biệt, không chạy script tạo/xóa database trên môi trường chứa dữ liệu thật. Nếu chưa có quyền truy cập, chuẩn bị hướng dẫn thao tác và để “chưa xác minh”. Không sửa hoặc chạy lại migration đã áp.
2. **Công việc code kế tiếp: Lát 4.** Hoàn thiện xóa hẳn học sinh có retry, dọn đúng Auth/Storage/file bảng, giữ đủ thông tin để phục hồi khi lỗi. Dùng prompt bên dưới, không làm lại lát 1–3.
3. **Trước pilot:** viết test tái hiện và xử lý join đồng thời end. Code hiện vẫn có đường cấp token sau khi đọc buổi `live` nhưng buổi vừa thành `completed`; cần kiểm cả điểm danh đến muộn và hành vi dùng token video cũ trên LiveKit thật. Không đánh dấu an toàn tuyệt đối bằng một lần đọc lại trạng thái hoặc mock video.
4. **Lát 5:** RLS trong CI và test quyền đọc bucket `boards`; smoke test giao diện; upload/download snapshot và đóng video thật; backup/restore.
5. **Giáo viên thử thiết bị sớm bằng dữ liệu giả**, rồi nghiệm thu buổi 45–60 phút và pilot 5–10 buổi sau các bước trên. Chỉ mở GĐ2 khi được yêu cầu.

Kiểm tra thực chạy ở lần cập nhật này: API **80 test**, board **33 test** đạt; Ruff check/format, typecheck board và build web (gồm typecheck) đạt. Ba lệnh `make` không khởi chạy được `make.exe`; dùng lệnh thành phần, board chạy bằng Node 24 transform-types. Chưa chứng minh đường chạy chuẩn Node 22/tsx. Chưa chạy lại RLS (không có `psql`/Docker trong PATH), chưa thử Supabase/LiveKit/tablet thật. Code ứng dụng không thay đổi trong phiên lập kế hoạch này.

## Đánh giá tổng thể

Hướng đi phù hợp và đã có phần lớn luồng chức năng cốt lõi. Việc tiếp theo là chứng minh độ tin cậy của một buổi học hoàn chỉnh: vào lớp, viết, mất mạng, phục hồi, kết thúc và xem lại. Chưa có bằng chứng để coi GĐ1 đã nghiệm thu hoặc chuyển ngay sang giao–nộp–chữa bài.

Giữ stack hiện tại. Chưa có lý do từ lần rà soát này để thêm Redis, hàng đợi riêng, app Android hoặc AI. Dùng công việc chờ xử lý được lưu bền ở quy mô nhỏ khi cần khôi phục thao tác nhiều dịch vụ.

## Lộ trình đã thực hiện

| Mốc | Đã có trong code | Bằng chứng và giới hạn |
|---|---|---|
| Bộ khung GĐ1 | Auth, kiểm tra thành viên buổi học, token video/bảng, tablet chỉ bảng, RLS | Có test backend; chưa nghiệm thu ba thiết bị qua dịch vụ thật |
| Quản lý trước buổi học | CRUD học sinh qua API; ngừng dạy; tạo tài khoản; đặt lại mật khẩu; tạo/sửa/hủy buổi, kiểm tra trùng giờ, `no_show` | Có test API; chưa chứng minh toàn bộ hành vi Auth/PostgREST thật |
| Quyền và nghiệp vụ | Vai trò từ `profiles`; người ngoài buổi nhận 404; học sinh chỉ xem bảng; số buổi theo `completed` | Migration 0003 giới hạn quyền ghi và cột riêng tư; nhật ký 20/10 ghi đã áp thật, phiên này chưa xác minh lại |
| Kết thúc và xem lại | Đóng LiveKit/bảng, ghi điểm danh rời; scene JSON trên đĩa; snapshot JSON vào Storage; `/history`, xem lại bảng | Có test với giả lập dịch vụ; chưa thử upload/download và đóng video thật trọn luồng |
| Sửa lỗi tích hợp | Khởi động bảng trên Windows; mặc định API dùng `127.0.0.1`; token cho buổi dài; resync theo `init`; join theo buổi/chế độ; nút nhỏ 44 px | Có code và test backend liên quan; chưa có test web tự động |

Tài liệu cũ không còn là danh sách việc chưa làm: `assessment-and-plan.md` ngày 19/10 còn mô tả thiếu ES256, quản lý buổi, lưu bảng và đóng phòng; README cũng còn số test và mô tả cũ. Quyết định 17 đã chọn JSON, không phải bắt buộc bổ sung PNG vào Storage. Học sinh đã xem được lịch sử/nội dung/bài về nhà; GĐ2 còn thiếu luồng giao, nộp, chữa và trả bài.

## Ưu điểm

- Mô hình laptop có video và tablet truyền nét vẽ bám đúng thiết bị dạy học; `board` không được cấp token video.
- Phạm vi một giáo viên, học sinh chỉ xem giúp giảm đáng kể độ phức tạp đồng bộ và vận hành.
- API tập trung nghiệp vụ qua Repository; hai nơi tích hợp LiveKit được cô lập. Có thể tiếp tục phát triển mà chưa đổi kiến trúc.
- Có bảo vệ ở cả API và database: vai trò từ hồ sơ, kiểm tra sở hữu, 404 với buổi không thuộc người gọi, quyền đọc cột và RLS.
- Đã làm theo các luồng có ích cho giáo viên, kèm test backend và sổ bàn giao; đã có lưu đĩa bằng file tạm rồi đổi tên và volume Docker.

## Phát hiện tại lần rà soát ban đầu, trước lát 1–3

Đây là căn cứ lập kế hoạch ban đầu, không phải toàn bộ lỗi vẫn còn mở. Các mục đóng bảng mất trạng thái, retry kết thúc, giới hạn gửi/versionNonce và ảnh đã có xử lý như bảng cập nhật phía trên. Phần còn mở phải lấy theo hiện trạng mới và điều kiện nghiệm thu.

| Mức | Phát hiện | Căn cứ và ảnh hưởng |
|---|---|---|
| P0 | Trạng thái đóng bảng mất sau restart | `src/rooms.ts` giữ `ended` trong RAM nhưng `join()` nạp scene từ đĩa. Tái hiện ở cấp `RoomHub` với store giả: trước restart `isEnded=true`, sau tạo hub mới `false`, join nạp lại 1 phần tử. Token cũ còn hạn có thể qua kiểm tra đóng phòng sau restart. Chưa thử lại bằng trình duyệt/dịch vụ thật |
| P0 | Kết thúc buổi chưa có cơ chế phục hồi đủ | `end_session()` ghi `completed`, rồi đóng phòng/upload; lỗi bị bắt và chỉ log. Gọi `/end` lần nữa bị 409 vì không còn `live`. `close_attendance()` còn nằm ngoài các khối bắt lỗi. Không có trạng thái bền để biết bước nào cần thử lại |
| P0 | Xóa hẳn chưa dọn dữ liệu bảng | `delete_student()` xóa hồ sơ trước Auth, không xóa Storage hoặc file bảng cục bộ. Nếu Auth lỗi, hồ sơ đã mất khiến gọi lại không đủ thông tin. Đây đã là thiếu sót GĐ1 vì hiện có lưu bảng |
| P1 | Đồng bộ web chưa có kiểm thử và giới hạn không khớp | Hook gửi mọi phần tử đổi trong một message; server chặn trên 2.000 phần tử hoặc 5 MB. Có nguy cơ bị ngắt khi resync scene lớn. `socket.send()` được coi là đã gửi, chưa có ACK; lần sửa `init` chỉ xử lý một phần tình huống |
| P1 | Ảnh chèn vào bảng chưa đồng bộ/lưu | Code truyền `elements`, không truyền `files`; chỉ có phần tử ảnh thì thiết bị khác/xem lại thiếu nội dung. Cần chặn đường chèn ảnh trong MVP hoặc làm hỗ trợ đầy đủ khi được yêu cầu |
| P1 | Đọc rồi cập nhật trạng thái có thể ghi đè thao tác khác | `join`, sửa, hủy, kết thúc chưa cập nhật có điều kiện theo trạng thái kỳ vọng. Một giáo viên vẫn có hai thiết bị và có thể bấm lặp. Chưa tái hiện cạnh tranh trong phiên này; phải viết test trước khi sửa |
| P1 | Chưa chứng minh tích hợp/vận hành | Chưa có test web; CI hiện chưa chạy RLS; chưa nghiệm thu HTTPS/WSS, backup/restore volume, bút và luồng ba thiết bị. Test persist hiện dừng server có flush, chưa chứng minh mọi tình huống crash/mất điện |
| P2 | Tài liệu lệch trạng thái và thiếu đo đạc | Việc đã làm vẫn ở backlog; chưa có số đo bút/4G/dung lượng bảng/chi phí qua pilot. Ước lượng cũ 4–7 tuần tính từ thời điểm trước nhiều thay đổi, không nên dùng nguyên làm thời gian còn lại |

P0: xử lý trước khi đưa dữ liệu học sinh thật vào dùng thường xuyên. P1: hoàn thiện và kiểm chứng trước pilot. Test phần mềm đạt không thay cho thử thiết bị.

## Kế hoạch giao việc theo từng lát

Không giao toàn bộ danh sách trong một phiên. Hoàn tất điều kiện nghiệm thu của từng lát, cập nhật tiến độ rồi mới chuyển. Lát 1–3 đã có code và test cục bộ; dùng mô tả dưới đây để kiểm tra phần nghiệm thu còn thiếu, không triển khai lại. Lát 4 là công việc code tiếp theo.

### Lát 0 — Chốt hiện trạng và chuẩn bị kiểm thử thật

- Đọc các AGENTS liên quan; kiểm tra diff hiện có, giữ nguyên thay đổi người dùng; không reset hoặc gom commit hàng loạt.
- Đồng bộ README, kiến trúc và các ghi chú cũ với code: JSON snapshot, lưu đĩa, token theo khung buổi, 64/22 là số test tại lần rà soát này, không phải số cố định.
- Có lệnh kiểm tra thành phần khi `make` không chạy; ghi phiên bản Node/Python thực tế. CI dùng Node 22 theo dự án; không coi kết quả Node 24 thay thế là đã xác nhận Node 22.
- Lập checklist staging dùng dữ liệu giả và bảng kết quả: đạt, lỗi, chưa thử. Dùng health check/thông báo đã che bí mật để xác minh cấu hình; không đọc/in `.env`, không tự khẳng định khóa còn thiếu từ nhật ký cũ.
- Nhật ký ghi 0003 đã áp: kiểm tra quyền hiện tại, không chạy lại migration đã áp và không sửa migration cũ.

Nghiệm thu: người thử mở được đúng web/API/bảng ở môi trường thử; tài liệu phân biệt rõ đã có code, đã test cục bộ, đã thử dịch vụ thật. Giáo viên thử bút sớm ở lát này, không đợi viết xong mọi hạng mục.

### Lát 1 — Đóng bảng vẫn có hiệu lực sau restart

- File chính: `services/whiteboard-sync/src/rooms.ts`, `store.ts`, `server.ts`; test persist/server.
- Viết test thất bại trước: đóng buổi, dừng/tạo server mới với cùng thư mục dữ liệu, dùng lại token chưa hết hạn.
- Lưu bền dấu đóng theo buổi và kiểm tra trước khi cho join/update; không chỉ dựa vào `Map` trong RAM. Đánh giá cả tin update đang chờ trong lúc đóng.
- Lệnh đóng có thể gọi lại và lấy bản cuối đã lưu. Phân biệt lỗi xác thực với lỗi đọc/ghi đĩa; không trả 401 cho mọi lỗi lưu trữ.
- Test lỗi ghi đĩa, lệnh đóng lặp và khôi phục sau restart; không log scene.

Nghiệm thu: token cũ bị từ chối sau restart, bảng cuối vẫn đọc được cho tác vụ lưu; lỗi đĩa không bị báo nhầm đã lưu thành công. Chưa cần Redis hoặc chạy nhiều tiến trình.

### Lát 2 — Kết thúc buổi có thể thử lại và không ghi đè trạng thái

- File chính: router sessions, models, Repository/SupabaseRepo/FakeRepo, test sessions/schedule; web RoomPage khi cần hiển thị kết quả.
- Viết test cho: đóng LiveKit lỗi, đóng bảng lỗi, upload lỗi, cập nhật path lỗi, điểm danh lỗi; API restart giữa các bước; người dùng gửi `/end` hai lần hoặc mất phản hồi rồi thử lại.
- Giữ quyết định 15: vẫn tính đúng một buổi `completed` khi giáo viên kết thúc. Lưu bền công việc đóng phòng/lưu bảng còn thiếu để retry sau restart; dùng cấu trúc nhỏ phù hợp dự án, không thêm nền tảng hàng đợi riêng.
- Có thể dùng migration mới cho trạng thái/công việc chờ và RPC nếu cần chuyển trạng thái + ghi công việc một cách nguyên tử. Tất cả truy vấn vẫn qua Repository; bảng mới bật RLS và hạn chế quyền trình duyệt.
- Cập nhật theo trạng thái kỳ vọng, test join–end, cancel–join và sửa–join bằng các thao tác xen kẽ có kiểm soát. Không cho buổi `completed` quay về `live`.
- UI ngăn bấm lặp, cho biết khi bảng còn chờ lưu và cho thử lại bằng câu tiếng Việt. Lỗi đóng một dịch vụ không được ngăn tác vụ còn lại.
- Kiểm chứng riêng token video đã cấp trước lúc đóng trên cấu hình LiveKit thật được chọn; không suy từ test mock `delete_room` rằng mọi tình huống dùng lại token đều đã được bảo vệ.

Nghiệm thu: gọi lặp/restart không tăng số buổi, không mở lại phòng, không mất bản cuối; dịch vụ phục hồi thì công việc chờ hoàn tất và history mở được bảng. Nếu đổi luồng, sửa `docs/flows.md` cùng lần.

### Lát 3 — Bảng chịu được mất mạng và buổi dài

- Thêm bộ test web gọn phù hợp cho hook/RoomPage; dùng WebSocket giả hoặc máy chủ test thật, không chỉ kiểm implementation bằng các assert gọi hàm.
- Các ca bắt buộc: mất mạng 30 giây khi đang viết; server restart trước/sau mốc lưu; refresh lấy lại bản đã lưu; đổi session/mode; token hết hạn; máy khác undo/xóa rồi reconnect.
- Test ít nhất 2.001 phần tử và dữ liệu sát giới hạn byte. Chia lô gửi, xử lý áp lực truyền và bảo đảm init/resync nhận được toàn bộ trong giới hạn công bố.
- Kiểm chứng hội tụ theo cả `version` và `versionNonce`; bổ sung xác nhận/đối soát khi test cho thấy chỉ resync lúc reconnect chưa đủ.
- MVP hiện chưa hỗ trợ `files`: chặn chèn ảnh ở các đường nút, kéo thả, dán nếu còn hoạt động; báo rõ bằng tiếng Việt. Không tự mở rộng thành hệ thống file khi chưa được yêu cầu.
- Kiểm tra xử lý lỗi autosave, tắt tiến trình đột ngột trên dữ liệu giả và giới hạn mất dữ liệu thực tế; không hứa chống mất điện chỉ từ rename file.

Nghiệm thu: các máy hội tụ scene kể cả nét xóa, không lặp reconnect vì bảng quá lớn; khoảng mất dữ liệu được đo và ghi rõ; không còn ảnh chỉ hiện trên máy giáo viên.

### Lát 4 — Xóa học sinh có thể phục hồi khi lỗi giữa chừng

- Test trước với dữ liệu giả cho lỗi Auth, Storage, file cục bộ và restart giữa thao tác.
- Lưu bền thông tin/công việc cần dọn trước khi xóa các quan hệ làm mất id/path. Chỉ dọn đúng dữ liệu học sinh, giữ nguyên dữ liệu học sinh khác.
- Dọn bucket `boards`, scene/dấu đóng cục bộ và tài khoản Auth bằng các bước idempotent; kiểm tra cả phiên/token đã cấp còn dùng được hay không.
- Dọn scene và file tạm nhưng phải giữ khả năng từ chối token cũ: không xóa dấu `.ended` theo cách khiến phòng có thể mở lại; chỉ giữ metadata tối thiểu cần cho việc chặn quyền. Test restart và dùng lại token sau khi dọn.
- Kiểm tra tác vụ finalize và kết nối đang hoạt động: chúng không được tái tạo file/snapshot sau khi xóa. Không làm mất thông tin `profile_id`, session id hoặc đường dẫn cần dọn trước khi lưu bền công việc còn thiếu.
- Nếu có dữ liệu bài nộp tồn tại theo schema hiện có, phải tính chúng vào phạm vi xóa; không xây luồng giao/nộp bài GĐ2.
- Chính sách giữ dữ liệu chưa chốt: ghi câu hỏi cần chủ dự án quyết định, không tự đặt số ngày rồi xóa dữ liệu thật. Backup cũng cần ghi rõ thời hạn giữ và phạm vi khôi phục.

Nghiệm thu: lỗi giữa chừng vẫn thấy tiến độ và có thể retry; hoàn tất thì không còn dữ liệu thuộc phạm vi đã xác nhận, không trả thành công khi còn dữ liệu chưa dọn. Chỉ chạy nghiệm thu xóa với dữ liệu giả.

### Lát 5 — CI, nghiệm thu ba thiết bị và pilot

- Thêm job RLS bằng PostgreSQL test; giữ API, board, typecheck và build. Bổ sung test quyền bucket `boards`: giáo viên/đúng học sinh đọc được, học sinh khác/anon không đọc được.
- Có smoke test trình duyệt cho chuẩn bị buổi → vào lớp → kết thúc → history/xem bảng. Mock giúp chạy CI nhưng vẫn phải có checklist staging thật riêng.
- Nghiệm thu laptop giáo viên + tablet Android + thiết bị học sinh trên HTTPS/WSS: đăng nhập; quyền đúng/sai; tablet không xin camera/micro; bút, lòng bàn tay, tẩy, undo, zoom, xoay màn hình; mất mạng; kết thúc; xem lại.
- Buổi thử 45–60 phút; mục tiêu ban đầu dưới 50 ms tại máy viết, dưới 250 ms sang máy học sinh ở mạng thử. Ghi số đo và thiết bị/mạng; đây là ngưỡng đề xuất, chưa phải kết quả đạt.
- Thử backup/restore database và volume bảng bằng dữ liệu giả; đo thời gian phục hồi. Kiểm tra log không chứa nội dung bảng/thông tin học sinh.
- Sau khi các mục trên đạt: pilot nhỏ 3–5 học sinh, 5–10 buổi, ghi lỗi và thao tác giáo viên. Chỉ đề xuất GĐ2 khi pilot đạt và chủ dự án yêu cầu.

Nghiệm thu: không còn lỗi sai quyền, mất bảng hoặc phòng không đóng chưa giải quyết; giáo viên tự chuẩn bị và kết thúc buổi, học sinh tự vào và xem lại. Những mục cần người thử mà chưa làm phải để “chưa thử”, không đánh dấu hoàn tất bằng test tự động.

## Prompt dùng ngay cho Claude Code

```text
Đọc AGENTS.md, docs/progress.md, docs/claude-code-plan.md và AGENTS trong các thư mục liên quan.
Lát 1–3 đã có code/test. Phiên này chỉ làm Lát 4: xóa hẳn học sinh an toàn, đầy đủ, có retry.

Trước khi sửa: kiểm tra git status/diff, giữ nguyên thay đổi người dùng và trình bày kế hoạch ngắn.
Đọc router students, Repository/SupabaseRepo/FakeRepo, finalize, dịch vụ bảng và schema liên quan.

Viết test tái hiện trước: xóa hiện còn sót Storage/file bảng; Auth/Storage/đĩa lỗi giữa chừng;
API restart hoặc gọi xóa lặp; học sinh khác không bị ảnh hưởng; người không có quyền bị từ chối.
Chỉ giáo viên sở hữu được xóa học sinh đã ngừng dạy, giữ xác nhận trên web.
Lưu bền đủ id/path và tiến độ dọn trước khi xóa quan hệ làm mất thông tin;
retry phải chạy lại được sau restart và không báo hoàn tất khi còn bước thất bại.
Dọn tài khoản Auth, dữ liệu DB liên quan, file bucket boards/submissions nếu có và scene/file tạm.
Ngăn finalize hoặc kết nối cũ tái tạo dữ liệu. Giữ cơ chế chặn token cũ sau dọn/restart;
không xóa dấu .ended theo cách mở lại phòng. Chỉ giữ metadata tối thiểu cho việc chặn quyền/retry.
Mọi truy vấn qua Repository; kiểm tra quyền ở API và endpoint nội bộ. Không thêm hàng đợi lớn.

Nếu cần schema, tạo migration số tiếp theo, không sửa 0001–0004; bảng mới có RLS/quyền tối thiểu
và test tương ứng trong supabase/tests/90_rls_test.sql. Kiểm tra 0004 trên DB thử;
nếu chưa truy cập được dịch vụ thật, ghi chưa xác minh, vẫn làm phần code/test cục bộ.
Không đọc/in/sửa .env hoặc biến thể, không log bài làm/thông tin cá nhân, không commit.
Không tự áp migration hoặc chạy xóa trên dữ liệu thật; kiểm thử bằng dữ liệu giả trong môi trường tách biệt.
Không thêm GĐ2/GĐ3, không làm lại lát 1–3, không tự đặt thời hạn giữ dữ liệu thật.

Chạy make test, make lint, make build-web và supabase/tests/run.sh nếu đụng migration.
Lệnh lỗi môi trường thì dùng lệnh thành phần khi có thể, báo đúng lệnh và kết quả thực tế.
Cập nhật docs/progress.md, flows/decisions và AGENTS liên quan khi hành vi thay đổi.
Hoàn tất lát này rồi dừng; báo kết quả, test thực chạy, phần chưa thử và bước tiếp theo.
```

Có thể làm Lát 0 trước để chuẩn hóa bàn giao. Song song về tiến độ, chủ dự án tự thử bút ở môi trường dữ liệu giả; đây là phần cần thiết bị/người dùng thật, không thể giao Claude Code tự xác nhận.

## Kiểm tra lần rà soát ban đầu, trước lát 1–3

- `make test`, `make lint`, `make build-web`: đều không khởi chạy được `make.exe` trong môi trường này.
- API: `.\apps\api\.venv\Scripts\python.exe -m pytest apps/api/tests -q -p no:cacheprovider`: 64 test đạt; có cảnh báo Starlette/httpx.
- Ruff check và format check: đạt, 22 file đúng định dạng.
- Board `npm.cmd test`: lỗi môi trường `tsx`, `uv_os_get_passwd`/ENOMEM trên Node 24.21.0; không phải kết quả test nghiệp vụ đạt.
- Board dùng `node --experimental-transform-types --test test/scene.test.ts test/server.test.ts test/persist.test.ts test/startup.test.ts`: 22 test đạt trên Node 24.21.0.
- Board `npm.cmd run typecheck`: đạt.
- Tái hiện trạng thái đóng qua `RoomHub` với store giả, không ghi dữ liệu học sinh: `endedBeforeRestart=true`, `endedAfterRestart=false`, `restoredElements=1`.
- Web `npm.cmd run build` (gồm `tsc --noEmit`): đạt, build ra `dist`; còn cảnh báo chunk trên 500 KB. Chưa đo thời gian tải trên mạng học sinh.
- Không chạy lại RLS (không sửa migration; không có `psql`/Docker trong PATH), không thử dịch vụ thật, không thử tablet.

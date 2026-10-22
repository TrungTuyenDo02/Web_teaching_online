# Chèn ảnh đề bài lên bảng — kế hoạch triển khai

> For agentic workers: use superpowers:executing-plans inline, task by task; fresh review at the end. User explicitly requested implementation on 2026-10-22. Do not request another approval or commit.

**Goal:** Giáo viên chọn ảnh, viết lên ảnh, đồng bộ và giữ ảnh khi xem lại.

**Architecture:** Ảnh chuẩn hóa được chuyển theo mảnh qua kết nối bảng đã xác thực, ghi riêng trên đĩa trước ACK. Snapshot cuối buổi là version 2 gồm elements/files, cùng đường dẫn Storage hiện có; reader vẫn nhận mảng cũ.

**Tech stack:** React/TypeScript/Excalidraw, Node/ws/jose, FastAPI/Repository; không thêm dependencies.

**Spec:** `docs/superpowers/specs/2026-10-22-whiteboard-images-design.md` (chủ dự án duyệt và yêu cầu sửa code).

## Constraints and rulings

- Không đọc .env; dùng bản sao không chứa bí mật cho pytest/build. Không thay đổi migration hay gọi Cloud.
- 10 MiB đầu vào; cạnh dài 2560 px; 2 MiB/ảnh chuẩn hóa, 6 MiB/20 ảnh mỗi phòng, mảnh tối đa 192 KiB, snapshot dự kiến 18 MiB và upload cuối tối đa 20 MiB.
- Ruling: thực hiện trên workspace người dùng đã yêu cầu, giữ thay đổi có sẵn; .git không nằm trong quyền ghi nên không tạo worktree/branch/commit. Bản sao kiểm thử tách file môi trường.
- Ruling: user “oke sửa code đi” cấp quyền thực hiện liên tục; không chèn thêm vòng phê duyệt kế hoạch. Dùng inline execution, review riêng cuối việc theo skill.
- Ruling: hash nội dung do máy chủ tính, ACK trả id; browser LAN HTTP không có crypto.subtle. Request id ngẫu nhiên chỉ dùng ghép lượt tải, không làm tên file.

## Review focus

- Mất mạng sau ACK nhưng trước khi phát phần tử ảnh: reconnect vẫn có ảnh và gửi bù phần tử.
- Học sinh hoặc phòng khác thử tải/tham chiếu ảnh: không ghi hoặc đọc chéo.
- Đóng/purge giữa lượt tải: không có file muộn tái tạo dữ liệu.
- Snapshot cũ và mới: không ghi đè bản đầy đủ bằng bản mất files.
- Mã chạy trên LAN HTTP: không phụ thuộc crypto.subtle/clipboard/secure context.

## Task 1 — Kho ảnh và giao thức máy chủ

Files: `services/whiteboard-sync/src/{images,store,rooms,server}.ts`, `test/images.test.ts`.

Interface: `BoardFile {id,mimeType,dataURL,created}`; client `file_chunk {uploadId,mimeType,offset,total,data}`, server `file_ack {uploadId,id,created}` / `file_error {uploadId,message}`; download `file_data {id,mimeType,created,offset,total,data}`. Init advertises `images:true` and `fileIds`.

- [x] Viết và chạy test đỏ: upload giáo viên → máy khác nhận, học sinh bị chặn, restart/close/purge, payload sai/quota/hash.
- [x] Kiểm raster/chữ ký/kích thước, hash SHA256, ghi bền trước ACK, hạn lượt tải và dữ liệu dở.
- [x] Truyền ảnh theo mảnh có backpressure; nhận update ảnh chỉ khi file đã có trong cùng phòng; tải file trước khi apply ảnh ở client.
- [x] Chạy test mục tiêu và suite bảng/typecheck.

## Task 2 — Client và UI chèn ảnh

Files: `apps/web/src/lib/{boardFiles,boardConnection,boardImage}.ts`, `hooks/useBoardSync.ts`, `components/Whiteboard.tsx`, i18n; tests board client + browser.

Interface: `BoardConnection.uploadFile(file): Promise<BoardFile>`; scene có `files()` và `applyFiles(files)`, events có capability. Chuẩn hóa ảnh trả Blob/dataURL/kích thước. UI gọi upload khi online, addFiles rồi thêm phần tử Excalidraw image ở viewport.

- [x] Test đỏ: ảnh được gửi/nhận, reconnect không mất ảnh, nút chọn ảnh → hai trình duyệt có cùng ảnh.
- [x] Triển khai codec/chunk, cleanup timer/promise, capability, đợi files trước apply phần tử ảnh, gửi lại files thiếu sau restart.
- [x] Thêm nút/tình trạng/lỗi VI/EN, chỉ GV, online, chặn đường kéo thả/dán ngoài quy trình.
- [x] Test lỗi file, chỉ xem, PNG, xử lý mạng và browser.

## Task 3 — Snapshot/API và xem lại

Files: API tokens/finalize/repo/FakeRepo + `tests/test_board_images.py`; web board document/BoardViewer/data/preview.

Interface: snapshot cũ `elements[]`; mới `{version:2,elements,files}`. Hàm close giữ tương thích list khi không có ảnh; snapshot ảnh giữ nguyên qua upload intents và Storage. Reader kiểm schema/data URL và đưa files vào Excalidraw.

- [x] Test đỏ finalize lưu đủ files, mất file/bad snapshot/quá 20 MiB không báo đã lưu, upload/xóa vẫn an toàn.
- [x] Thêm kiểu union/document, kiểm kích thước và dữ liệu, đổi Protocol + Supabase + FakeRepo cùng lúc.
- [x] Test reader bảng cũ/mới và browser xem lại ảnh.

## Task 4 — Kiểm tra hoàn tất

- [x] Chạy make test/lint/build-web; dùng lệnh thành phần nếu lỗi môi trường, E2E liên quan và smoke.
- [x] Review riêng toàn thay đổi ảnh, sửa vấn đề có test tái hiện.
- [x] Cập nhật flows/decisions/testing/progress, ghi rõ chưa thử Cloud/tablet thật với tính năng mới.

## Ledger

- 2026-10-22: đọc spec/code/instructions; ghi nhận baseline workspace có thay đổi M1b/M2/UI của người dùng, không sửa phạm vi đó.

- 2026-10-22: đã triển khai đủ server/client/UI/API/viewer. Test đỏ đã quan sát trước triển khai cho upload/receiver/finalize; bổ sung test đỏ cho PNG CRC, JPEG thiếu SOS và hash tệp sai rồi sửa. Không thêm dependency/migration.
- 2026-10-22: review riêng bởi `review_whiteboard_images`; đã sửa guard JPEG và bổ sung kiểm hash ở reader, không còn lỗi critical/important được báo. SHA256 trên LAN HTTP kiểm bằng vector chuẩn và Node crypto tại các ranh giới block/2 MiB.
- 2026-10-22: 296 test API, 84 test bảng, 52 test trình duyệt (smoke + hai ca ảnh) đạt; build web, typecheck, Ruff, time guard và E0 10/10 đạt. Một lượt smoke trước lỗi ENOENT artifact khi các phiên cùng dùng test-results; lượt xác nhận chạy trên bản sao với output riêng, không retry. Nguồn code của bản sao khớp workspace trước cập nhật comment/tài liệu cuối.
- Ruling kiểm thử: make.exe không chạy được trong harness Windows; dùng pytest, Node transform-types cho node:test/Playwright, Ruff, time guard, E0 và tsc/build thành phần. Bản sao bỏ mọi file môi trường, chỉ nối thư mục dependency. Không ghi kết quả giả lập thành nghiệm thu Cloud/tablet.
- Bản thử LAN mới: web 5175, token 8799, proxy 8800; init xác nhận images:true. Không dừng các tiến trình khác và không chạm dữ liệu buổi học thật. Hướng dẫn sử dụng ở docs/whiteboard-images.md.

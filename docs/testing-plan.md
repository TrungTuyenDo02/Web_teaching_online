# Bộ kiểm thử Giai đoạn 1

Trạng thái 2026-10-20: **đã triển khai bộ test trình duyệt** (Playwright, Chromium). Toàn bộ 40 test đạt trong 3,0 phút; smoke 28 test đạt trong 1,6 phút với `CI=1`. Cách chạy và phần giả/thật: [testing.md](testing.md). Các suite API, bảng, RLS giữ nguyên. Cột cuối của ma trận ghi kết quả thực chạy.

## Mục tiêu và phạm vi

Ưu tiên lỗi làm gián đoạn buổi học, sai quyền, mất bảng hoặc xóa nhầm dữ liệu. Phạm vi chỉ Giai đoạn 1. Không đặt chỉ tiêu số lượng test/coverage tùy ý, không kiểm chi tiết nội bộ của Excalidraw/LiveKit, không nhân bản test API chỉ để tăng số lượng.

| Lớp | Hiện có | Việc làm tiếp | Chứng minh được |
|---|---|---|---|
| API/nghiệp vụ | pytest, FakeRepo/FakeLiveKit, race/fault injection | Giữ, bổ sung khi có lỗ hổng cụ thể | Hành vi API theo mô hình dependency giả |
| WebSocket/client bảng | node:test, server thật cục bộ, reconnect/heartbeat/persist | Giữ, nối thêm với trình duyệt | Giao thức và lưu đĩa cục bộ |
| Database | PostgreSQL tạm, RLS và handshake hai kết nối | Duy trì trong CI, thêm khi đổi schema/policy | SQL/RLS theo môi trường thử; không phải Storage/Auth Cloud thật |
| Giao diện | Đã có preview và kiểm headless thủ công; chưa có runner browser trong package web | Thêm suite trình duyệt chạy lại được | Component/luồng UI thật với ranh giới giả được công bố |
| Browser + bảng cục bộ | Trang /dev/whiteboard và server thử có sẵn | Tự động hóa hai browser context độc lập | Nét thực sự tới thiết bị mô phỏng kia qua server |
| Dịch vụ/thiết bị thật | acceptance.md, tablet-wifi.md, LiveKit T1–T14 | Chỉ chạy khi có môi trường/ủy quyền tương ứng | Hành vi quan sát được trên môi trường đã thử |

## Công cụ và cách tổ chức đề xuất

- Giữ pytest, node:test, PostgreSQL và npm đang dùng.
- Đề xuất `@playwright/test` trong **devDependencies** web, bắt đầu bằng Chromium. Không cài thêm Vitest/Testing Library trong cùng lượt nếu chưa có nhu cầu cụ thể. Đã cài `@playwright/test` 1.64.1 và Chromium (2026-10-20, chủ dự án cho phép).
- Tài liệu chính thức: [khởi động server thử](https://playwright.dev/docs/test-webserver), [cách ly browser context](https://playwright.dev/docs/browser-contexts), [CI](https://playwright.dev/docs/ci-intro).
- Bố trí dự kiến: `apps/web/e2e/ui/`, `e2e/board/`, `e2e/fixtures/`, `playwright.config.ts`. Fixture phát hiện cổng trống, tự dựng và dọn đúng tiến trình/tệp tạm do nó tạo. Không tái sử dụng Vite 5173 của người dùng.
- Test UI có thể dùng preview cho các luồng đã hỗ trợ. Các luồng khác mock tại ranh giới Auth/API/LiveKit hoặc dùng API cục bộ với dependency override; nêu rõ lớp nào được giả. Không thêm đường bỏ qua xác thực vào production.
- Test bảng dùng Whiteboard/Excalidraw và whiteboard-sync thật cục bộ, hai context tách cookie/storage/BroadcastChannel. Không chỉ dựa vào nhãn “đã kết nối” hay BroadcastChannel để kết luận nhận nét.

## Ma trận ưu tiên

P0 chạy mỗi PR khi suite đã được triển khai; P1 chạy trong suite đầy đủ. “Giữ” nghĩa là kiểm các ca sẵn có trước, chỉ bổ sung điều còn thiếu. Các dòng browser là yêu cầu mới, chưa phải kết quả đã đạt.

| ID | Mức/lớp | Tình huống và kết quả cần kiểm | Test và kết quả (2026-10-20) |
|---|---|---|---|
| AUTH-01 | P0 browser | Chưa đăng nhập mở URL cần quyền → về đăng nhập; không ló nội dung riêng tư trước khi chuyển | [auth.spec.ts](../apps/web/e2e/ui/auth.spec.ts): 5 test **đạt** |
| AUTH-02 | P0 API/RLS, giữ | HS A gọi buổi/bảng của B → 404 hoặc không thấy hàng theo hợp đồng; vai trò lấy từ profiles | Giữ pytest/RLS hiện có (RLS không chạy lại trong phiên này) |
| AUTH-03 | P0 browser | UI học sinh không có thao tác quản lý của giáo viên; ghi rõ đây là kiểm UI, quyền thực sự do AUTH-02 kiểm | [auth.spec.ts](../apps/web/e2e/ui/auth.spec.ts): 2 test **đạt** (kiểm UI) |
| STU-01 | P0 browser | Thêm → tìm → sửa học sinh; danh sách hiển thị dữ liệu mới và không nhân đôi khi đang gửi | [students.spec.ts](../apps/web/e2e/ui/students.spec.ts) **đạt** |
| STU-02 | P0 browser | Ngừng dạy → xác nhận xóa → xóa dở → xóa tiếp; hủy hộp thoại không làm mất dữ liệu | [students.spec.ts](../apps/web/e2e/ui/students.spec.ts) **đạt** |
| STU-03 | P1 browser | Tạo tài khoản/đặt lại mật khẩu: trạng thái đang gửi, lỗi và thử lại; dùng duy nhất thông tin giả | [students.spec.ts](../apps/web/e2e/ui/students.spec.ts): tạo tài khoản **đạt**; đặt lại mật khẩu chưa có test riêng |
| SES-01 | P0 browser | Tạo → sửa → hủy buổi; danh sách, giờ và trạng thái phản ánh kết quả | [sessions.spec.ts](../apps/web/e2e/ui/sessions.spec.ts) **đạt** |
| SES-02 | P0 API/browser, giữ | Trùng giờ, quá 4 giờ, giờ không hợp lệ: API từ chối và UI đặt thông báo tiếng Việt đúng chỗ | [sessions.spec.ts](../apps/web/e2e/ui/sessions.spec.ts): 2 test **đạt** + pytest giữ |
| ROOM-01 | P0 browser | mode=board không tạo kết nối video và không gọi getUserMedia; chỉ có bảng | [room.spec.ts](../apps/web/e2e/ui/room.spec.ts): 2 test (gồm đối chứng) **đạt**. Lỗi tìm thấy và đã sửa: font Excalidraw tải từ CDN esm.sh |
| ROOM-02 | P0 browser | API join lỗi 502/409/404: UI có thông báo đúng, không mắc kẹt ở loading, thử lại có tác dụng | [room.spec.ts](../apps/web/e2e/ui/room.spec.ts): 4 test **đạt**. Lỗi tìm thấy và đã sửa: trang lỗi join không có nút Thử lại |
| END-01 | P0 browser/API | Kết thúc còn việc chờ → Thử lại ngay → hoàn tất; UI không báo lưu xong khi server còn pending | [room.spec.ts](../apps/web/e2e/ui/room.spec.ts) **đạt**. Lỗi tìm thấy và đã sửa: `<dialog>` không có tên truy cập được |
| END-02 | P0 API, giữ | Join/end xen kẽ, token muộn, thu hồi/xóa lỗi, board và dọn phòng; giữ giới hạn P1/B2 công khai | Giữ pytest (test_video_room*, test_join_end_race, test_end_session) |
| HIST-01 | P1 browser | Mở buổi đã học, xem bảng; thiếu snapshot hoặc tải lỗi có trạng thái phù hợp | [history.spec.ts](../apps/web/e2e/ui/history.spec.ts): 2 test **đạt**; lỗi tải Storage chưa có test riêng |
| BOARD-01 | P0 browser/server thật | Context GV vẽ/chỉnh nét → context HS nhận nội dung tương ứng; HS chỉ xem | [board.spec.ts](../apps/web/e2e/board/board.spec.ts): 2 test **đạt** |
| BOARD-02 | P0 browser/server thật | Context phòng khác không nhận nét; reload context HS vẫn đủ nội dung | [board.spec.ts](../apps/web/e2e/board/board.spec.ts) **đạt** |
| BOARD-03 | P0 browser/server thật | Treo đường truyền riêng context GV, viết tiếp, nối lại → đủ nét; context HS khỏe không bị treo theo | [board.spec.ts](../apps/web/e2e/board/board.spec.ts) `@slow` **đạt** (~49 s) |
| BOARD-04 | P1 browser/server thật | Xóa/undo/redo và gửi bù không hồi sinh nét đã xóa; assert nội dung cuối, không chỉ đếm message | [board.spec.ts](../apps/web/e2e/board/board.spec.ts) **đạt** |
| BOARD-05 | P1 browser | Tải PNG có chữ ký PNG hợp lệ, đúng nội dung thử; bảng trống báo lỗi phù hợp | [board.spec.ts](../apps/web/e2e/board/board.spec.ts) **đạt** |
| BOARD-06 | P1 browser | Nội dung ảnh không hỗ trợ bị chặn bằng lỗi tiếng Việt, không tạo phần tử hỏng ở máy nhận | [board.spec.ts](../apps/web/e2e/board/board.spec.ts) **đạt**, known-gap: Excalidraw báo tiếng Anh (gói vi-VN 49%) |
| DATA-01 | P0 API/RLS, giữ | Xóa A không mất B; retry khi lỗi Auth/Storage/bảng; uploader muộn được dọn theo mô hình | Giữ pytest/RLS hiện có |
| REPORT-01–03 | P0 API/browser/CSV | Biên tháng VN, quyền theo profiles/teacher_id, đủ trang; chọn tháng/tải CSV tiếng Việt, HS không tải báo cáo, lỗi/retry không xuất CSV khi chưa có dữ liệu | `tests/test_monthly_reports.py` (11 ca); `test/web-report-csv.test.ts`; `e2e/ui/reports.spec.ts` (3 ca). UI-01 bao gồm `/reports`; kết quả thực chạy mới nhất xem progress |
| NOTE-01–04 | P0 API/RLS/browser | Note/chủ đề chỉ GV; completed/HS đang xóa; CAS giữ bản nháp; note+liên kết nguyên tử; xuất theo HS/tháng, Markdown/CSV an toàn, đổi ngôn ngữ giữ tháng VN | `test_teaching_notes.py` (18 ca), RLS 0008 + 2 kết nối + rollback trong `supabase/tests/run.sh`, 2 ca `web-teaching-notes.test.ts`, 4 ca `e2e/ui/teaching-notes.spec.ts`; UI-01 gồm `/teaching-notes` |
| UI-01 | P0 browser | 360/768/1280 px và tablet dọc/ngang: không tràn ngang, nút ứng dụng ≥44 px, form/dialog dùng được | [layout.spec.ts](../apps/web/e2e/ui/layout.spec.ts): 9 test **đạt** (gồm trang giới thiệu và giao diện tiếng Anh ở 4 khổ) |
| UI-02 | P1 browser | Tab/Shift+Tab, Escape, focus vào/trở về dialog, label gắn với input và lỗi; kiểm hành vi thực tế | [layout.spec.ts](../apps/web/e2e/ui/layout.spec.ts): 2 test + lỗi gắn ô trong STU/SES **đạt** |
| UI-03 | P1 browser | Danh sách trống, tải chậm, lỗi tải và tải lại; kiểm lỗi console/pageerror mới phát sinh | [history.spec.ts](../apps/web/e2e/ui/history.spec.ts) + kiểm console ở mọi test **đạt**. Lỗi tìm thấy và đã sửa: hiện nguyên văn lỗi PostgREST |
| SLOT-01 | P0 API/RLS + P1 browser | Lịch hằng tuần: sinh 4 tuần theo giờ VN, bỏ ngày trùng giờ, không sinh trùng (cả khi chạy song song), buổi đã hủy/dời giờ không sinh lại, ngừng lịch hủy buổi sắp tới, HS ngừng dạy/đang xóa không sinh, chỉ GV sở hữu | [test_weekly_slots.py](../apps/api/tests/test_weekly_slots.py): 21 test **đạt**; RLS/unique/rollback 0009 trong `supabase/tests` **đạt** (PostgreSQL 18 cục bộ); [weekly-slots.spec.ts](../apps/web/e2e/ui/weekly-slots.spec.ts): 2 test **đạt** |
| LAND-01 | P1 browser | Khách mở `/` thấy trang giới thiệu, không đọc dữ liệu riêng; nút đăng nhập dẫn tới `/login` và quay lại được | [landing.spec.ts](../apps/web/e2e/ui/landing.spec.ts) **đạt**; bố cục 4 khổ trong UI-01 |
| I18N-01 | P1 browser + Node | Đổi VI/EN: không sót chữ tiếng Việt (trừ dữ liệu người dùng), nhớ sau tải lại, `<html lang>` đúng; câu lỗi API dịch khi hiển thị; mọi chuỗi trong code có bản dịch | [landing.spec.ts](../apps/web/e2e/ui/landing.spec.ts): 2 test **đạt**; [web-i18n.test.ts](../services/whiteboard-sync/test/web-i18n.test.ts): 6 test **đạt** |
| BUILD-01 | P0 production build | Không chứa trang preview, dev whiteboard, mã ghép nối và công cụ giả lập; đường dev không render trang thử ở bản production | [release.spec.ts](../apps/web/e2e/build/release.spec.ts): 3 test **đạt** |
| BUILD-02 | P0 browser | Fixture chặn truy cập ngoài localhost; không gọi nhầm Supabase/LiveKit thật trong suite cục bộ | [fixtures/test.ts](../apps/web/e2e/fixtures/test.ts): chặn ở mọi test, **đạt** |

## Nguyên tắc chống test đạt nhầm

1. Mỗi test có điều kiện ban đầu, thao tác, kết quả quan sát được và dọn dẹp. Reset dữ liệu theo test; không phụ thuộc thứ tự chạy.
2. Chờ điều kiện có ý nghĩa bằng assertion/event; không dùng sleep cố định để đoán hệ thống xong. Timeout ghi rõ bước lỗi. Với heartbeat có thời gian thật, tách nhóm chậm khỏi nhóm smoke.
3. Với bảng, đợi phần tử/nội dung ở context nhận; không coi socket.send thành công hoặc tab GV tự xác nhận là đã đồng bộ.
4. Không mock chính logic đang kiểm. Preview CRUD là test UI; test quyền Auth/RLS/Cloud phải nằm đúng suite tương ứng.
5. Test sửa lỗi phải đỏ đúng hành vi trước bản sửa. Dùng seed cho race; không retry vô hạn hoặc tăng timeout để che lỗi. Không ép mọi test cũ phải đỏ trên code cũ nếu đó là regression guard.
6. Không thêm ngưỡng hiệu năng cứng dựa vào máy CI ngẫu nhiên. Độ trễ bút, tì tay, nhiệt/pin và thời lượng 45–60 phút kiểm trên thiết bị thật.

## Lệnh, CI và bàn giao

- Giữ các lệnh `make test`, `make lint`, `make build-web` và job API/web/board/RLS hiện có.
- Bổ sung lệnh rõ ràng cho browser smoke và browser đầy đủ; tên gợi ý `npm run test:e2e:smoke`, `npm run test:e2e`. Không gộp việc gọi Cloud vào `make test` hay job PR.
- CI thêm job browser cục bộ sau khi runner/test chạy ổn: Chromium, dữ liệu giả, không secrets; lưu trace/screenshot/report khi lỗi với thời hạn lưu hữu hạn. Không ghi video buổi học hay dùng dữ liệu học sinh thật trong artifact.
- Test Vite/API phải chạy trên nguồn/cấu hình không nạp `.env*` bí mật. Chỉ loopback, thư mục/cổng tạm; không tắt máy chủ của người dùng. Fixture fail rõ khi dependency/cổng không sẵn, không báo đạt giả.
- `docs/testing.md` khi triển khai phải ghi lệnh cài/chạy, ca nào mock/thật, cách đọc artifact, thời gian chạy đo thực tế và cách thêm test.
- Đầu ra: test code/config/fixture/CI, ma trận này có liên kết tới file test đã làm, báo cáo số test thực chạy và việc chưa chạy. Không dừng ở tài liệu kế hoạch.

## Phần vẫn chờ môi trường thật

Không xác nhận migration đã áp, không tự gọi Cloud hoặc ghi dữ liệu lên Supabase. Áp 0004–0007, verify/preflight, LiveKit dev T1–T14, acceptance mục 2 và checklist tablet vẫn cần kết quả thật/ủy quyền tương ứng. Test mô phỏng không đóng lỗi token video cũ. Các yêu cầu môi trường được gom một lần, không cản triển khai suite cục bộ.

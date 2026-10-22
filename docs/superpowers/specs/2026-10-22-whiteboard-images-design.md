# Đề xuất: chèn ảnh đề bài và lưu cùng bảng

Trạng thái: chủ dự án đã duyệt lưu cùng bảng và yêu cầu sửa code; đã triển khai/kiểm cục bộ ngày 2026-10-22. Chưa nghiệm thu tablet hoặc Supabase thật. Cách dùng: [whiteboard-images.md](../../whiteboard-images.md).

## Nhu cầu đã xác nhận

- Giáo viên muốn tải ảnh đề bài từ máy lên bảng viết.
- Chủ dự án đã chọn giữ ảnh khi giáo viên và học sinh mở “Xem lại bảng” sau buổi học.
- Giả định cho lát đầu: giáo viên chèn ảnh từ laptop hoặc tablet; học sinh tiếp tục chỉ xem. Giữ stack, Auth, Repository và npm hiện có.

Thành công khi: ảnh và nét viết trên ảnh hiện giống nhau ở laptop/tablet/máy học sinh; tải lại hoặc máy chủ bảng restart vẫn có ảnh đã xác nhận lưu; kết thúc buổi rồi xem lại vẫn đầy đủ; xóa học sinh dọn được cả ảnh.

## Hiện trạng đã đọc trong code

- `Whiteboard.tsx` ẩn công cụ ảnh; `useBoardSync.ts` gỡ phần tử ảnh và báo chưa hỗ trợ.
- `boardConnection.ts` loại ảnh khỏi danh sách phần tử được đồng bộ. Giao thức hiện chỉ chuyển elements, chưa chuyển files.
- `SceneStore` chỉ lưu mảng elements. API lấy mảng khi đóng bảng và ghi vào một tệp JSON trong bucket boards, dưới đường dẫn học sinh/buổi học.
- `BoardViewer` và `backend.loadBoard` chỉ đọc mảng elements. Bật nút ảnh đơn lẻ không đáp ứng đồng bộ hoặc xem lại.

## Hai phương án

1. **Đề xuất chọn: ảnh nằm trong bản bảng cuối buổi.** Mở rộng định dạng bảng để chứa elements + files; trong buổi, máy chủ bảng lưu ảnh riêng trên đĩa để không ghi lại dữ liệu ảnh sau mỗi nét. Khi kết thúc, gom thành một snapshot JSON tự chứa. Dùng lại bucket/quyền và đường dẫn snapshot hiện có. Đổi giao thức và định dạng snapshot, nhưng không cần thêm bảng DB hoặc nhà cung cấp.
2. **Ảnh là đối tượng Storage riêng.** Snapshot chỉ tham chiếu ảnh. Có thể phù hợp với kho ảnh lớn, nhưng cần thêm luồng tải/đọc đúng quyền và bắt tay dọn file khi upload xen xóa học sinh. Phạm vi vận hành và dữ liệu mồ côi lớn hơn cho nhu cầu hiện tại.

Phương án 1 có giới hạn dung lượng để snapshot không quá nặng. Chưa khẳng định hiệu năng cho đến khi đo bằng test và thiết bị thật.

## Luồng người dùng đề xuất

1. Giáo viên bấm “Chèn ảnh đề bài” trên thanh bảng, chọn JPEG/PNG/WebP từ máy. Nút dùng được trên laptop và tablet, vùng chạm tối thiểu 44 px, chuỗi hiển thị VI/EN theo quy tắc dự án.
2. Web kiểm ảnh, vẽ lại thành dữ liệu ảnh không có metadata và chuẩn hóa kích thước. Giữ tỉ lệ, không cắt ảnh. Đề xuất giới hạn: đầu vào tối đa 10 MiB/ảnh, cạnh dài sau chuẩn hóa tối đa 2560 px, dữ liệu chuẩn hóa tối đa 2 MiB/ảnh.
3. Chỉ bắt đầu chèn khi bảng online. Hiện “Đang tải ảnh…”; máy chủ ghi ảnh bền và xác nhận, rồi phần tử ảnh mới được phát sang các máy khác. Lỗi/mất mạng/hết dung lượng: thông báo tiếng Việt, có thể chọn lại/thử lại; không báo ảnh đã đồng bộ khi chưa được xác nhận.
4. Ảnh xuất hiện trong vùng đang nhìn, nằm dưới nét viết mới. Giáo viên dùng công cụ chọn để kéo, đổi kích thước, xóa/hoàn tác; dùng bút viết trên ảnh. Học sinh chỉ xem và không được gửi ảnh hay sửa ảnh.
5. Giới hạn đề xuất mỗi bảng: 20 ảnh khác nhau, tổng dữ liệu ảnh chuẩn hóa tối đa 6 MiB, tính cả ảnh đang xóa nhưng còn được giữ để hoàn tác. Vượt giới hạn thì từ chối rõ ràng, không xóa ảnh cũ tự động. `0001_init.sql` đặt bucket boards tối đa 20 MiB/tệp; phải tính cả độ phình base64 (6 MiB thành khoảng 8 MiB), elements và JSON khi kiểm ngân sách, không dùng riêng số byte ảnh làm điều kiện cho phép tải.

Chọn file là đường chèn ảnh được hỗ trợ trong lát đầu. Kéo thả, clipboard và nhập tệp Excalidraw tiếp tục bị chặn cho đến khi đi qua cùng kiểm tra/giới hạn; không để công cụ thư viện vượt đường tải đã kiểm.

## Đồng bộ và lưu bền

- Thêm kho ảnh theo phòng, khóa theo file id từ nội dung đã chuẩn hóa; id/path do máy chủ kiểm tra. Dữ liệu ảnh bất biến; cùng id khác nội dung bị từ chối. Không nhận URL ảnh bên ngoài.
- Máy chủ kiểm lại định dạng, số byte, giới hạn kích thước điểm ảnh và tổng ngân sách; không chỉ tin MIME/giới hạn phía web. Chỉ nhận raster JPEG/PNG/WebP hợp lệ; từ chối SVG/HTML và ảnh không giải mã/chuẩn hóa được trên web.
- Gửi dữ liệu ảnh bằng các mảnh tối đa 192 KiB, tách khỏi update nét. Có giới hạn số lượt đang tải, bộ đệm và timeout; hủy dữ liệu dở khi đóng/purge. Đường truyền ảnh không được làm mất heartbeat hoặc khiến nét vẽ chờ sau một hàng ảnh không giới hạn.
- Máy nhận nạp files vào Excalidraw trước khi hiển thị ảnh tương ứng. Khi init/reconnect: lấy scene và bổ sung file còn thiếu; kiểm đủ byte/hash, không giữ ảnh bị cắt cụt.
- Trên đĩa máy chủ: ghi ảnh mới bằng tệp tạm rồi đổi tên trước khi ACK. Scene tiếp tục ghi nhẹ theo cơ chế hiện có, không ghi lại toàn bộ base64 sau mỗi nét. Restart đọc lại cả scene và ảnh đã xác nhận.
- Đóng bảng: chặn lượt ghi mới, gom scene/files thành snapshot cuối nhất quán. `/close` gọi lại được phải trả đủ ảnh đã xác nhận. Không dùng nội dung thiếu ảnh để ghi đè một snapshot đầy đủ.
- Snapshot mới có version, elements và files; dataURL raster được nhúng, không chứa URL ký hay đường dẫn phụ thuộc thời hạn. API ghi một tệp tại đường dẫn snapshot hiện có, dùng lại upload intent chống ghi muộn khi xóa học sinh.
- Trước ACK ảnh mới, kiểm kích thước snapshot dự kiến theo đúng cách serialize và còn ngân sách cho nét; từ chối ảnh nếu snapshot dự kiến vượt 18 MiB. Trước finalize kiểm lại giới hạn 20 MiB của bucket, lỗi thì giữ dữ liệu bền trên máy chủ bảng và báo lưu còn chờ, không cắt dữ liệu hoặc báo đã lưu. Giới hạn này không hứa mọi bảng có vô hạn nét sẽ lưu được: bảng vượt ngưỡng cần phương án tệp ảnh riêng hoặc nâng giới hạn theo quyết định riêng. Không tự sửa bucket trên Cloud.
- Reader nhận được cả snapshot cũ là mảng elements và snapshot mới. Định dạng mới phải được kiểm trước khi render. Bảng cũ không bị sửa hàng loạt.
- Web client, máy chủ bảng và API phải nâng cấp tương thích trong cùng lần triển khai. Máy chủ công bố khả năng ảnh; web chỉ cho chèn khi máy chủ hỗ trợ. Không âm thầm bỏ files nếu kết nối bản cũ.

## Quyền và vòng đời dữ liệu

- Tái sử dụng xác thực/phân phòng của token bảng; giáo viên được tải ảnh trong đúng phòng, học sinh chỉ nhận. HTTP/API giữ kiểm profiles và quy tắc 404 hiện hành.
- Snapshot nằm trong bucket boards riêng tư, đúng đường dẫn học sinh/buổi học hiện hành. Quyền xem lại vẫn qua RLS; kiểm policy hiện tại bao phủ snapshot mới bằng test.
- Purge xóa scene và thư mục ảnh/tệp tạm của phòng, giữ dấu ended. Timer/lượt tải hoàn tất muộn không được tạo lại ảnh sau purge hoặc restart.
- Xóa học sinh tận dụng dọn một snapshot boards như trước. Không thêm đối tượng Storage ảnh riêng trong phương án này, không có vòng đời xóa mới tách khỏi snapshot.
- Không log nội dung hoặc tên file gốc. Ảnh không đi qua AI trong tính năng chèn bảng.

## Phạm vi code dự kiến

- Web: `Whiteboard`, `useBoardSync`, `boardConnection`, bộ chuẩn hóa ảnh, `BoardViewer`, data/api/preview và i18n.
- Máy chủ bảng: định dạng/protocol ảnh, rooms/store/server/auth nếu cần kiểm capability; dev local dùng cùng luồng để thử tablet không cần dịch vụ thật.
- API: kiểu bản bảng trả từ close, Protocol/SupabaseRepository/FakeRepo cho snapshot mới, finalize và test hồi quy xóa. Không thay nhà cung cấp video hay schema DB theo phương án đề xuất.
- Tài liệu: decisions, flows, testing và progress cập nhật cùng lần triển khai.

## Kiểm tra phải có

- Test đỏ trước: ảnh hiện tại bị loại; chưa có files khi lưu/xem lại. Sau sửa kiểm hai máy có cùng ảnh và nét đè lên.
- Quyền: học sinh tải ảnh bị chặn; phòng khác không đọc/nhận; payload sai MIME/id/hash/kích thước hoặc vượt quota bị từ chối, máy chủ còn sống.
- Kết nối: mất mạng giữa lúc tải, reconnect, client mới vào, máy chủ restart; ảnh đã ACK còn nguyên; tải dở không được báo thành công.
- Kết thúc/xóa xen upload: đóng khi tải dở, purge, restart, uploader ghi muộn; không tái tạo dữ liệu và không ghi snapshot thiếu ảnh.
- Tương thích: snapshot cũ xem được, snapshot mới có ảnh xem được sau kết thúc; xuất PNG bao gồm ảnh và nét.
- Dung lượng snapshot: tính cả base64/JSON/elements, sát ngưỡng và vượt ngưỡng bucket 20 MiB; vượt thì không báo lưu thành công, không xóa dữ liệu còn chờ trên máy chủ bảng.
- Browser: chọn file, tiến độ/lỗi/retry, đổi kích thước/viết đè, student chỉ xem, màn hình tablet và song ngữ. Đo độ trễ nét khi có ảnh và giới hạn dung lượng.
- Chạy `make test`, `make lint`, `make build-web` và E2E liên quan; nếu môi trường lỗi dùng lệnh thành phần và ghi đúng kết quả. Không sửa migration cũ. Không tự áp migration/gọi dịch vụ thật để nghiệm thu.

## Ngoài lát đầu

PDF nhiều trang, OCR đề bài, thư viện ảnh dùng lại giữa nhiều buổi, cắt/chỉnh ảnh nâng cao và học sinh tự chèn ảnh. Các phần này không cần để hoàn thành nhu cầu đã xác nhận.

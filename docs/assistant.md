# Bot OpenAI và RAG

Bản đầu: linh vật góc website có hai chế độ **Hướng dẫn** và **Hỏi AI**. Hướng dẫn chạy cục bộ; Hỏi AI dùng OpenAI Responses API với công cụ `search_knowledge` chỉ đọc. Giáo viên quản lý bài giảng tại `/assistant-materials`. Không hiển thị bot trong phòng học để giữ vùng bảng viết.

## Phạm vi hiện có

- Nguồn RAG: hướng dẫn ứng dụng được chọn sẵn trong `services/assistant.py` và bài giảng văn bản do giáo viên nhập, gắn chủ đề. Không lấy nguyên repo, log, hồ sơ hay ghi chú riêng làm nguồn. Chưa đọc PDF/ảnh.
- Model chọn từ khóa; API lấy vai trò từ `profiles`, truy xuất theo người đăng nhập rồi mới gửi các trích đoạn được phép sang OpenAI. Tìm kiếm dùng PostgreSQL full-text (`simple`), chưa có embedding/pgvector; cách diễn đạt hoặc dấu khác nhau có thể không tìm được nguồn.
- Giáo viên chỉ truy xuất bài giảng của mình. Quyền học sinh yêu cầu tài liệu được công bố, đúng giáo viên và có liên kết chủ đề trong buổi `completed` của học sinh; bỏ học sinh đang xóa. Học sinh không đọc trực tiếp kho qua PostgREST. API kiểm lại quyền nguồn sau khi model trả lời.
- Câu trả lời có nguồn đánh số và liên kết nội bộ. Kiểm số nguồn chỉ xác nhận nguồn tồn tại, không chứng minh model diễn giải đúng. Người dùng cần đối chiếu nguồn.
- Agent không tạo/sửa học sinh, lịch, ghi chú, điểm hay buổi học. Quản lý bài giảng vẫn qua biểu mẫu và xác nhận xóa.

## Bật trên máy local

Code đã kiểm cục bộ; **chưa gọi OpenAI thật**. Chủ dự án đã áp 0001–0010 lên Supabase (verify 22/22, 2026-10-21). Không cần bật AI để thử Hướng dẫn.

1. Migration 0001–0010 đã áp (verify 22/22 ngày 2026-10-21). Còn `0011_submissions_api_ocr.sql` cho nộp bài/OCR: áp file này, không chạy lại file đã áp, rồi chạy `supabase/verify_migrations.sql`: phải đạt **25/25**.
2. Chủ dự án tự cấu hình các biến **ở API**, theo `.env.example`; không gửi key vào chat hoặc đặt trong web:

   ```dotenv
   ASSISTANT_ENABLED=true
   OPENAI_API_KEY=<khóa do chủ dự án tự cấu hình>
   OPENAI_CHAT_MODEL=gpt-6-luna   # chủ dự án chọn 2026-10-21; hỗ trợ Responses + function calling
   ASSISTANT_DAILY_USER_TURNS=20
   ASSISTANT_DAILY_TOTAL_TURNS=100
   ASSISTANT_MAX_OUTPUT_TOKENS=1000
   ASSISTANT_STUDENT_LESSONS_ENABLED=false
   ```

3. Chọn model và hạn mức chi phí của dự án OpenAI trước khi bật; chưa đo chất lượng/chi phí/độ trễ model nào trong repo này. Khởi động lại API để nạp cấu hình, giữ web chạy, tải lại trang đăng nhập tại `http://localhost:5173/login?preview=off`.
4. Giáo viên mở bot → Hỏi AI → Bài giảng cho trợ lý AI. Tạo chủ đề trong Ghi chú riêng nếu chưa có, nhập bài giảng văn bản đã kiểm tra (không có thông tin cá nhân/lời giải tham chiếu), rồi thử bằng câu hỏi và tài liệu giả. Chấp thuận gửi câu hỏi/trích đoạn trước lượt hỏi đầu tiên.
5. Đối chiếu câu trả lời và liên kết nguồn, thử tài khoản giáo viên khác/học sinh. Chưa bật bài giảng cho học sinh trước khi có dữ liệu đánh giá E6/E7 và nghiệm thu model thật. Với cờ này tắt, AI cho học sinh chỉ tra hướng dẫn ứng dụng.

Tắt bằng `ASSISTANT_ENABLED=false` rồi khởi động lại API. Có thể chuẩn bị kho bài giảng khi AI tắt; bảng phải đã được tạo. Rollback 0010 chỉ cho phép khi cả tài liệu và bộ đếm sử dụng đều trống; không tự xóa dữ liệu để ép rollback.

## Teacher-Ops chỉ đọc (M1b.1)

Giáo viên có thêm chế độ **Lịch & lớp** trong linh vật, gọi `POST /api/assistant/teacher-ops` (chỉ giáo viên, cùng cờ bật AI và hạn mức lượt). Công cụ khai báo bằng Pydantic trong `services/teacher_ops.py`: `resolve_date` (dùng `core/time.py`, không để model đoán ngày), `find_student`, `list_students`, `list_upcoming`, `count_sessions` (cùng quy tắc với báo cáo tháng: chỉ buổi `completed`, theo giờ VN). Mọi tool chạy bằng id giáo viên lấy từ phiên và `profiles`; không có tool ghi. Yêu cầu tạo/sửa/hủy buổi, lịch, tài khoản thì trợ lý chỉ đường tới biểu mẫu; thẻ xác nhận cho thao tác ghi là lát M1b.2.

**Mã hóa tên (chủ dự án chọn 2026-10-21):** mỗi lượt, học sinh của giáo viên (bỏ học sinh đang xóa) được gán mã HS1, HS2…; tool chỉ trả mã, lớp, trạng thái. Tên đầy đủ có trong câu hỏi, lịch sử, môn hoặc chủ đề được thay bằng mã trước khi gửi. API đổi mã về tên trước khi trả cho trình duyệt. Giới hạn: tên gõ thiếu (ví dụ chỉ "An") vẫn tới OpenAI như giáo viên đã gõ; lớp, giờ học, môn/chủ đề (đã che tên đầy đủ) vẫn được gửi. Mã chỉ có nghĩa trong một lượt.

Một lượt gọi model tối đa 5 lần (4 vòng tool + câu trả lời), mỗi vòng một tool; quá giới hạn, tool lạ hoặc tham số sai là thất bại 502. Đổi giữa Hỏi AI và Lịch & lớp phải tích đồng ý lại.

## OCR ảnh bài làm bằng Gemini (M2.1)

Học sinh nộp ảnh bài về nhà; giáo viên bấm **Đọc bài bằng AI** ở trang Bài tập để Gemini chép lại chữ và công thức (LaTeX). Kết quả là gợi ý cho giáo viên (`submission_transcripts`, RLS chỉ GV của học sinh đọc), học sinh không thấy. AI không giải, không chấm, không công bố gì cho học sinh; giáo viên tự nhập nhận xét và điểm khi trả bài.

- **Bật:** sau khi áp migration `0011_submissions_api_ocr.sql` (verify phải đạt **25/25**), đặt ở API: `OCR_ENABLED=true`, `GEMINI_API_KEY=<khóa của chủ dự án>`, `GEMINI_OCR_MODEL=gemini-3.7-flash`, rồi khởi động lại API. `python -m app.preflight` báo nếu bật mà thiếu key/model. Không gửi key vào chat.
- **Chính sách dữ liệu (cần chủ dự án kiểm):** ảnh chữ viết tay của học sinh vị thành niên được gửi tới Google. Theo [điều khoản Gemini API](https://ai.google.dev/gemini-api/terms), dịch vụ **không trả phí** có thể dùng nội dung để cải thiện sản phẩm và cho người xem xét; chỉ dùng **dự án đã bật thanh toán** cho dữ liệu học sinh. Chưa ký thỏa thuận xử lý dữ liệu riêng.
- **Điều kiện mỗi lần đọc:** giáo viên của học sinh, học sinh không đang xóa, **đã ghi nhận phụ huynh đồng ý** (`students.consent_at`; thiếu thì 409, không gửi ảnh), bài nộp có ảnh. Mỗi lần đọc tính **một lượt** trong hạn mức AI ngày của giáo viên (`ASSISTANT_DAILY_USER_TURNS`, dùng chung với chat). Một yêu cầu Gemini (mức suy nghĩ `low`), timeout 90 s, không retry; bị chặn/cắt/rỗng là thất bại 502, không lưu bản chép dở.
- **Ảnh:** chỉ JPEG/PNG/WebP (xác định theo chữ ký file), tối đa `SUBMISSION_MAX_FILES` ảnh × `SUBMISSION_MAX_BYTES` byte. Web vẽ lại ảnh qua canvas (xoay đúng chiều, cạnh dài ≤ 2000 px, JPEG) rồi gửi; API gỡ EXIF/GPS/XMP/chú thích lần nữa trước khi lưu và trước khi gửi Gemini (`services/images.py`, không thêm thư viện). Trình duyệt không còn quyền tải ảnh thẳng vào Storage (0011).
- **Xóa:** ảnh nằm dưới `submissions/<student_id>/`, xóa hẳn học sinh dọn cả thư mục; bài nộp, ảnh, bản chép xóa theo khóa ngoại. Gemini có thể giữ dữ liệu theo chính sách của Google, ngoài quy trình xóa của ứng dụng.
- **Chưa làm/chưa đo:** chưa gọi Gemini thật (chất lượng OCR chữ viết tay tiếng Việt, chi phí, độ trễ chưa đo; E5 `not_run`), chưa có ghép câu theo ảnh, chấm gợi ý, PDF, giới hạn số lượt nộp lại (OQ11) hay nhắc hạn nộp.

## Dữ liệu, giới hạn và lỗi

Web giữ hội thoại trong bộ nhớ; API không lưu transcript và không log nội dung. Mỗi lượt gửi câu hỏi, tối đa ba lượt trao đổi gần nhất và các trích đoạn cần thiết sang OpenAI. `store:false` tắt lưu Response để lấy lại qua API; **không đồng nghĩa nhà cung cấp không lưu dữ liệu trong mọi trường hợp**. Chủ dự án cần xem [chính sách dữ liệu API](https://developers.openai.com/api/docs/guides/your-data) trước khi dùng với dữ liệu thật. Không tạo vector store hoặc tải toàn bộ bài giảng lên OpenAI.

Hạn mức ngày Việt Nam được giữ trong DB theo người dùng và toàn ứng dụng, có khóa giao dịch chống vượt khi nhiều yêu cầu đến cùng lúc. Một lượt có tối đa hai yêu cầu model, hoặc ba nếu bật kiểm đầu ra bài giảng cho học sinh; timeout 35 giây mỗi yêu cầu, không retry tự động. Trần output giới hạn 128–2000 token mỗi yêu cầu; các biến này giới hạn lượt/token, **không phải trần tiền theo tháng**. Lượt đã giữ bị tính cả khi provider lỗi. Bộ đếm cá nhân xóa theo tài khoản; tổng ngày không chứa danh tính, không hoàn lại khi xóa tài khoản. Chưa có tác vụ tự xóa bộ đếm cũ.

Provider lỗi, từ chối, output thiếu/truncated, tool sai hoặc nguồn không hợp lệ được coi là thất bại. Khi không có nguồn, bot nói chưa tìm được. Bộ kiểm bài giảng học sinh lỗi hoặc không trả `SAFE` thì không trả lời kiến thức. Đây là cơ chế đã kiểm bằng mô phỏng, chưa chứng minh chặn lời giải hoặc prompt injection trên model thật.

Kiểm hiện có: API/FakeRepo và HTTP giả, RLS/RPC PostgreSQL thật cục bộ, Playwright với API giả. **E1/E6/E7 model thật: `not_run`**. Teacher-Ops mới có phần chỉ đọc (M1b.1); thao tác ghi có xác nhận, audit, idempotency (M1b.2) và M4 Tutor chưa làm; các mốc đó vẫn theo [platform-workflow.md](platform-workflow.md).

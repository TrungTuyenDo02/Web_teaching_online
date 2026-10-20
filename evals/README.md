# Eval cho lớp hỗ trợ gia sư

Đã có runner **E0 thời gian xác định**, dùng đúng `apps/api/app/core/time.py`. Chưa phải toàn bộ E0 của spec: đếm buổi/trạng thái bài nộp/so đáp án sẽ có ca khi chức năng được triển khai. E1–E9 chưa có runner ở đây, gọi chúng trả `not_run` và mã thoát 2; các test API/RLS hiện có vẫn chạy riêng.

Từ gốc repo:

```powershell
apps/api/.venv/Scripts/python -m evals.run --suite E0
```

Hoặc `make test-evals` (Linux: `apps/api/.venv/bin/python`). `make test` và job CI API cũng chạy E0. Không đọc `.env`, không có API key, không gọi model.

`catalog.json` ghi rõ trạng thái từng suite; `suites/deterministic/cases.jsonl` chỉ gồm JSON hợp lệ, mỗi dòng một ca, không có dòng comment. Ca chỉ có `expected` hoặc `expected_error`, không có cả hai. Có thể truyền `--cases <file>` cho ca tổng hợp cục bộ và `--report-dir <folder>` để đổi chỗ xuất.

Báo cáo JSON và Markdown trong `reports/` ghi thời gian UTC, số ca, kết quả theo id, checksum bộ ca và mã xử lý. Không chứa lời thoại, ảnh hay dữ liệu học sinh. Thư mục bị gitignore; giữ báo cáo riêng khi cần so sánh, không lấy kết quả một lần chạy làm bảo đảm AI.

Mã thoát: **0** khi mọi ca chạy và đạt, **1** khi có ca không đạt, **2** khi thiếu runner, dữ liệu rỗng/sai/trùng id. Chưa có baseline model thì không có điểm chất lượng AI để công bố.

Thêm suite AI sau khi có module nghiệp vụ, model được ghim, prompt có phiên bản, bộ dữ liệu phù hợp và quyền gọi dịch vụ. Không tự sinh “đạt” từ fixture hoặc tự dùng dữ liệu thật. Theo lộ trình trong [quy trình hợp nhất](../docs/platform-workflow.md).

# Gia sư Online 1-1

Nền tảng dạy học trực tuyến 1-1 mang thương hiệu riêng: phòng học video, bảng viết đồng bộ (tablet dùng bút), quản lý học sinh, nộp và chữa bài. AI gợi ý chấm là Giai đoạn 3.

Đây là **bộ khung Giai đoạn 1**: cấu trúc, schema, các luồng chính đã có test. Chưa phải sản phẩm hoàn chỉnh (xem mục "Đã có và chưa có").

## Cấu trúc

```
apps/
  api/                FastAPI: xác thực, cấp token phòng học và bảng viết, điểm danh
  web/                React + TypeScript + Vite: đăng nhập, danh sách buổi học, phòng học
services/
  whiteboard-sync/    Node + WebSocket: đồng bộ nét vẽ Excalidraw giữa các thiết bị
supabase/
  migrations/         Schema PostgreSQL, RLS, bucket lưu ảnh
  tests/              Kiểm thử migration và RLS trên PostgreSQL cục bộ
docs/                 Kiến trúc, quyết định thiết kế, sơ đồ luồng (flows.md)
```

Hai tài liệu nên đọc trước: [docs/flows.md](docs/flows.md) (sơ đồ luồng) và [docs/architecture.md](docs/architecture.md).

## Yêu cầu

- Python 3.13, Node.js 22
- Tài khoản Supabase (miễn phí đủ để thử) và LiveKit Cloud (gói Build miễn phí) hoặc LiveKit tự dựng
- PostgreSQL 15+ cục bộ nếu muốn chạy `supabase/tests/run.sh`

## Bắt đầu nhanh

```bash
cp .env.example .env                       # điền khóa Supabase, LiveKit, WHITEBOARD_JWT_SECRET
cp apps/web/.env.example apps/web/.env.local

make install                               # venv cho API, npm ci cho web và whiteboard-sync
```

1. Trong Supabase, chạy lần lượt `supabase/migrations/0001_init.sql` rồi (khi cần) `0002_ai_grading.sql` ở SQL Editor.
2. Tạo hai tài khoản trong Supabase Auth (giáo viên, học sinh). Làm theo hướng dẫn trong `supabase/seed.sql` để nâng quyền giáo viên và tạo học sinh, buổi học mẫu.
3. Chạy ba tiến trình, mỗi cái một cửa sổ terminal:

```bash
make dev-api      # http://localhost:8000  (tài liệu API: /docs)
make dev-board    # ws://localhost:8787
make dev-web      # http://localhost:5173
```

Tạo `WHITEBOARD_JWT_SECRET` bằng `openssl rand -hex 32`.

## Kiểm tra

```bash
make test         # API (pytest) và whiteboard-sync (node:test)
make lint         # ruff, typecheck web và whiteboard-sync
make build-web
PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh   # migration và RLS
```

## Đã có và chưa có

Đã có và đã kiểm tra:
- API: xác thực JWT Supabase, vào phòng (`/api/sessions/{id}/join`) với kiểm tra quyền, trạng thái, khung giờ; chế độ `board` cho tablet không nhận token video; kết thúc buổi học; điểm danh. 13 test.
- Máy chủ bảng viết: xác thực token, tách phòng theo buổi học, gộp xung đột theo version, kiểm tra Origin, nối lại khi rớt mạng. 14 test.
- Schema và RLS: học sinh chỉ thấy dữ liệu của mình, không tự nâng quyền, không nộp bài thay bạn; kiểm thử trên PostgreSQL 16.
- Web: đăng nhập, danh sách buổi học, phòng học (video + bảng), build và typecheck đạt.

Chưa có hoặc chưa kiểm thử:
- **Chưa chạy thử với Supabase, LiveKit thật và bút trên tablet.** Việc đầu tiên nên làm là thử bút Android với bảng viết (xem docs/decisions.md, quyết định 1).
- Màn hình tạo học sinh, tạo buổi học, giao bài, nộp bài, chữa bài (Giai đoạn 1 và 2). Hiện thêm dữ liệu qua Supabase.
- Lưu ảnh bảng cuối buổi lên Storage (hiện chỉ tải về máy).
- Tự đặt `no_show`, nhắc lịch, AI chấm (Giai đoạn 3; mới có schema).
- PWA (cài như ứng dụng), font Excalidraw tự lưu trữ (hiện tải từ CDN của Excalidraw).
- Dockerfile và `docker-compose.yml` chưa được build thử.
- Phần bảng viết và video của web khá nặng (riêng `Whiteboard` khoảng 1,1 MB, nén gzip 345 KB, cộng thêm các gói phụ của Excalidraw); chỉ tải khi vào phòng. Cần đo lại trên mạng 4G thật.

## Bảo mật cần nhớ

- `.env` không bao giờ được commit (đã nằm trong `.gitignore`).
- `SUPABASE_SERVICE_ROLE_KEY` và `LIVEKIT_API_SECRET` chỉ ở máy chủ. Web chỉ dùng khóa anon của Supabase.
- Ảnh bài làm của học sinh là dữ liệu cá nhân, có thể của trẻ vị thành niên: cần sự đồng ý của phụ huynh (`students.consent_at`), không ghi hình mặc định, và nên đối chiếu Nghị định 13/2023 về bảo vệ dữ liệu cá nhân.
- Xác thực API hiện dùng JWT HS256 của Supabase. Dự án Supabase mới có thể dùng khóa bất đối xứng (JWKS), khi đó cần đổi ở `apps/api/app/auth.py`.

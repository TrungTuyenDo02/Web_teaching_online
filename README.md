# Gia sư Online 1-1

Nền tảng dạy học trực tuyến 1-1 cho một giáo viên và nhiều học sinh: phòng học video, bảng viết đồng bộ (giáo viên viết bằng bút trên tablet Android), quản lý học sinh, lịch và báo cáo buổi học. Học sinh có thể là trẻ vị thành niên nên quyền riêng tư là yêu cầu hàng đầu.

**Trạng thái (2026-10-20):** Giai đoạn 1 đã code xong và có test tự động, **chưa nghiệm thu** với dịch vụ thật và tablet thật. Phần mở rộng theo [TUTOR_PLATFORM_SPEC.md](TUTOR_PLATFORM_SPEC.md) đang làm theo mốc: xong M0 nền và M1a (báo cáo tháng, ghi chú riêng, lịch hằng tuần); M1b–M5 chưa làm. Chi tiết: [docs/progress.md](docs/progress.md).

## Chức năng

| Nhóm | Đã có |
|---|---|
| Phòng học | Video LiveKit; bảng viết Excalidraw đồng bộ qua máy chủ riêng; tablet ở chế độ `board` chỉ vào bảng (không tính phút video); học sinh chỉ xem bảng; nối lại và gửi bù khi mất mạng |
| Buổi học | Tạo/sửa/hủy, vào phòng, kết thúc (đóng phòng, lưu ảnh bảng vào Storage), tự đánh `no_show`, xem lại bảng của buổi đã học |
| Học sinh | Tạo tài khoản, sửa, ngừng dạy, xóa hẳn (dọn Auth, Storage, bảng; làm tiếp được nếu lỗi giữa chừng) |
| Quản lý (M1a) | Báo cáo số buổi theo tháng + CSV; ghi chú riêng của giáo viên và chủ đề đã dạy (xuất Markdown/CSV); lịch hằng tuần tự sinh buổi 28 ngày, chống sinh trùng ở DB |
| Giao diện | Tiếng Việt/tiếng Anh, trang giới thiệu cho khách, dùng được trên điện thoại và tablet (vùng chạm ≥ 44 px) |

Chưa có: giao, nộp, chữa bài; trợ lý giáo viên (Teacher-Ops); AI chấm bài; Tutor. Không ghi hình buổi học.

## Cấu trúc

```
apps/
  api/                FastAPI: xác thực, quyền, buổi học, học sinh, báo cáo, lịch, cấp token video/bảng
  web/                React 19 + TypeScript + Vite: trang giáo viên, học sinh, phòng học
services/
  whiteboard-sync/    Node 22 + ws: đồng bộ nét vẽ giữa các thiết bị, lưu bảng
supabase/
  migrations/         Schema PostgreSQL, RLS, bucket (0001 → 0009)
  rollback/           Gỡ thủ công 0008, 0009 (chỉ khi bảng trống)
  tests/              Kiểm thử migration, RLS, giao dịch hai kết nối
evals/                Eval xác định (E0: thời gian nghiệp vụ)
docs/                 Tiến độ, luồng, kiến trúc, quyết định, nghiệm thu, kiểm thử
```

Tài liệu nên đọc: [docs/progress.md](docs/progress.md) (đang làm gì, việc tiếp theo), [docs/flows.md](docs/flows.md) (sơ đồ luồng), [docs/architecture.md](docs/architecture.md), [docs/decisions.md](docs/decisions.md), [docs/platform-workflow.md](docs/platform-workflow.md) (lộ trình M0–M5). Hướng dẫn cho công cụ code AI: [AGENTS.md](AGENTS.md).

## Yêu cầu

- Python 3.13, Node.js 22, `make`
- Dự án Supabase và LiveKit (Cloud hoặc tự dựng)
- PostgreSQL 15+ cục bộ nếu chạy `supabase/tests/run.sh`

## Bắt đầu nhanh

```bash
cp .env.example .env                        # điền khóa Supabase, LiveKit, WHITEBOARD_JWT_SECRET (openssl rand -hex 32)
cp apps/web/.env.example apps/web/.env.local
make install                                # venv cho API, npm ci cho web và máy chủ bảng
```

1. Trong Supabase SQL Editor, áp lần lượt các file `supabase/migrations/` chưa áp (không chạy lại file đã áp), rồi chạy `supabase/verify_migrations.sql` (chỉ đọc). Hướng dẫn: [docs/acceptance.md](docs/acceptance.md) mục 1.
2. Kiểm cấu hình và schema thật (chỉ đọc, không in khóa): `cd apps/api && .venv/Scripts/python -m app.preflight`.
3. Tạo tài khoản giáo viên theo `supabase/seed.sql`.
4. Chạy ba tiến trình, mỗi cái một cửa sổ:

```bash
make dev-api      # http://127.0.0.1:8000  (tài liệu API: /docs)
make dev-board    # ws://localhost:8787
make dev-web      # http://localhost:5173
```

Chỉ xem giao diện, chưa cần Supabase/LiveKit: `make dev-web` rồi mở `http://localhost:5173/?preview=teacher` hoặc `?preview=student` (dữ liệu minh họa, chỉ bản development).

### Thử bảng viết không cần dịch vụ thật

```bash
make dev-board-local   # máy chủ bảng thử, khóa ngẫu nhiên, dữ liệu tạm (xóa khi Ctrl+C)
make dev-web
```

Mở `http://localhost:5173/dev/whiteboard`, bấm "Mở tab học sinh", viết ở tab giáo viên và xem tab học sinh nhận nét. Trang có nút ngắt máy chủ 10 giây và treo đường truyền 40 giây để thử mất kết nối.

Thử bằng tablet Android cùng Wi-Fi: `make dev-board-lan LAN_IP=<IP laptop>` và `make dev-web-lan LAN_IP=<IP laptop>`, rồi làm theo [docs/tablet-wifi.md](docs/tablet-wifi.md).

## Kiểm tra

```bash
make test             # API (pytest), máy chủ bảng (node:test), eval E0
make lint             # ruff, guard thời gian, typecheck web và máy chủ bảng
make build-web
make test-e2e-smoke   # test trình duyệt Playwright (make test-e2e: bộ đầy đủ)
PGHOST=localhost PGUSER=postgres ./supabase/tests/run.sh   # migration, RLS (cần PostgreSQL có contrib)
```

Cách viết và chạy test: [docs/testing.md](docs/testing.md). Nghiệm thu với dịch vụ thật, tablet và buổi thử 45–60 phút: [docs/acceptance.md](docs/acceptance.md).

## Còn mở trước khi dạy thật

- **Token video:** token cấp trước khi kết thúc buổi vẫn vào lại được phòng đã xóa trên LiveKit Cloud (T3/T3B). Chờ đo thêm (T8b/T15) rồi làm nhãn danh tính. Xem [docs/design-video-token.md](docs/design-video-token.md).
- Migration `0009_weekly_slots.sql` chưa áp lên Supabase thật.
- Chưa chạy toàn luồng với Supabase/LiveKit thật, chưa thử bút trên tablet Android, chưa thử sao lưu/khôi phục, chưa chốt thời hạn giữ dữ liệu đã xóa trong bản sao lưu.
- Giao diện Excalidraw còn tiếng Anh. Dockerfile và `docker-compose.yml` chưa build thử.

## Bảo mật

- Không commit file môi trường (`.env`, `.env.*`, trừ `.env.example`).
- `SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_API_SECRET`, `WHITEBOARD_JWT_SECRET` chỉ ở `apps/api` và `services/whiteboard-sync`. Web chỉ dùng khóa anon của Supabase.
- Mọi bảng bật RLS; mọi thao tác ghi đi qua API. Vai trò lấy từ bảng `profiles`, không tin claim trong JWT. API trả 404 khi người dùng không có quyền với một buổi học.
- Ảnh bài làm và ghi chú là dữ liệu cá nhân, có thể của trẻ vị thành niên: cần sự đồng ý của phụ huynh (`students.consent_at`), không ghi hình mặc định, không log nội dung bài làm, đối chiếu Nghị định 13/2023 về bảo vệ dữ liệu cá nhân.

# Sơ đồ luồng

Các sơ đồ viết bằng Mermaid: GitHub, VS Code (có tiện ích Mermaid) và nhiều công cụ tự hiển thị. Sửa sơ đồ ngay trong file này.

Mỗi sơ đồ có phần **"Cần bạn xác nhận"** ở cuối trang này. Nếu luồng nào chưa đúng ý, sửa ở đây trước khi giao cho Claude Code/Codex code tiếp.

## 1. Kiến trúc tổng thể

```mermaid
flowchart LR
  subgraph Devices["Thiết bị"]
    L["Laptop giáo viên: camera và micro"]
    T["Tablet Android: chỉ làm bảng viết"]
    S["Học sinh: laptop hoặc tablet"]
  end
  subgraph Web["Web app React/PWA (Cloudflare Pages)"]
    UI["Giao diện thương hiệu riêng"]
  end
  subgraph Server["Máy chủ của bạn"]
    API["API FastAPI: xác thực, cấp token, điểm danh"]
    WB["whiteboard-sync: đồng bộ nét vẽ"]
  end
  subgraph Cloud["Dịch vụ ngoài"]
    SB[("Supabase: Auth, PostgreSQL, Storage")]
    LK["LiveKit: video và micro"]
    AI["Dịch vụ AI (Giai đoạn 3)"]
  end
  L --> UI
  T --> UI
  S --> UI
  UI -- "đăng nhập, đọc dữ liệu qua RLS" --> SB
  UI -- "vào phòng, gửi JWT" --> API
  API -- "kiểm tra quyền, ghi điểm danh" --> SB
  API -- "ký token phòng" --> LK
  UI -- "video và micro (WebRTC)" --> LK
  UI -- "nét vẽ (WebSocket)" --> WB
  API -. "gợi ý chấm (GĐ3)" .-> AI
```

## 2. Đăng nhập và phân quyền

```mermaid
sequenceDiagram
  autonumber
  actor U as Người dùng
  participant W as Web app
  participant A as Supabase Auth
  participant DB as PostgreSQL và RLS
  U->>W: Nhập email và mật khẩu
  W->>A: signInWithPassword
  A-->>W: JWT (access token)
  W->>DB: Đọc danh sách buổi học kèm JWT
  DB->>DB: RLS dùng auth.uid() để lọc từng hàng
  DB-->>W: Giáo viên thấy học sinh của mình, học sinh chỉ thấy dữ liệu của em
```

## 3. Vào phòng học (laptop và tablet)

```mermaid
sequenceDiagram
  autonumber
  actor GV as Giáo viên
  participant L as Laptop
  participant T as Tablet
  participant API as API FastAPI
  participant DB as Supabase
  participant LK as LiveKit
  participant WB as whiteboard-sync
  GV->>L: Bấm "Vào lớp"
  L->>API: POST /api/sessions/ID/join với mode=main
  API->>DB: Lấy hồ sơ và buổi học
  API->>API: Kiểm tra đúng giáo viên hoặc học sinh, trạng thái, khung giờ
  alt Hợp lệ
    API->>DB: Giáo viên vào đầu tiên thì đặt trạng thái live, ghi điểm danh
    API-->>L: Token LiveKit và token bảng viết
    L->>LK: Vào phòng video
    L->>WB: Kết nối bảng bằng token
  else Không hợp lệ
    API-->>L: 404 không lộ buổi học, hoặc 409 sai giờ hay đã kết thúc
  end
  GV->>T: Bấm "Dùng làm bảng viết"
  T->>API: POST join với mode=board
  API-->>T: Chỉ token bảng viết, không có token video
  T->>WB: Kết nối bảng
```

## 4. Đồng bộ bảng viết

```mermaid
sequenceDiagram
  participant T as Tablet dùng bút
  participant WB as whiteboard-sync
  participant S as Học sinh
  T->>WB: auth kèm token
  WB-->>T: init gồm nội dung bảng hiện có
  S->>WB: auth kèm token
  WB-->>S: init
  T->>WB: update gồm các nét mới theo version
  WB->>WB: Giữ bản có version cao hơn, bằng nhau thì versionNonce thấp hơn thắng
  WB-->>S: update chỉ gồm phần được nhận
  Note over T,WB: Rớt mạng thì tự nối lại và gửi nốt phần chưa gửi
  Note over WB: Hết người trong phòng thì giữ nội dung 10 phút rồi xóa
```

## 5. Giao bài, nộp bài và chữa bài

```mermaid
flowchart TD
  A["Giáo viên giao bài"] --> B["Học sinh chụp ảnh bài làm"]
  B --> C["Tải ảnh lên Storage, thư mục theo student_id"]
  C --> D["Tạo submission, trạng thái submitted"]
  D --> E["Giáo viên mở ảnh, đánh dấu lỗi, viết nhận xét, chấm điểm"]
  E --> F{"Ảnh đủ rõ?"}
  F -- "Không" --> G["Yêu cầu học sinh chụp lại"]
  G --> B
  F -- "Có" --> H["Trả bài: status returned, score, teacher_comment"]
  H --> I["Học sinh xem kết quả"]
  H --> J["Tổng hợp tiến độ và lỗi thường gặp cho buổi sau"]
```

## 6. Vòng đời một buổi học

```mermaid
stateDiagram-v2
  [*] --> scheduled: Giáo viên tạo buổi học
  scheduled --> live: Giáo viên vào phòng trong khung giờ
  scheduled --> cancelled: Hủy buổi học
  scheduled --> no_show: Quá giờ mà không ai vào
  live --> completed: Giáo viên kết thúc, ghi nội dung và bài về nhà
  completed --> [*]
  cancelled --> [*]
  no_show --> [*]
```

## 7. Mô hình dữ liệu

```mermaid
erDiagram
  PROFILES ||--o{ STUDENTS : "giáo viên quản lý"
  PROFILES ||--o| STUDENTS : "tài khoản đăng nhập của học sinh"
  STUDENTS ||--o{ SESSIONS : "có"
  PROFILES ||--o{ SESSIONS : "dạy"
  SESSIONS ||--o{ SESSION_ATTENDANCE : "điểm danh"
  PROFILES ||--o{ SESSION_ATTENDANCE : "tham gia"
  STUDENTS ||--o{ ASSIGNMENTS : "được giao"
  SESSIONS |o--o{ ASSIGNMENTS : "sinh ra"
  STUDENTS ||--o{ SUBMISSIONS : "nộp"
  ASSIGNMENTS |o--o{ SUBMISSIONS : "cho"
  SUBMISSIONS ||--o{ SUBMISSION_FILES : "gồm ảnh"
  SUBMISSIONS ||--o{ AI_GRADING_SUGGESTIONS : "có gợi ý GĐ3"

  PROFILES {
    uuid id PK
    user_role role
    text full_name
  }
  STUDENTS {
    uuid id PK
    uuid teacher_id FK
    uuid profile_id FK
    text full_name
    timestamptz consent_at
  }
  SESSIONS {
    uuid id PK
    uuid teacher_id FK
    uuid student_id FK
    text room_name
    session_status status
    timestamptz scheduled_start
    timestamptz scheduled_end
    text summary
    text homework_note
  }
  SESSION_ATTENDANCE {
    uuid id PK
    uuid session_id FK
    uuid profile_id FK
    device_mode device_mode
    timestamptz joined_at
  }
  ASSIGNMENTS {
    uuid id PK
    uuid student_id FK
    uuid session_id FK
    text title
    timestamptz due_at
  }
  SUBMISSIONS {
    uuid id PK
    uuid student_id FK
    uuid assignment_id FK
    submission_status status
    numeric score
    text teacher_comment
  }
  SUBMISSION_FILES {
    uuid id PK
    uuid submission_id FK
    text storage_path
    text kind
  }
  AI_GRADING_SUGGESTIONS {
    uuid id PK
    uuid submission_id FK
    jsonb errors
    numeric suggested_score
    ai_suggestion_status status
  }
```

## 8. AI gợi ý chấm (Giai đoạn 3, giáo viên luôn là người duyệt)

```mermaid
flowchart TD
  A["Học sinh nộp ảnh"] --> B{"Còn trong ngân sách và số ảnh mỗi ngày?"}
  B -- "Không" --> M["Chấm thủ công"]
  B -- "Có" --> C["Nén ảnh rồi gửi cho AI"]
  C --> D["AI trả lời giải đọc được, bước sai, lý do, điểm gợi ý theo rubric"]
  D --> E{"Ảnh đủ rõ để đọc?"}
  E -- "Không" --> M
  E -- "Có" --> F["Lưu gợi ý, chỉ giáo viên thấy, ghi chi phí vào ai_usage_log"]
  F --> G["Giáo viên duyệt: chấp nhận, sửa hoặc bác bỏ"]
  G --> H["Trả bài cho học sinh"]
  M --> H
```

## 9. Lộ trình các giai đoạn

```mermaid
flowchart LR
  P0["GĐ 0: test bút trên tablet, thử Excalidraw"] --> P1["GĐ 1: phòng học, bảng viết, buổi học"]
  P1 --> P2["GĐ 2: hồ sơ học sinh, lịch, nộp và chữa bài"]
  P2 --> P3["GĐ 3: AI gợi ý chấm, nhắc lịch, báo cáo tiến độ"]
```

## Cần bạn xác nhận

1. **Học sinh có được viết lên bảng không?** Hiện tại có: cả hai bên cùng viết được. Nếu muốn học sinh chỉ xem, cần thêm quyền "chỉ xem" vào token bảng viết.
2. **Khung giờ vào phòng:** mặc định vào sớm 15 phút và muộn tối đa 60 phút sau giờ kết thúc (đổi ở `JOIN_EARLY_MINUTES`, `JOIN_LATE_MINUTES`).
3. **Học sinh vào trước giáo viên:** vẫn vào được phòng video nhưng buổi học chỉ chuyển sang `live` khi giáo viên vào.
4. **`no_show`:** sơ đồ 6 có trạng thái này nhưng chưa có tác vụ tự động đặt nó. Hiện chỉ đổi được thủ công.
5. **Tạo học sinh và buổi học:** chưa có màn hình trên web ở bản khung này, tạm thêm qua bảng điều khiển Supabase. Đây là việc đầu tiên của Giai đoạn 1.
6. **Ảnh bảng cuối buổi:** hiện tải về máy. Lưu tự động vào bucket `boards` và gắn vào buổi học là việc tiếp theo.
7. **Ghi hình:** tắt (`RECORDING_ENABLED=false`). Không có luồng ghi hình trong sơ đồ.
8. **Học sinh dưới 18 tuổi:** cột `consent_at` lưu thời điểm phụ huynh đồng ý. Chưa có ràng buộc chặn vào phòng nếu thiếu đồng ý, bạn có muốn bật không?

# Thiết kế: chặn token video cũ vào lại phòng đã đóng

**Trạng thái (2026-10-20): B2 đã code và test cục bộ, CHƯA duyệt production, P1 CHƯA được bảo đảm.** Chủ dự án cho phép viết test và bản thử cục bộ; chưa cho triển khai production. Chưa đổi cấu hình LiveKit Cloud, chưa gọi LiveKit thật cho bản này, chưa deploy. Lỗi "token video cũ" vẫn **mở** (`acceptance.md` mục 5). Chỉ ghi quyết định production mới trong `decisions.md` và sửa quyết định 18 ("Còn hở") khi thử dev (mục 9.3) đạt và chủ dự án duyệt.

Đã chốt: `/join` không tạo được phòng video thì trả **502 "Chưa mở được phòng video, thử lại"**.

## 1. Vấn đề

Lỗi mở ở quyết định 18 và `acceptance.md` mục 5, đã xác nhận trên LiveKit Cloud ngày 2026-10-20: token `/join` sống đến hết khung giờ vào phòng; `/end` xóa phòng và ngắt mọi người (`ROOM_DELETED`), nhưng LiveKit mặc định **tự tạo phòng khi có người vào**, nên ai còn giữ token cũ (SDK tự nối lại sau khi mất mạng, hoặc cố ý dùng lại) vào được một phòng mới cùng tên. Hậu quả: tốn phút video; hai người cùng giữ token cũ có thể gặp nhau sau giờ học (học sinh có thể là trẻ vị thành niên).

## 2. Hai thuộc tính cần tách bạch

- **(P1) Chặn truy cập:** sau khi buổi đã `completed`, không ai dùng token cấp trước đó để có media với người khác được nữa. Đây là yêu cầu an toàn.
- **(P2) Dọn phòng cuối cùng:** mọi phòng của buổi đã đóng (`completed`, `cancelled`, `no_show`) cuối cùng đều bị xóa, kể cả khi API chết, lệnh LiveKit lỗi hoặc hoàn tất muộn. Đây là yêu cầu chi phí và vệ sinh; có giới hạn thời gian, không tức thời.

P2 không thay được P1: trong khoảng chờ dọn, phòng còn tồn tại thì token cũ vào được, trừ khi có P1. Ngoài ra giữ nguyên (P0): giữa buổi rớt mạng vẫn nối lại được; tablet chế độ `board` không vào và không tạo phòng video; mọi lời gọi LiveKit của ứng dụng nằm trong `apps/api/app/services/tokens.py`.

## 3. Dữ kiện đã kiểm (2026-10-20, chỉ đọc tài liệu và mã SDK, không gọi dịch vụ thật)

**SDK đang cài** (`apps/api/.venv`: `livekit-api` 1.2.2, `livekit-protocol` 1.1.27):

- `RoomParticipantIdentity` có trường `revoke_token_ts` (int64); `room.remove_participant` cần quyền `room_admin` của phòng đó; `create_room`/`delete_room` cần `room_create`. Dùng được ngay, không cần nâng SDK.
- `AccessToken.to_jwt()` luôn đặt `nbf` bằng giờ ký (theo **giây**), không có tùy chọn đổi. Token API cấp chỉ có `room_join` (không có `room_create`).
- `TwirpClient.request`: lỗi mạng hoặc HTTP 5xx thì **phát lại nguyên yêu cầu tối đa 3 lần** (failover) khi host là `*.livekit.cloud` và timeout ≥ 5 s; `LiveKitAPI` mặc định timeout 10 s. Hệ quả: một lệnh `CreateRoom` có thể mất hơn 30 s, và một lần gửi đã bị bỏ phía client (timeout) **vẫn có thể được máy chủ thực hiện sau**.

**Tài liệu LiveKit hiện hành:**

- `RemoveParticipant` trên **LiveKit Cloud** thu hồi token hiện tại của người đó; `revoke_token_ts` là mốc `nbf`: token có `nbf` sớm hơn mốc bị từ chối khi nối lại. Mốc **phải trong vòng 60 s so với giờ máy chủ**, nếu không trả `InvalidArgument`. Bỏ trống thì máy chủ dùng giờ hiện tại **trừ đệm một phút**. Gọi với identity đã rời phòng thì trả lỗi `participant does not exist` nhưng token vẫn bị thu hồi; truyền `revoke_token_ts` để không báo lỗi. Chỉ có trên Cloud. Nguồn: [Participant management](https://docs.livekit.io/intro/basics/rooms-participants-tracks/participants/), [Room service API](https://docs.livekit.io/reference/other/roomservice-api/), [Tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants/).
- Hạn token chỉ áp lúc nối lần đầu; máy chủ tự cấp token mới cho client đang nối, sống "10 phút hoặc thời gian còn lại của token gốc, lấy giá trị lớn hơn" ([Tokens & grants](https://docs.livekit.io/frontends/reference/tokens-grants/)).
- `CreateRoom`: `empty_timeout` mặc định 300 s, `departure_timeout` mặc định 20 s. `DeleteRoom` ngắt mọi người ([Room service API](https://docs.livekit.io/reference/other/roomservice-api/)).
- Công tắc "auto-create room" cấp dự án trên Cloud: tắt thì vào phòng không tồn tại nhận `404 not_found` ([LiveKit community](https://community.livekit.io/t/agentdispatchservice-createdispatch-does-not-auto-create-room/1285)). Nguồn cộng đồng, chưa kiểm trên dự án của mình.

**Tài liệu không nói, nên chưa được coi là đúng:**

- Thu hồi theo khóa nào, **có còn hiệu lực sau khi phòng bị xóa rồi tạo lại cùng tên không**, giữ bao lâu, có ghi nhận khi phòng không tồn tại không, mốc ở tương lai có được không, có áp lên token máy chủ cấp lại không, lan giữa các vùng mất bao lâu. Về thời gian thu hồi có hiệu lực, nhân viên LiveKit chỉ nói "there are no specific published guarantees" ([community](https://community.livekit.io/t/recipient-media-telemetry-and-revocation-guarantees/2207)); câu đó không nói gì về thời gian giữ thu hồi. không có "hard deadline", backend phải tự gọi ([community](https://community.livekit.io/t/existing-tier-provider-enforced-active-session-deadline/2008)).
- Chỉ để tham khảo, **không dùng làm bằng chứng cho Cloud**: PR mã nguồn mở [livekit#4344](https://github.com/livekit/livekit/pull/4344) (chưa merge) khóa theo phòng + identity, giữ **11 phút**, sống qua việc tạo lại phòng.
- LiveKit mã nguồn mở đã thêm "tự tạo phòng theo quyền `roomCreate` trong token" ([livekit#4504](https://github.com/livekit/livekit/issues/4504)); Cloud chưa rõ. Vì vậy token cấp cho người dùng **không bao giờ được có `room_create`** (có test).

## 4. Vì sao B nguyên trạng chưa đủ

B: tắt auto-create; `/join` tạo phòng rồi đọc lại trạng thái; thấy buổi đã đóng thì xóa bù và trả 409. Phản ví dụ (đều đã có test tái hiện theo mô hình, mục 9):

1. **Khoảng hở trước khi xóa bù:** `/end` xóa phòng → `/join` tạo lại → token cũ vào được → `/join` đọc lại, xóa bù.
2. **Phòng mồ côi sau khi `finalized_at` đã ghi:** API chết giữa `CreateRoom` và xóa bù; `CreateRoom` hoàn tất muộn; hoặc xóa bù lỗi. Vòng lặp nền chỉ thử lại buổi có `finalized_at` rỗng nên không ai dọn; phòng sống cả khung giờ.
3. **Hủy và vắng mặt** sau khi học sinh đã vào trước: không đường nào xóa phòng.
4. **Join treo sau lần đọc cuối** (phát hiện khi viết test): join đọc thấy `live`, bị treo; `/end` làm xong; join ký token sau đó. Token có `nbf` sau mốc thu hồi nên thu hồi không chặn; chỉ còn "phòng không tồn tại" chặn. Cũng xảy ra khi token ký **cùng giây** với lúc thu hồi (mốc theo giây, so sánh `nbf < mốc`).
5. **Xóa bù chạy trước khi `finalize` kịp thu hồi** (phát hiện khi viết test): lần thu hồi sau gặp phòng không còn; nếu Cloud không ghi nhận thu hồi khi phòng không tồn tại (chưa biết, T7), token cũ không bị thu hồi.

## 5. B2: B + thu hồi trước khi xóa + dọn theo danh sách phòng (đã code cục bộ)

| Lớp | Lo cho | Cơ chế |
|---|---|---|
| L1. Tắt auto-create (cấu hình Cloud, **chưa làm**) | P1 khi phòng không còn | Công tắc dự án; API tự tạo phòng |
| L2. Thu hồi trước khi xóa | P1 trong khoảng phòng bị tạo lại | Mọi chỗ xóa phòng đều `RemoveParticipant` + `revoke_token_ts` cho identity giáo viên và học sinh trước; token có `nbf` lùi về lúc đọc trạng thái |
| L3. Dọn theo danh sách phòng | P2 cho mọi phòng mồ côi, không phụ thuộc `finalized_at` | Vòng lặp nền sẵn có: `ListRooms`, phòng của buổi đã đóng thì thu hồi + xóa |

### Code đã đổi

- `services/tokens.py` (vẫn là chỗ duy nhất ứng dụng gọi LiveKit):
  - `_livekit(settings, timeout)`: một chỗ tạo client (test thay bằng `FakeLiveKit`).
  - `ensure_livekit_room(settings, room_name, keep_open)`: `CreateRoom` với `empty_timeout = departure_timeout =` khoảng còn lại đến hết khung giờ; timeout HTTP 4 s (dưới 5 s thì SDK không tự phát lại).
  - `close_livekit_room(settings, room_name, identities=())`: thu hồi từng identity với mốc = giờ hiện tại (bỏ qua `not_found`), **thu hồi lỗi vẫn xóa phòng** rồi mới báo lỗi; xóa bỏ qua `not_found`.
  - `make_livekit_token(..., not_before=)`: ký lại cùng claim, chỉ đổi `nbf = not_before − 1 phút` (lệch đồng hồ giữa các tiến trình). Thay cho ý "mốc thu hồi ở tương lai" của bản đề xuất trước: không phụ thuộc Cloud có nhận mốc tương lai không.
  - `list_livekit_rooms`: trả tên phòng và kết quả xác minh nhãn sở hữu; `list_livekit_room_names`/`count_livekit_rooms` (preflight) dùng lại nó. Metadata khi tạo phòng có chữ ký HMAC, gắn với tên phòng và môi trường (mục 10).
- `routers/sessions.py` `/join`, chỉ `main`: tạo phòng **ngay sau kiểm tra khung giờ, trước khi chuyển `live` và ghi điểm danh**; lỗi thì 502, không ghi gì. Ghi giờ ngay trước lần đọc lại trạng thái; token video lấy `nbf` theo giờ đó. Đọc lại thấy buổi đã đóng: đóng điểm danh, **thu hồi rồi xóa** (lỗi thì ghi log, L3 dọn), trả 409. `board`: không tạo, không xóa, không token video.
- `services/finalize.py`: `video_identities` (giáo viên + `profile_id` học sinh); `finalize_session` thu hồi rồi xóa; `sweep_livekit_rooms`: xóa phòng của buổi đã đóng hoặc học sinh đang xóa, kể cả khi `finalized_at` đã ghi. Không còn hàng buổi học thì chỉ xóa phòng có nhãn sở hữu hợp lệ của môi trường này; phòng lạ giữ lại. Lỗi đọc DB không được coi là không còn hàng.
- `services/student_deletion.py`: đóng phòng buổi `live` có thu hồi.
- `services/no_show.py`: vòng lặp nền gọi `sweep_livekit_rooms` mỗi chu kỳ (`NO_SHOW_INTERVAL_SECONDS`, mặc định 300 s).
- `repo.py`: `get_session_by_room_name` (Protocol, Supabase, `FakeRepo`). Không có migration (`room_name` đã `unique`).
- `models.py`: `CLOSED_STATUSES` dùng chung cho `/join` và vòng lặp dọn.
- Web không sửa: 502 hiện `detail` qua `apiFetch`.
- Máy dev không có LiveKit: `/join` main trả 502 (trước đây vẫn cấp token dù không nối được). Thử bảng dùng `board` hoặc `/dev/whiteboard`.

## 6. Thứ tự và nhiều tiến trình

Mỗi `/join` main J: `C_J` (tạo) → `t_J` (ghi giờ) → `Rr_J` (đọc lại); thấy đóng thì `R_J` (thu hồi) → `D_J` (xóa); thấy `live` thì ký token với `nbf = t_J − 1 phút`. `/end` và vòng lặp nền: `W` (ghi `completed` có điều kiện) → `R` (thu hồi, mốc = giờ lúc đó) → `D`, lặp đến khi thành công rồi mới ghi `finalized_at`.

- **Dọn phòng (P2), khi không có lỗi:** xét `C_J` cuối cùng. `Rr_J` thấy đóng thì `D_J` sau `C_J`; thấy `live` thì `W` sau `Rr_J`, `D` của `/end` sau `W`; thấy `scheduled` rồi buổi bị hủy/`no_show` thì L3.
- **Token cấp muộn (P1):** token chỉ được ký khi `Rr_J` thấy `live`, nên `t_J < Rr_J < W ≤` mốc của mọi lần thu hồi sau `W`. Vì `nbf = t_J − 1 phút`, token bị mọi lần thu hồi đó chặn dù ký muộn bao lâu, miễn lệch đồng hồ giữa các tiến trình API dưới 1 phút.
- **Thu hồi luôn đi trước xóa** ở mọi chỗ xóa (finalize, xóa bù, vòng lặp dọn, xóa học sinh), nên lần xóa đầu tiên của buổi đã đóng luôn có một lần thu hồi khi phòng còn tồn tại, trừ khi chính lần thu hồi đó lỗi (G9).

Giả định (không cần khóa trong bộ nhớ, nên đúng với nhiều tiến trình nếu các giả định đúng):
1. Trong một yêu cầu các bước chạy tuần tự (`await`).
2. Đọc/ghi trạng thái một hàng `sessions` tuyến tính hóa được (Postgres một bản chính, PostgREST đọc bản chính).
3. `CreateRoom`/`DeleteRoom` cùng tên có thứ tự theo lúc hoàn tất trên Cloud (T12).
4. Trạng thái buổi đi một chiều; buổi đã đóng không mở lại.
5. Đồng hồ các tiến trình API lệch nhau dưới 1 phút (NTP); đồng hồ API và LiveKit lệch dưới 60 s (nếu không Cloud trả `InvalidArgument`, finalize báo còn chờ).

## 7. Từng tình huống

"Chặn" ở đây là **theo mô hình** (FakeLiveKit); cột cuối là test tương ứng trong `apps/api/tests/test_video_room.py`.

| Tình huống | Chặn truy cập (P1) | Dọn phòng (P2) | Test |
|---|---|---|---|
| Token cũ trong khoảng join tạo lại phòng sau end, trước đọc lại và xóa bù | L2 (thu hồi trước `D`) | Xóa bù | `test_end_before_join_creates_room_join_deletes_it_and_old_tokens_stay_out` |
| Join treo sau lần đọc cuối, end xong, 31 s sau mới ký token | L2 nhờ `nbf` lùi về giờ đọc | `D` của end | `test_join_stalled_after_final_read_signs_token_after_end_is_still_revoked` |
| Xóa bù chạy trước khi finalize thu hồi | L2 (xóa bù cũng thu hồi trước) | Xóa bù | `test_join_compensation_that_beats_finalize_still_revokes` |
| API chết sau `CreateRoom` | L2 | L3, bất kể `finalized_at` | `test_join_dying_after_create_leaves_room_that_is_swept` |
| `CreateRoom` hoàn tất muộn sau khi `finalized_at` đã ghi | L2 | L3 | `test_late_create_after_finalized_is_blocked_then_swept` |
| Xóa bù lỗi khi `finalized_at` đã ghi | L2 | L3 | `test_failed_compensating_delete_is_swept_after_finalized` |
| Thu hồi lỗi | Không có L2 cho đến lần thử lại; phòng vẫn bị xóa (L1) | Xóa ngay, kết quả còn chờ, `retry_pending` | `test_revoke_failure_still_deletes_room_and_stays_pending` |
| Thu hồi lỗi, phòng đã xóa, rồi phòng bị tạo lại | **Hở (G9)** theo mô hình | L3 | `test_known_gap_revoke_retried_after_room_deleted_is_not_recorded` |
| Thu hồi hết hạn khi phòng mồ côi còn, L3 kịp chạy | L2 rồi L1 | L3 | `test_sweep_within_revocation_ttl_closes_orphan_before_tokens_work_again` |
| Thu hồi hết hạn khi phòng mồ côi còn, L3 không chạy | **Hở (G2)**: cả GV và HS vào được | Chưa | `test_known_gap_revocation_expires_while_orphan_room_survives` |
| `CreateRoom` muộn sau khi học sinh và `sessions` đã xóa | L2 đến khi thu hồi hết hạn; L1 chặn sau khi L3 xóa phòng. API ngừng lâu vẫn còn G2 | L3 nhận nhãn sở hữu có chữ ký và xóa, không cần hàng DB | `test_late_create_after_student_and_sessions_deleted_is_swept` |
| Hủy hoặc `no_show` khi học sinh đã vào trước | Chỉ học sinh có token, không ai để gặp | L3 | `test_room_of_cancelled_or_no_show_session_is_swept` |
| Tablet board | Không tạo, không xóa, không token video | — | `test_board_join_never_creates_or_deletes_video_room` |
| Nhiều join/end đồng thời, có tiêm lỗi | Như các dòng trên | Như trên | `test_video_room_random.py` (400 seed) |

## 8. Kết quả kiểm thử khác với bảo đảm

**Đã có (cục bộ):** test cho thấy code làm đúng thứ tự và phục hồi đúng **theo mô hình LiveKit trong `FakeLiveKit`**: auto-create tắt; thu hồi theo (phòng, identity), còn sau khi xóa/tạo lại phòng, có hạn 660 s (có test với mô hình vĩnh viễn); thu hồi khi phòng không tồn tại thì không ghi nhận; mốc phải trong ±60 s. Đã kiểm ngược: bỏ lùi `nbf` thì 305/400 seed ngẫu nhiên đỏ, bỏ thu hồi ở xóa bù thì 17/400, bỏ tạo phòng thì 320/400; các test xác định tương ứng cũng đỏ.

**Chưa có:** bằng chứng LiveKit Cloud hành xử như mô hình. **P1 chưa được bảo đảm** và lỗi giữ trạng thái mở cho đến khi T1, T3, T5–T8 đạt trên dự án dev **và** các lỗ hở dưới đây được chấp nhận hoặc đóng lại.

**P2 là hội tụ có điều kiện, không có cận thời gian cứng:** phòng của buổi đã đóng bị xóa ở lần dọn thành công đầu tiên, nếu vòng lặp nền chạy, `ListRooms` trả đủ phòng (T11), LiveKit nhận lệnh xóa và buổi còn hàng `sessions`. Vòng lặp chạy tuần tự các việc (no_show, dọn tải lên, finalize, dọn phòng, xóa học sinh) rồi nghỉ `NO_SHOW_INTERVAL_SECONDS` (300 s), nên khoảng cách giữa hai lần dọn là 300 s cộng thời gian chạy các việc đó, kéo dài thêm khi dịch vụ chậm hoặc lỗi.

Giới hạn còn mở:

- **G1:** thu hồi chỉ có trên Cloud; LiveKit tự cài thì mất L2.
- **G2:** thu hồi hết hạn (nếu Cloud giữ ngắn) trong khi L3 không chạy được (API chết, LiveKit API lỗi) → token cũ vào phòng mồ côi. Giảm nhẹ nếu T8 cho kết quả ngắn: rút chu kỳ dọn phòng (biến cấu hình riêng).
- **G4 (đã xử lý phần logic cục bộ):** phòng tạo bởi bản mới có nhãn sở hữu được L3 dọn dù học sinh/buổi đã xóa; test có tạo muộn và thu hồi hết hạn. Phòng cũ không có nhãn, metadata bị đổi hoặc khóa/môi trường đã đổi vẫn bỏ qua (mục 10). Phòng còn chờ dọn vẫn chịu G2; không coi đây là bảo đảm P1.
- **G5:** giữa `W` và lần thu hồi thành công (lỗi, API chết lúc `/end`), người đang trong phòng vẫn ở lại đến lần thử lại; giới hạn sẵn có của quyết định 18.
- **G6:** token của buổi **đang diễn ra** vẫn dùng được trong khung giờ; không phải lỗi này.
- **G7:** giữa buổi, mọi người rời lâu hơn `departure_timeout` (đặt bằng khung giờ) thì phòng tự đóng; tải lại trang thì `/join` tạo lại.
- **G8:** LiveKit API lỗi thì không vào được video lẫn bảng (cả lần join trả 502). Đánh đổi đã chốt.
- **G9:** lần thu hồi đầu lỗi nhưng phòng vẫn bị xóa (theo yêu cầu "vẫn thử DeleteRoom"); lần thử lại gặp phòng không tồn tại. Nếu Cloud không ghi nhận thu hồi khi phòng không tồn tại (T7) thì token cũ không bị thu hồi, chỉ còn L1 chặn; phòng bị tạo lại (tạo muộn, auto-create còn bật) thì token cũ vào được.
- **G10:** giáo viên vào lúc buổi vừa bị hủy: `/join` đã tạo phòng rồi mới thấy không chuyển được `live`, trả 409 mà không xóa bù (không có token nào được cấp); L3 dọn.
- **G11:** token máy chủ LiveKit tự cấp lại cho client đang nối mang `nbf` do máy chủ đặt. Nếu được cấp ngay trước lần thu hồi trong cùng giây hoặc sau đó (khoảng ms giữa thu hồi và xóa), thu hồi không chặn token đó (T10).
- Lệch đồng hồ quá giả định 5 ở mục 6 làm lùi `nbf` không đủ.

## 9. Kế hoạch và kết quả test

### 9.1–9.2 Cục bộ (đã chạy 2026-10-20)

- `apps/api/tests/test_video_room.py`: 21 test xác định (tình huống ở mục 7; 502; token không có `room_create`; finalize thu hồi GV và HS trước khi xóa; thử lại muộn 10 phút dùng mốc giờ hiện tại; dọn chỉ phòng của buổi đã đóng, giữ phòng `live`/`scheduled` và phòng lạ, lỗi một phòng không dừng phòng khác, gọi lại được). Viết trước, đỏ trên code cũ (19/21 đỏ hoặc treo). 2 test đạt ngay: kiểm token không có `room_create` (thuộc tính đã đúng từ trước, giữ để canh) và test ghi G9 (đạt vì code cũ không thu hồi gì).
- `apps/api/tests/test_video_room_random.py`: 400 seed, mỗi seed chạy xen kẽ: GV main, HS main, thiết bị thứ hai của GV, GV board, hai `/end`, một lần dọn; tiêm một trong: không lỗi, tạo muộn, xóa lỗi, thu hồi lỗi, join chết sau khi tạo phòng. Bất biến: buổi `completed` và `finalized_at` có sau khi thử lại; với auto-create tắt không token nào vào được; với auto-create bật không token nào vào được, trừ kiểu lỗi "thu hồi lỗi" (G9); một lần dọn là hết phòng; không còn điểm danh mở. Tái hiện một seed: `run_seed(<seed>, make_settings())`.
- `FakeLiveKit` (`tests/conftest.py`): đồng hồ điều khiển được (áp cả vào SDK để `nbf` token đúng giờ giả), thu hồi có hạn hoặc vĩnh viễn, tạo phòng muộn, lỗi theo thao tác hoặc theo số lần.
- Chưa làm: thử nhiều tiến trình thật (API 2 worker + Supabase/LiveKit dev), cần migration 0004–0007 đã áp.

### 9.3 Thử trên dự án LiveKit **dev** (chạy 2026-10-20)

Kịch bản: `apps/api/scripts/livekit_dev_check.py` (ngoài code ứng dụng; chốt chặn: `--dev-url` phải trùng `LIVEKIT_URL`, từ chối khi `APP_ENV=production`; client `livekit` cài trong venv tạm). **Đã chạy trên Cloud 2026-10-20** với dự án LiveKit hiện có, do chủ dự án chỉ định làm dev và cho phép chạy T1–T14; auto-create đã tắt (T1 xác nhận), API dev đã dừng. Sửa script khi chạy thật: giới hạn thời gian kết nối (SDK tự thử lại mãi khi bị từ chối), T12/T14 chờ `ListRooms` cập nhật, thêm T3B, T7 thêm token B. `apps/api/tests/test_livekit_dev_check.py` chạy kịch bản offline trên `FakeLiveKit` để chắc nó không hỏng và đọc kết quả đúng chiều; đó **không** phải kết quả Cloud. T4, T10 làm tay (cuối file script).

Lưu ý khi chạy:
- **Dừng API dev** dùng cùng dự án LiveKit trước khi chạy: phòng `devcheck-*` có nhãn sở hữu hợp lệ mà không khớp buổi học nào, vòng lặp dọn sẽ xóa chúng giữa chừng.
- Token "cũ" trong T5–T8 được ký như `/join` (nbf lùi về lúc ký − 1 phút). Sửa 2026-10-20: bản trước ký không lùi nbf, token cùng giây với mốc thu hồi lọt qua (`nbf < mốc`) nên báo nhầm "VÀO ĐƯỢC"; test offline tái hiện được trước khi sửa (T5–T8 đỏ).

| # | Thử | Đạt khi | Kết quả |
|---|---|---|---|
| T1 | Tắt auto-create; token (không `room_create`) vào phòng chưa tạo | Bị từ chối | **Đạt.** Máy chủ trả `404 Not Found` lúc bắt tay; client không vào được (script ghi `TimeoutError` vì SDK tự thử lại) |
| T2 | `ensure` rồi vào; `ensure` lần nữa khi có người | Vào được; lần hai không ngắt ai | **Đạt.** Vào được; `ensure` lần hai không ngắt (trạng thái A = đã kết nối) |
| T3 | Xóa phòng, nối lại bằng token cũ | Bị từ chối; không phòng mới | **Không đạt.** A bị ngắt (lý do 5 = phòng bị xóa) nhưng 2 s sau token cũ (chưa thu hồi) **vào được** |
| T3B | Như T3 nhưng chỉ thử khi `ListRooms` đã hết thấy phòng | Bị từ chối; không phòng mới | **Không đạt.** Phòng hết trong danh sách sau 0,5 s; token cũ (chưa thu hồi) **vào được và phòng được tạo lại** dù auto-create đã tắt |
| T4 | Giữa buổi tắt mạng client 30 s (tay) | Nối lại được | Chưa thử (làm tay) |
| T5 | Thu hồi người đang trong phòng | Token cũ bị từ chối; token mới vào được | **Đạt.** Token cũ: `401 invalid token: revoked`; token mới vào được |
| T6 | Thu hồi identity chưa vào (phòng còn) | Không lỗi; token cũ bị từ chối | **Đạt.** Thu hồi trả ok; token B bị từ chối (`revoked`) |
| T7 | Thu hồi, xóa, tạo lại cùng tên; thu hồi khi phòng không tồn tại | Token cũ bị từ chối; ghi mã trả về khi phòng không tồn tại (quyết định G9) | **Đạt.** Token cũ A bị từ chối sau tạo lại. Thu hồi B khi phòng không tồn tại trả ok **và có hiệu lực**: token cũ B bị từ chối sau khi phòng được tạo lại (khác mô hình `FakeLiveKit`, xem dưới) |
| T8 | Token cũ ở +1, +6, +12, +30, +60 phút sau thu hồi (phòng còn) | Ghi lúc thu hồi hết hiệu lực (quyết định G2) | +1 và +6 phút: token cũ bị từ chối (`401 revoked`). +12, +30, +60 phút: bị từ chối vì **phòng không còn** (bắt tay 404), không đo được thu hồi: phòng đặt `empty_timeout` 70 phút mà tự đóng trong khoảng 6–12 phút khi không ai vào. Kết luận: thu hồi giữ ít nhất 6 phút; thời hạn thật (G2) **chưa đo được**. Cần T8b (giữ một người trong phòng) và T15 (đo giới hạn giữ phòng trống) |
| T9 | Mốc +30 s | Ghi lại (không còn cần cho B2; chỉ để biết) | Thu hồi với mốc tương lai +30 s trả ok; token ký 2 s sau đó (trước mốc) bị từ chối |
| T10 | Client nối > 10 phút, kết thúc buổi, tắt/bật mạng (tay) | Không vào lại (quyết định G11) | Chưa thử (làm tay) |
| T11 | `ListRooms` ngay sau tạo | Thấy phòng; ghi độ trễ | Thấy phòng sau 5,7 s ở lần đo đầu (các lần sau 0,5–3,3 s): `ListRooms` trễ vài giây |
| T12 | Xóa và tạo gần như cùng lúc từ hai client | Phòng còn (lệnh hoàn tất sau thắng) | **Đạt** (lần 2, sau khi script chờ `ListRooms`): phòng còn sau 3,3 s, vào được. Lần 1 báo False vì kiểm sau 0,5 s, trước khi danh sách cập nhật |
| T13 | Phòng `empty_timeout` 60 s, không ai vào | Tự đóng | **Đạt.** Sau 90 s phòng tự đóng |
| T14 | Nhãn sở hữu (G4): phòng do `ensure` tạo và phòng tạo tay không nhãn, rồi `list_livekit_rooms` | API tạo: `managed=True` (metadata qua Cloud còn nguyên byte); tạo tay: `managed=False` | **Đạt** (lần 2): phòng do API tạo `managed=True`, phòng tạo tay `managed=False`. Lần 1 cả hai `None` vì đọc danh sách trước khi phòng hiện ra |

T5–T7 không đạt thì L2 không dùng được: P1 chỉ còn L1 + L3 và phải quay lại chọn (A) hoặc (C) làm lớp bổ sung.

**Đọc kết quả Cloud (2026-10-20, chưa có T8):**
- L2 (thu hồi) hoạt động như mô hình ở T5–T7, và **tốt hơn mô hình** ở một điểm: thu hồi khi phòng không tồn tại vẫn được ghi nhận (T7, liên quan G9). Đã sửa `FakeLiveKit` theo kết quả này (2026-10-20); test G9 theo mô hình cũ giữ lại với `revoke_requires_room = True`.
- L1 (tắt auto-create, xóa phòng) **yếu hơn giả định**: chỉ chặn phòng chưa từng tồn tại (T1). Phòng đã xóa thì token cũ chưa thu hồi vào lại được và làm phòng xuất hiện lại (T3, T3B). `FakeLiveKit` đã sửa: chỉ phòng chưa từng có mới bị từ chối. Test mới ghi lỗ hở: thu hồi hết hạn thì token cũ vào lại phòng đã xóa (`test_known_gap_tokens_rejoin_deleted_room_after_revocation_expires`).
- Hệ quả: mọi đường xóa phòng phải thu hồi trước mới chặn được token cũ (B2 đã làm vậy ở kết thúc buổi và xóa bù). Sweeper xóa phòng mồ côi **không** thu hồi được (không biết identity) nên không chặn được token cũ của phòng đó (G4 mở rộng). Hướng có thể đề xuất: ghi identity GV/HS (đã ký HMAC) vào metadata phòng để sweeper thu hồi được; chưa làm, cần duyệt.
- T8: thu hồi giữ ít nhất 6 phút; phòng không ai vào tự đóng trong 6–12 phút dù đặt `empty_timeout` 70 phút (có thể Cloud giới hạn thời gian giữ phòng trống, chưa xác minh). Nếu đúng thì phòng của buổi học cũng tự đóng khi mọi người rời lâu; T3B cho thấy token hợp lệ vẫn vào lại được nên học sinh nối lại không bị chặn, nhưng cần đo (T15).
- P1 **vẫn chưa được bảo đảm**: chưa biết thời hạn thu hồi thật (G2, cần T8b), T4/T10 làm tay chưa chạy. Nhãn danh tính đã được duyệt sẽ làm sau T8b/T15.

## 10. Dọn phòng sau xóa học sinh (G4, đã code cục bộ)

Theo yêu cầu tiếp tục hoàn tất khung logic cục bộ, đã triển khai nhãn sở hữu trên phòng, không thêm dịch vụ, biến môi trường hay migration:

- `ensure_livekit_room` ghi metadata chuẩn hóa: phiên bản, nhãn ứng dụng, tên phòng, mã băm phạm vi và chữ ký HMAC-SHA256 bằng khóa LiveKit hiện có. Phạm vi gồm `APP_ENV`, URL Supabase và URL LiveKit; metadata không chứa URL nguyên văn, tên hay hồ sơ học sinh. Chữ ký này không có quyền đăng nhập và không phải JWT video.
- `list_livekit_rooms` kiểm chữ ký bằng so sánh thời gian cố định, ràng buộc đúng tên phòng và phạm vi. Metadata hỏng/quá lớn, bị sửa, sao chép sang phòng khác hoặc do môi trường/khóa khác tạo đều không được nhận. Không diễn giải metadata thành token đăng nhập hoặc log nội dung metadata.
- `sweep_livekit_rooms`: phòng không còn hàng buổi học **và** có đúng nhãn sở hữu thì xóa. Lỗi DB giữ phòng lại để thử sau; buổi đang `live`/`scheduled` vẫn được giữ dù có nhãn. Lỗi xóa một phòng không ngăn dọn phòng khác; các chu kỳ sau thử lại.
- Giới hạn: với phòng không còn buổi học, chỉ xóa được, không thu hồi được vì không giữ identity trong metadata. Thử trên Cloud (T3B) cho thấy xóa phòng **không** chặn token cũ chưa thu hồi: token đó vào lại được và làm phòng xuất hiện lại, dù auto-create tắt. Phòng tạo trước khi có nhãn vẫn bị bỏ qua. Đổi khóa LiveKit hoặc phạm vi cấu hình làm nhãn cũ không khớp: phải dọn phòng cũ thủ công sau khi xác minh chủ sở hữu; không tự nhận nhãn cũ. Các bản chạy cùng bộ cấu hình/khóa được coi là cùng môi trường.
- Test `test_video_room_ownership.py`: phòng mồ côi đúng nhãn; khác APP_ENV/Supabase/LiveKit/khóa; metadata bị đổi/hỏng/sao chép/quá lớn; DB lỗi; lỗi xóa và retry. Test end-to-end xóa học sinh rồi tạo muộn nằm trong `test_video_room.py`.
- Bổ sung xóa bù ngay khi giáo viên thua cập nhật có điều kiện `scheduled → live` (buổi đã hủy/đóng); trước đây nhánh 409 sớm này chờ sweeper. Tablet board vẫn không tạo/xóa phòng video.
- Cách khác (không khuyên dùng): khi xóa học sinh, chờ một khoảng cố định sau khi đóng phòng rồi mới xóa hàng `sessions`. Không chặn được `CreateRoom` hoàn tất muộn hơn khoảng chờ.

## 11. Lộ trình triển khai

1. ~~Thiết kế~~. ~~Code tương thích + test cục bộ~~ (2026-10-20, chưa commit).
2. **Dev:** tạo **dự án LiveKit riêng cho dev**, tắt auto-create ở đó, dừng API dev, chạy `scripts/livekit_dev_check.py` T1–T14, rồi toàn luồng web với API dev (`acceptance.md` mục 2). Ghi kết quả vào bảng 9.3.
3. **Trước production:** kiểm dự án LiveKit production có ứng dụng/môi trường khác dùng chung không (phòng không theo mẫu `room-<32 hex>` trong bảng điều khiển hoặc `ListRooms`, hỏi người quản lý). Có dùng chung mà bên kia cần tự tạo phòng thì **tách dự án LiveKit riêng** thay vì tắt công tắc. Triển khai B2 lên production với auto-create **còn bật**, theo dõi log 502 và log dọn phòng.
4. **Production:** tắt auto-create, ghi ngày giờ, thử ngay một buổi giả.
5. **Quay lui:** bật lại auto-create trước, sau đó mới gỡ code B2 nếu cần. Không bao giờ để auto-create tắt với bản code không tự tạo phòng.

Chủ dự án chưa duyệt bước 3–4.

## 12. Phục hồi thủ công

- Phòng nghi bị bỏ sót: bảng điều khiển LiveKit Cloud → Rooms, hoặc `lk room list` / `lk room delete <tên>`; tên phòng lấy từ `sessions.room_name`. Hoặc chờ một chu kỳ L3.
- `/join` trả 502 hàng loạt: kiểm trạng thái LiveKit Cloud và `python -m app.preflight`. Bật lại auto-create **không** giúp vì `/join` vẫn gọi `CreateRoom`; phải chờ LiveKit hoặc quay lui code.
- `finalize` kẹt vì thu hồi lỗi (log "Không đóng được phòng video"): giáo viên bấm "Thử lại ngay"; lỗi `InvalidArgument` do mốc lệch đồng hồ thì kiểm NTP máy chạy API.

## 13. Các phương án đã cân nhắc

| | (A) Webhook đá người vào phòng đã đóng | (C) Token video ngắn hạn | Chỉ thu hồi, giữ auto-create |
|---|---|---|---|
| Chặn token cũ | Người đó đã vào được vài giây; webhook không bảo đảm tới | Không hết: token máy chủ cấp lại sống ≥ 10 phút | Chỉ trong thời gian Cloud giữ thu hồi (chưa biết) |
| Phụ thuộc | API cần URL HTTPS công khai | Web phải gọi lại `/join` | Không |
| Vai trò | Lớp bổ sung nếu T5–T7 không đạt hoặc dùng LiveKit tự cài | Lớp bổ sung cho G1 | Chính là L2; không đủ một mình |

## 14. Việc chủ dự án làm

1. Xem lại code và test cục bộ (chưa commit).
2. Tạo hoặc chỉ định **dự án LiveKit dev riêng**, tắt auto-create ở đó, cho phép chạy T1–T14 (script mục 9.3).
3. G4 đã có logic dọn cục bộ (mục 10); kiểm metadata trên LiveKit dev và quyết định G9 sau khi có kết quả T7.
4. Kiểm dự án LiveKit production có dùng chung không trước khi tắt công tắc production.

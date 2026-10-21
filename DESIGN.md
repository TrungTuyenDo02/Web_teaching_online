# DESIGN.md — Pastel Retro-OS / Kawaii Desktop UI

> File này là nguồn sự thật về giao diện. Claude Code hãy đọc toàn bộ trước khi viết bất kỳ component, trang hay CSS nào. Mọi giá trị màu, spacing, bóng đổ phải lấy từ design tokens ở mục 3, không hard-code.

---

## 1. Tổng quan phong cách

Giao diện mô phỏng **hệ điều hành cổ điển (Windows 95/98, Mac OS 9) được "làm dễ thương"**: mọi thứ là cửa sổ (window) nổi trên nền giấy kẻ ô, màu pastel tím-hồng-mint, viền đậm, icon nét mảnh, trang trí bằng sparkle, mây, trăng, ngôi sao.

**Cảm giác cần đạt:** mơ mộng, nhẹ nhàng, hoài niệm, nghệ thuật, vui mắt nhưng vẫn dùng được (không phá vỡ khả năng đọc và thao tác).

### Từ khóa liên quan (dùng để tìm thêm tham khảo, đặt tên class, chọn asset)

| Nhóm | Từ khóa |
|---|---|
| Phong cách chính | Y2K aesthetic, retro OS UI, retro desktop UI, vintage computer UI, Windows 95 pastel, Mac OS 9 kawaii, webcore, neocities aesthetic, old web aesthetic |
| Cảm xúc / mood | kawaii, cutecore, softcore, dreamcore, soft girl, pastel goth (nhẹ), lo-fi, nostalgia, whimsical, cozy tech |
| Màu sắc | pastel purple, lavender, lilac, baby pink, mint green, peach, cream, periwinkle, holographic pastel |
| Họa tiết | graph paper grid, notebook grid, grid background, sparkle, twinkle star, 4-point star, starburst, cloud, moon phases, constellation |
| Thành phần UI | pixel window, title bar, window controls, folder icon, pixel cursor, hourglass cursor, loading bar, error popup, dialog box, media player |
| Kỹ thuật vẽ | thick outline, flat vector, hard offset shadow, sticker style, line art icon, isometric floating windows |
| Tìm trên Pinterest / Dribbble / Behance | "retro UI kit pastel", "y2k desktop illustration", "kawaii operating system", "aesthetic window popup", "cute error window", "pastel loading bar" |
| Font | pixel font, retro serif, Silkscreen, VT323, Press Start 2P, DM Serif Display, Playfair Display, Space Mono |

---

## 2. Nguyên tắc thiết kế

1. **Mọi thứ là cửa sổ.** Card, modal, sidebar, form đều là `Window` có title bar, nút điều khiển và viền đậm.
2. **Viền đậm, bóng cứng.** Viền 2px màu tím-navy đậm, bóng đổ kiểu offset không blur (đổ lệch, không mờ) cho cảm giác sticker.
3. **Pastel nhưng tương phản đủ đọc.** Nền nhạt, chữ và viền luôn đậm.
4. **Nền giấy kẻ ô** xuất hiện xuyên suốt, tạo cảm giác sổ tay.
5. **Trang trí có chừng mực.** Sparkle, mây, trăng chỉ đặt ở rìa và góc, không đè lên nội dung chính hay vùng nhập liệu.
6. **Chi tiết nhỏ, chơi chữ nhỏ.** Dùng microcopy dễ thương (xem mục 8).
7. **Dùng được trước, đẹp sau.** Không hy sinh responsive, a11y và hiệu năng để lấy hiệu ứng.

---

## 3. Design tokens

Nguồn chuẩn là `apps/web/src/styles/tokens.css`; khối dưới đây là bản gốc của bảng màu. Khi hai nơi khác nhau, `tokens.css` đúng. Bản triển khai thêm các token: `--danger-ink`/`--success-ink`/`--warning-ink` và nền `-100` (chữ trạng thái đạt 4,5:1), `--text-xs` (0,75rem, chỉ nhãn ASCII trang trí), `--text-2xl` (2rem), `--fw-bold` 700 / `--fw-heavy` 800 / `--fw-black` 900, `--shadow-hard-hover`, `--shadow-danger`, `--touch` 44px, `--overlay`, lớp `--z-*`. Không viết số độ đậm, cỡ chữ, bóng trực tiếp trong CSS.

**Ngoại lệ có chủ đích:** khoảng cách dưới 4px trong chi tiết pixel (chấm title bar 6px, ô thanh tải 3px, đệm dọc badge 2px), hình tròn `border-radius: 50%`, kích thước chữ trong SVG theo đơn vị viewBox, thời gian của hiệu ứng trang trí (nhấp nháy, thanh tải). Breakpoint chỉ dùng `640px` và `1024px` (`1023px` là phía `max-width` của 1024); `max-height` 540/580px chỉ cho linh vật trên màn thấp.

```css
:root {
  /* --- Màu nền --- */
  --bg-paper:        #FFF8FC;   /* nền giấy */
  --bg-grid-line:    #F4DCEB;   /* đường kẻ ô */
  --bg-window:       #FFFFFF;
  --bg-window-soft:  #F6EEFA;   /* thân cửa sổ dạng kính mờ */

  /* --- Màu thương hiệu (pastel) --- */
  --lavender-100:    #F1E8FA;
  --lavender-300:    #D8C6F0;
  --lavender-500:    #B79BE0;   /* title bar tím */
  --lilac-700:       #8A6BB8;   /* viền tím nhạt (kiểu ảnh 1) */
  --pink-200:        #FBD3E6;
  --pink-400:        #F6A6CB;   /* title bar hồng (kiểu ảnh 2) */
  --peach-300:       #F9D7A0;   /* title bar cam, folder */
  --peach-500:       #F2B866;
  --mint-200:        #CFF1DE;
  --mint-400:        #98E0BC;   /* vùng "bể kính" xanh mint */
  --periwinkle-400:  #9AA8EE;   /* nút, thanh trượt, title bar xanh */
  --cream-100:       #FFF4E0;

  /* --- Màu viền & chữ --- */
  --ink-900:         #2A2760;   /* navy tím đậm: viền + chữ chính */
  --ink-700:         #4A4690;
  --ink-500:         #7A76B8;   /* chữ phụ */
  --danger:          #E86A92;   /* error, hồng đậm */
  --success:         #5CC79A;
  --warning:         #F2B866;

  /* --- Viền & bo góc --- */
  --border-w:        2px;
  --border:          var(--border-w) solid var(--ink-900);
  --radius-sm:       4px;
  --radius-md:       8px;
  --radius-pill:     999px;

  /* --- Bóng cứng (hard shadow) --- */
  --shadow-hard-sm:  3px 3px 0 var(--ink-900);
  --shadow-hard-md:  6px 6px 0 var(--ink-900);
  --shadow-soft:     0 10px 30px rgba(138, 107, 184, 0.25);

  /* --- Spacing (thang 4px) --- */
  --sp-1: 4px;  --sp-2: 8px;  --sp-3: 12px;
  --sp-4: 16px; --sp-6: 24px; --sp-8: 32px; --sp-12: 48px;

  /* --- Typography --- */
  /* Triển khai: chỉ Nunito được đóng gói (@fontsource-variable/nunito), không tải font ngoài.
     Font pixel không có dấu tiếng Việt: chỉ cho nhãn ASCII (tên tệp trên title bar),
     không tải Silkscreen nên hiển thị bằng font mono của máy. Tiêu đề dùng Nunito 900. */
  --font-pixel:   "Silkscreen", "VT323", monospace;          /* chỉ nhãn ASCII trang trí */
  --font-body:    "Nunito", "Quicksand", system-ui, sans-serif;  /* mọi chữ có dấu */
  --font-mono:    "Space Mono", monospace;                    /* code */

  /* --- Motion --- */
  --ease-bounce: cubic-bezier(.34, 1.56, .64, 1);
  --dur-fast: 120ms;
  --dur-base: 220ms;
}
```

### Quy tắc dùng màu
- Mỗi cửa sổ chọn **một** màu title bar (lavender / pink / peach / periwinkle). Không trộn nhiều màu trong một title bar.
- Nút chính (CTA): `--periwinkle-400` (chữ 5,9:1). Không dùng `--pink-400` làm nền chữ (chỉ 4,3:1); title bar hồng dùng `--pink-200`. Nút phụ: nền trắng.
- Chữ chính luôn `--ink-900` trên nền sáng. Không dùng chữ pastel trên nền pastel cho nội dung quan trọng.
- Vùng nhấn "bể kính mint" (`--mint-400`) dùng cho hero / vùng minh họa, không dùng làm nền cả trang.

---

## 4. Nền trang (graph paper)

```css
body {
  background-color: var(--bg-paper);
  background-image:
    linear-gradient(var(--bg-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--bg-grid-line) 1px, transparent 1px);
  background-size: 32px 32px;
  color: var(--ink-900);
  font-family: var(--font-body);
}
```

Tùy chọn: thêm lớp gradient mờ tím-hồng phía trên (`radial-gradient`) và một vài sparkle SVG tĩnh ở góc.

---

## 5. Component cốt lõi

### 5.1 Window (component quan trọng nhất)
Cấu trúc: `Window` > `TitleBar` (ba chấm trang trí `aria-hidden`, tiêu đề là heading h1–h3, tên tệp ASCII, nút thật qua `actions`) + `Body`. **Triển khai không có nút `_ ▢ ✕` giả**: nút nào hiện ra cũng phải hoạt động và ≥ 44px; tiêu đề viết thường bằng Nunito (không in hoa, không font pixel) để giữ dấu tiếng Việt. Khối CSS dưới đây là ý tưởng gốc.

```css
.window {
  background: var(--bg-window);
  border: var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-hard-md);
  overflow: hidden;
}
.window__titlebar {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--sp-2) var(--sp-3);
  background: var(--lavender-500);          /* đổi theo variant */
  border-bottom: var(--border);
  font-family: var(--font-pixel);
  font-size: 12px; letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-900);
}
.window__controls { display: flex; gap: var(--sp-1); }
.window__controls button {
  width: 18px; height: 18px; padding: 0;
  background: var(--bg-window); border: var(--border);
  font: 10px/1 var(--font-pixel);
}
.window__body { padding: var(--sp-4); }
```

Variants: `--lavender`, `--pink`, `--peach`, `--periwinkle`, `--glass` (nền `--bg-window-soft`, viền `--lilac-700`, bóng `--shadow-soft`, giống ảnh 1).

Nút `✕` hover: nền `--danger`. Nút `_` / `▢` chỉ trang trí nếu chưa có chức năng, phải có `aria-hidden` hoặc `aria-label` rõ ràng.

### 5.2 Button
- `Button` (hành động) và `ButtonLink` (điều hướng trong ứng dụng, mở được tab mới). Không viết tay `<button className="btn">` hay `<a href>` cho route nội bộ (tải lại cả trang); `<a className="btn">` chỉ cho neo trong trang hoặc link bỏ qua.
- Biến thể: `secondary` (mặc định, nền trắng), `primary` (periwinkle), `accent` (mint), `danger` (chữ/viền `--danger-ink`, bóng `--shadow-danger`), `ghost` (gạch chân, không viền). Cỡ: `sm`, `md`, `lg`; mọi cỡ cao ≥ 44px. `block` để rộng hết hàng.
- Chữ Nunito `--fw-heavy`. Hover: `translate(-1px,-1px)` + `--shadow-hard-hover`; active: `translate(3px,3px)`, bóng về 0; tắt trên thiết bị cảm ứng và khi giảm chuyển động.
- Focus: outline 3px `--ink-900` lệch 2px (trên nền tối đổi `--bg-window`).
- Disabled: nền `--lavender-100`, chữ `--ink-700` (không dùng `--ink-500`: chữ nhỏ dưới 4,5:1), viền `--ink-500`, không bóng.
- `busy` + `busyLabel`: khóa nút, đổi chữ, `aria-busy`, giữ nguyên kích thước.

### 5.3 Input / Form (kiểu "LOGIN")
- Mọi ô nhập đi qua `Field` (`label`, `hint`, `error`, `required`): nhãn gắn `htmlFor`, gợi ý và lỗi qua `aria-describedby`, lỗi có `role="alert"` và `aria-invalid`, ô bắt buộc có `*` kèm chữ ẩn "(bắt buộc)".
- Input nền trắng, viền `--border`, bo `--radius-sm`, cao ≥ 44px, focus: outline 3px `--ink-900`, lệch ra 2px (giữ viền tối). Lỗi: viền và nền `--danger-ink`/`--danger-100`.
- Nhãn: Nunito `--text-sm` `--fw-heavy`, viết thường (font pixel không có dấu tiếng Việt).
- Ô tích dùng `Check`: ô 24px trong dòng cao 44px, nhãn bao ngoài nên bấm cả chữ được, `accent-color: --lilac-700`. Không viết tay `<label className="check">`.
- Form đăng nhập đặt trong `Window` variant peach hoặc pink.

### 5.4 Progress / Loading bar
- Triển khai (`Loading` trong `ui/Feedback.tsx`): khung viền đậm, sáu ô vuông lấp lần lượt, kèm chữ trạng thái, `role="status"`; tắt chuyển động khi giảm chuyển động. Chưa có tiến độ thật, nút `CANCEL` hay đồng hồ cát (không cần ở giai đoạn 1).
- `Empty`: biểu tượng ✦ `aria-hidden`, câu ngắn và hành động tiếp theo. `ErrorState`: `Alert` lỗi kèm nút "Thử lại".

### 5.5 Slider (âm lượng, tiến trình) — chưa dùng
- Track bo tròn viền đậm, nền `--lavender-300`, phần fill `--periwinkle-400`, thumb tròn trắng viền đậm. Icon loa ở đầu trái.

### 5.6 Icon & file — chưa dùng (chỉ tên tệp ASCII trên title bar)
- **Folder, file, media, dấu ✕ trong vòng tròn:** nét mảnh viền đậm, fill pastel phẳng (peach cho folder, trắng cho file).
- Dưới icon luôn có nhãn nhỏ, font mono hoặc pixel (`folder 1`, `media 1`).
- **Cursor:** mũi tên pixel, tay trỏ, hourglass. Có thể thay con trỏ chuột toàn site bằng cursor tùy chỉnh (cần fallback `auto`).

### 5.7 Dialog / Error popup
- Triển khai: `Dialog` dùng `<dialog>` gốc (`showModal`: giữ focus bên trong, Esc đóng, trả focus về nút mở), một nút "Đóng" thật trên title bar, không đóng khi đang gửi. `ConfirmDialog` cho thao tác hậu quả lớn: biến thể `danger`, tùy chọn bắt tích xác nhận, lỗi `role="alert"`. Trang 404 và lỗi phòng dùng `Window` variant `danger` với h1.
- Window nhỏ, title bar `--danger-100` hoặc pink, icon cảnh báo, 1–2 nút. Nội dung thân thiện, không đổ lỗi người dùng.
- Hiệu ứng glitch nhẹ (dịch pixel 1–2px, màu cyan/pink) chỉ dùng cho **trang lỗi** hoặc **hover**, không dùng thường trực.

### 5.8 Media player — chưa dùng (video do LiveKit vẽ)
- Window tím nhạt, có icon loa, thanh trượt, nút ▶ ⏭, nền mây. Dùng cho trình phát nhạc hoặc video/lesson.

### 5.9 Profile / Artist card (kiểu `cherrionse.png`) — chưa dùng
- Window có tên file làm tiêu đề (`name.exe`, `avatar.png`), ảnh đại diện tròn, dòng "17 YEARS OLD", nhãn vai trò trong ngoặc kép, nút `FOLLOW`.

### 5.10 Trang trí (Decor)
Component `Decor` nhận `type`. Đã có: `sparkle | star4 | cloud | moon`; chưa làm: `starburst | flower | constellation | dots`.
- Chỉ dùng SVG, `pointer-events: none`, `aria-hidden="true"`.
- Mây: trắng kem viền nhẹ, đặt chồng lên mép cửa sổ.
- Chuỗi **pha mặt trăng** dọc theo mép trang làm điểm nhấn.
- Starburst cam/pink phía sau window làm "sticker".
- Hoa, nho, dây leo nhỏ ở góc folder để thêm sự mơ mộng.

### 5.11 Badge và thông báo
- `Badge` (`tone`: `scheduled`, `live`, `done`, `warn`, `danger`): nhãn nhỏ luôn có chữ, màu chỉ là phụ. `SessionStatus` dựng trên `Badge`. Không viết tay `<span className="badge">`.
- `Alert` (`tone`: `info`, `success`, `warning`, `error`): biểu tượng + chữ, lỗi `role="alert"`, còn lại `role="status"`; có thể kèm nút hành động. Toast (`useToast`): tối đa 3, lỗi giữ đến khi đóng, còn lại tự ẩn sau 6 giây, nút "Đóng".

### 5.12 Segmented
- `Segmented` (`label`, `options`, `value`, `onChange`, `disabled`): nhóm nút chọn một, `role="group"` có tên, mỗi nút `aria-pressed`, cao ≥ 44px, focus vẽ vào trong. `ariaLabel` của lựa chọn phải bắt đầu bằng chữ đang hiện (WCAG 2.5.3, ví dụ "VI – Tiếng Việt"). Dùng cho chọn ngôn ngữ, bộ lọc, chế độ linh vật.

---

## 6. Layout & bố cục

- **Đầu trang:** `PageHeader` (`title` là h1 duy nhất của trang, `lead`, `actions`); tiêu đề tab đặt qua `AppShell title` hoặc `usePageTitle`.
- **Desktop:** các Window sắp chồng lệch nhau (isometric / floating), có thể kéo thả (tùy chọn). Giữ trục đọc rõ ràng, nội dung chính ở window lớn nhất ở giữa.
- **Mobile:** xếp dọc, mỗi section là một Window full-width (trừ gutter 16px), bỏ chồng lệch, giảm decor.
- Breakpoint: chỉ `640px` và `1024px`.
- Bóng cứng giảm xuống `--shadow-hard-sm` trên mobile.
- Thanh điều hướng = **taskbar** (cố định trên): tên ứng dụng, link theo vai trò (`aria-current`), chọn ngôn ngữ, tài khoản. Dưới 640px link thành dải cuộn ngang có bóng mờ ở mép khi còn mục bị khuất. Chưa có nút `Start` hay đồng hồ.

---

## 7. Motion

- Window xuất hiện: scale 0.96 → 1 + fade, `--dur-base`, `--ease-bounce`.
- Hover nút: nhún nhẹ. Sparkle: nhấp nháy chậm (opacity 0.4 ↔ 1, 2–4s).
- Mây: trôi ngang rất chậm (30–60s), chỉ trên desktop.
- **Bắt buộc** hỗ trợ `@media (prefers-reduced-motion: reduce)`: tắt trôi, nhấp nháy và glitch.

---

## 8. Giọng điệu & microcopy

- Tên file làm tiêu đề: `welcome.exe`, `settings.png`, `my_notes.txt`.
- Trạng thái: "Loading…", "Almost there ✦", "Oops, something wilted" (lỗi), "blossom or wither" (chọn 2 hướng).
- Nút: `OK`, `CANCEL`, `bloom`, `wilt`, `FOLLOW`. Giữ ngắn, viết thường hoặc in hoa nhất quán theo từng loại component.
- Nếu app dùng tiếng Việt: dịch tự nhiên, giữ chất dễ thương, không quá dài dòng. Font pixel cần hỗ trợ dấu tiếng Việt; nếu không, dùng `--font-body` cho chữ có dấu.

---

## 9. Accessibility (không thương lượng)

- Tương phản chữ/nền ≥ 4.5:1 (chữ `--ink-900` trên nền sáng đã đạt).
- Mọi tương tác dùng được bằng bàn phím; focus ring rõ ràng: outline 3px `--ink-900` lệch 2px, trên nền tối đổi sang `--bg-window` (pastel nhạt không đạt 3:1).
- Nút điều khiển window có `aria-label` ("Đóng", "Thu nhỏ", "Phóng to").
- Decor: `aria-hidden`. Ảnh nội dung có `alt`.
- Touch target ≥ 40×40px trên mobile.
- Không truyền đạt thông tin chỉ bằng màu.
- Font pixel chỉ dùng cho nhãn ngắn; đoạn văn dài dùng `--font-body`, cỡ ≥ 16px.

---

## 10. Hướng dẫn kỹ thuật cho Claude Code

1. **Đọc file này trước.** Nếu dự án đã có framework/UI lib, giữ nguyên stack, chỉ áp tokens và component theo file này.
2. Tạo theo thứ tự: `tokens.css` → global styles (nền grid, font) → `Window` → `Button` → `Input` → `Decor` → các component còn lại → trang.
3. Mỗi component nằm riêng file, nhận props rõ ràng (`variant`, `title`, `onClose`...), dùng CSS variables, không hard-code màu.
4. Font: chỉ Nunito qua `@fontsource-variable/nunito`, đóng gói vào bản build. Không tải từ Google Fonts hay CDN (học sinh vị thành niên, mạng yếu); không dùng Georgia/serif cho chữ có dấu.
5. Icon/decor: ưu tiên SVG inline hoặc sprite, tối ưu kích thước; không dùng ảnh raster nặng.
6. Không copy nguyên bất kỳ minh họa, nhân vật, tên hay logo từ ảnh tham khảo. Chỉ lấy **phong cách, bảng màu và cấu trúc**; vẽ asset gốc riêng.
7. Hiệu năng: giới hạn số phần tử decor động, dùng `transform`/`opacity` cho animation, lazy-load asset ngoài màn hình đầu.
8. Viết code sạch, có chú thích ngắn cho các token và biến thể.

---

## 11. Checklist trước khi coi là xong

- [ ] Nền giấy kẻ ô hiển thị đúng, không lệch trên mobile.
- [ ] Mọi card/modal/form đều là `Window` có title bar; không có nút điều khiển giả.
- [ ] Không có màu, độ đậm, cỡ chữ, bóng hard-code ngoài tokens (trừ ngoại lệ ở mục 3).
- [ ] Dùng component sẵn có (`Button`/`ButtonLink`, `Field`, `Check`, `Badge`, `Segmented`, `PageHeader`) thay vì viết tay class.
- [ ] Hover/active/focus/disabled có đủ cho nút và input.
- [ ] Hoạt động tốt ở 360px, 768px, 1280px.
- [ ] `prefers-reduced-motion` hoạt động.
- [ ] Kiểm tra tương phản và điều hướng bằng bàn phím.
- [ ] Decor không che nội dung hay chặn click.
- [ ] Trang lỗi/404 dùng popup `ERROR` dễ thương.

---

## 12. Prompt khởi động gợi ý (dán vào Claude Code)

```
Đọc DESIGN.md ở thư mục gốc. Hãy:
1. Tạo tokens.css và global styles (nền graph paper, font).
2. Xây component Window (variants lavender/pink/peach/periwinkle/glass), Button, Input, ProgressBar, Slider, Decor.
3. Dựng trang [TÊN TRANG] bằng các component trên, theo đúng mục 5–9.
4. Chạy kiểm tra responsive và accessibility theo mục 11, rồi báo cáo mục nào chưa đạt.
```

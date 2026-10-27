/**
 * UI-01 (khổ màn hình, vùng chạm) và UI-02 (bàn phím, hộp thoại, nhãn): kiểm hành vi thực tế trong Chromium.
 * Không thay cho thử trên tablet/điện thoại thật (bút, tì tay, bàn phím ảo): xem docs/acceptance.md mục 4.
 */
import { expect, test } from "../fixtures/test";
import type { Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "điện thoại 360", width: 360, height: 740 },
  { name: "tablet dọc", width: 768, height: 1024 },
  { name: "tablet ngang", width: 1024, height: 768 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "điện thoại ngang", width: 740, height: 360 },
];

const PAGES: { role: "teacher" | "student"; path: string; ready: string }[] = [
  { role: "teacher", path: "/", ready: "Buổi học tiếp theo" },
  { role: "teacher", path: "/students", ready: "Danh sách học sinh" },
  { role: "teacher", path: "/history", ready: "Lịch sử buổi học" },
  { role: "teacher", path: "/reports", ready: "Báo cáo tháng" },
  { role: "teacher", path: "/teaching-notes", ready: "Ghi chú riêng" },
  { role: "teacher", path: "/assignments", ready: "Bài đã giao" },
  { role: "teacher", path: "/room/u1?mode=main", ready: "Phòng học" },
  { role: "teacher", path: "/room/u1?mode=board", ready: "Bảng viết (tablet)" },
  { role: "teacher", path: "/students/s1", ready: "profile.txt" },
  { role: "teacher", path: "/assistant-materials", ready: "Kho bài giảng" },
  { role: "student", path: "/", ready: "Chào Nguyễn Lan Anh" },
  { role: "student", path: "/history", ready: "Lịch sử buổi học" },
  { role: "student", path: "/room/u1?mode=main", ready: "em xem bảng của thầy cô" },
];

/** Phần tử bấm được của ứng dụng nhỏ hơn 44 px (bỏ qua Excalidraw, LiveKit, dải xem trước chỉ có ở dev, liên kết trong câu). */
async function smallTargets(page: Page) {
  // Cửa sổ mở có hiệu ứng scale(0.96) → 1: đo sau khi các hiệu ứng hữu hạn kết thúc, không đo giữa chừng
  await page.evaluate(() =>
    Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)),
  );
  return page.evaluate(() => {
    const selector = "button, a.btn, summary, [role=button], .segmented button, label.check";
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => !el.closest(".excalidraw, [data-lk-theme], .preview-banner"))
      .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden")
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ box }) => box.height < 44 || box.width < 44)
      .map(({ el, box }) => `${el.tagName.toLowerCase()} "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 40)}" ${Math.round(box.width)}x${Math.round(box.height)}`);
  });
}

for (const vp of VIEWPORTS) {
  test(`UI-01 ${vp.name}: không tràn ngang, nút ứng dụng ≥ 44 px${vp.width === 360 ? " @smoke" : ""}`, async ({ page, openPreview }) => {
    test.slow(); // duyệt 8 trang trong một test; khi cả bộ chạy song song có thể quá 45 giây dù trang đúng
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const problems: string[] = [];
    for (const { role, path, ready } of PAGES) {
      await openPreview(page, role, path);
      await expect(page.getByText(ready).first()).toBeVisible();
      await expect(page.getByText(/^Đang (tải|vào)/)).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`${role} ${path}: tràn ngang ${overflow}px`);
      for (const small of await smallTargets(page)) problems.push(`${role} ${path}: ${small}`);
    }
    expect(problems).toEqual([]);
  });

  // Tách khỏi test trên để mỗi test ngắn (một test duyệt quá nhiều trang dễ chạm giới hạn thời gian)
  test(`UI-01 ${vp.name}: trang giới thiệu và giao diện tiếng Anh không tràn, nút ≥ 44 px${vp.width === 360 ? " @smoke" : ""}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto("/");
    const problems: string[] = [];
    // Trang giới thiệu (khách) và trang chính giáo viên bằng tiếng Anh: chữ dài hơn, dễ tràn hơn
    for (const [lang, path, ready] of [
      ["vi", "/?preview=off", "Học cùng thầy cô, như ngồi cạnh nhau"],
      ["en", "/?preview=off", "Learn with your teacher, as if side by side"],
      ["en", "/?preview=teacher", "Next lesson"],
    ] as const) {
      await page.evaluate((l) => localStorage.setItem("lang", l), lang);
      await page.goto(path);
      await expect(page.getByText(ready).first()).toBeVisible();
      await expect(page.getByText(/^(Đang tải|Loading)/)).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) problems.push(`${lang} ${path}: tràn ngang ${overflow}px`);
      for (const small of await smallTargets(page)) problems.push(`${lang} ${path}: ${small}`);
    }
    expect(problems).toEqual([]);
  });
}

test("UI-01 trang đăng nhập ở điện thoại 360: không tràn, ô và nút đủ lớn @smoke", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  expect(await smallTargets(page)).toEqual([]);
  for (const label of ["Email", "Mật khẩu"]) {
    expect((await page.getByLabel(label).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test("UI-01 ô nhập nhận viền focus đậm khi Tab tới (WCAG 2.4.7)", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/reports");
  const month = page.getByLabel("Tháng báo cáo");
  for (let i = 0; i < 30 && !(await month.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(month).toBeFocused();
  expect(await month.evaluate((el) => { const cs = getComputedStyle(el); return `${cs.outlineStyle} ${cs.outlineColor}`; })).toBe("solid rgb(42, 39, 96)");
});

test("UI-02 trình đọc màn hình: tiêu đề tab theo trang, focus về nội dung khi chuyển trang, lỗi trường và số dòng được báo @smoke", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/students");
  await expect(page).toHaveTitle(/^Học sinh · /);
  // Tìm/lọc: báo gọn số dòng, không đọc lại cả danh sách
  await expect(page.locator(".items[aria-live]")).toHaveCount(0);
  await page.getByLabel("Tìm theo tên hoặc lớp").fill("Lan Anh");
  await expect(page.getByRole("status").filter({ hasText: "Đang hiện 1 học sinh" })).toBeAttached();
  // Lỗi tại trường là alert: được đọc ngay khi bấm lưu
  await page.getByRole("button", { name: "Thêm học sinh" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Thêm học sinh" });
  await dialog.getByRole("button", { name: "Thêm học sinh" }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "Hãy nhập họ tên học sinh." })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Buổi đã học" }).click();
  await expect(page).toHaveTitle(/^Buổi đã học · /);
  await expect(page.locator("#main")).toBeFocused();
  await page.goto("/khong-co-trang");
  await expect(page).toHaveTitle(/^Không tìm thấy trang · /);
  await expect(page.getByRole("heading", { level: 1, name: "Không tìm thấy trang" })).toBeVisible();
});

test("UI-02 hộp thoại bằng bàn phím: mở bằng Enter, focus ở trong, Tab không thoát, Esc đóng và trả focus @smoke", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/students");
  const opener = page.getByRole("button", { name: "Thêm học sinh" }).first();
  await opener.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Thêm học sinh" });
  await expect(dialog).toBeVisible();
  const insideDialog = () => page.evaluate(() => Boolean(document.activeElement?.closest("dialog[open]")));
  expect(await insideDialog()).toBe(true);
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press(i % 4 === 3 ? "Shift+Tab" : "Tab");
    expect(await insideDialog(), `Tab lần ${i + 1} làm focus rời hộp thoại`).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("UI-02 thao tác ẩn trong 'Thao tác khác' mở được bằng bàn phím; ô có nhãn", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/students");
  const row = page.getByRole("listitem").filter({ hasText: "Trần Đức Minh" });
  const more = row.getByText("Thao tác khác");
  await more.focus();
  await page.keyboard.press("Enter");
  await expect(row.getByRole("button", { name: "Ngừng dạy" })).toBeVisible();
  await expect(page.getByLabel("Tìm theo tên hoặc lớp")).toHaveAttribute("type", "search");
});

test("UI-03 phòng học trên điện thoại: bảng chiếm phần lớn màn hình, xoay ngang thì video thành cột bên phải", async ({ page, openPreview }) => {
  const box = async (selector: string) => (await page.locator(selector).first().boundingBox())!;
  await page.setViewportSize({ width: 390, height: 844 });
  await openPreview(page, "student", "/room/u1?mode=main");
  await expect(page.getByText("em xem bảng của thầy cô")).toBeVisible();
  const [board, video] = [await box(".board"), await box(".room__video")];
  expect(board.height).toBeGreaterThan(video.height * 2.5); // dải video thấp, nhường chỗ cho bảng
  await page.setViewportSize({ width: 740, height: 360 });
  await expect.poll(async () => (await box(".room__video")).x).toBeGreaterThan((await box(".board")).x + 100);
  expect((await box(".board")).height).toBeGreaterThan(200);
});

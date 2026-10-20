/**
 * LAND-01 (trang giới thiệu cho khách) và I18N-01 (hai ngôn ngữ). Supabase/API giả ở ranh giới mạng.
 * Đủ bản dịch cho mọi chuỗi trong code: services/whiteboard-sync/test/web-i18n.test.ts (quét mã nguồn).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";
import { TEACHER } from "../fixtures/fake-backend";

const VIETNAMESE = /[À-ỹđĐ]/u;

/** Chữ hiển thị còn dấu tiếng Việt (bỏ tên thương hiệu và tên ngôn ngữ, vốn giữ nguyên). */
async function vietnameseLeftovers(page: Page) {
  const text = await page.locator("body").innerText();
  return text
    .split("\n")
    .map((line) => line.replaceAll("Gia sư online", "").trim())
    .filter((line) => VIETNAMESE.test(line));
}

test("LAND-01 khách mở / thấy trang giới thiệu, không tải dữ liệu riêng; nút đăng nhập dẫn tới /login @smoke", async ({ page, fake }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Học cùng thầy cô, như ngồi cạnh nhau" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Riêng tư cho học sinh" })).toBeVisible();
  await expect(page.getByText("Không ghi hình buổi học.")).toBeVisible();
  expect(fake.calls.filter((c) => c.includes("/rest/v1/") || c.includes("/api/"))).toEqual([]);

  await page.getByRole("link", { name: "Đăng nhập để vào lớp" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
  await page.getByRole("link", { name: /Giới thiệu/ }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("I18N-01 đổi sang tiếng Anh: hết chữ tiếng Việt, nhớ sau khi tải lại, đổi lại được @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  const switcher = page.getByRole("group", { name: "Ngôn ngữ" });
  await switcher.getByRole("button", { name: "English" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Learn with your teacher, as if side by side" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("group", { name: "Language" }).getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
  expect(await vietnameseLeftovers(page)).toEqual([]);

  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Learn with your teacher, as if side by side" })).toBeVisible();

  await page.getByRole("link", { name: "Sign in to join class" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  expect(await vietnameseLeftovers(page)).toEqual([]);

  await page.getByRole("group", { name: "Language" }).getByRole("button", { name: "Tiếng Việt" }).click();
  await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
});

test("I18N-01 đăng nhập bằng tiếng Anh: lỗi, trang chính, trạng thái buổi và câu lỗi API đều tiếng Anh", async ({ page, fake, allowConsole }) => {
  allowConsole(/status of (400|409)/);
  await page.addInitScript(() => localStorage.setItem("lang", "en"));
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEACHER.email);
  await page.getByLabel("Password").fill("sai-mat-khau");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();

  await page.getByLabel("Password").fill(TEACHER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Hi, ${TEACHER.full_name}` })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  await expect(nav.getByRole("link", { name: "Students" })).toBeVisible();
  await expect(page.getByText("Upcoming", { exact: true }).first()).toBeVisible(); // nhãn trạng thái buổi
  await expect(page.getByRole("link", { name: "Join class" }).first()).toBeVisible();

  // Câu lỗi tiếng Việt của API được dịch khi hiển thị (lib/data.ts errorMessage)
  fake.on("POST", /\/api\/sessions\/[^/]+\/cancel$/, () => ({ status: 409, body: { detail: "Chỉ hủy được buổi học chưa bắt đầu" } }));
  await page.getByRole("button", { name: "Cancel lesson" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Cancel this lesson?" });
  await dialog.getByRole("button", { name: "Cancel lesson" }).click();
  await expect(dialog.getByText("Only lessons that haven't started can be cancelled")).toBeVisible();
  expect(fake.unmocked).toEqual([]);
});

/**
 * AUTH-01, AUTH-03 (test GIAO DIỆN với Supabase/API giả ở ranh giới mạng). Quyền thật (RLS, API trả 404)
 * do pytest và supabase/tests kiểm; ở đây chỉ kiểm web chuyển hướng và hiện đúng thao tác theo vai trò.
 */
import { expect, test } from "../fixtures/test";
import { signIn } from "../fixtures/session";
import { STUDENT, TEACHER } from "../fixtures/fake-backend";

// "/" của khách là trang giới thiệu (landing.spec.ts LAND-01)
const PRIVATE_PATHS = ["/students", "/history", "/reports", "/teaching-notes", "/room/11111111-e2e0-4000-8000-000000000001"];

for (const path of PRIVATE_PATHS) {
  test(`AUTH-01 chưa đăng nhập mở ${path} thì về trang đăng nhập, không tải dữ liệu riêng @smoke`, async ({ page, fake }) => {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Đăng nhập" })).toBeVisible();
    // Không có lời gọi đọc dữ liệu hay API nào trước khi chuyển: nên không có gì riêng tư để ló ra
    expect(fake.calls.filter((c) => c.includes("/rest/v1/") || c.includes("/api/"))).toEqual([]);
  });
}

test("AUTH-01 sai mật khẩu báo lỗi tiếng Việt, không vào được @smoke", async ({ page, fake, allowConsole }) => {
  allowConsole(/status of 400/); // trình duyệt luôn log phản hồi 400 của Supabase Auth
  await page.goto("/login");
  await page.getByLabel("Email").fill(TEACHER.email);
  await page.getByLabel("Mật khẩu").fill("sai-mat-khau");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page.getByText("Email hoặc mật khẩu chưa đúng.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  expect(fake.calls.some((c) => c.startsWith("POST /auth/v1/token"))).toBe(true);
});

test("AUTH-03 giáo viên thấy thao tác quản lý @smoke", async ({ page, fake }) => {
  await signIn(page, TEACHER);
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav.getByRole("link", { name: "Học sinh" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tạo buổi học" }).first()).toBeVisible();
  await expect(page.getByText("(giáo viên)")).toBeVisible();
  expect(fake.unmocked).toEqual([]);
});

test("AUTH-03 học sinh không thấy thao tác quản lý, mở /students bị đưa về trang chính @smoke", async ({ page }) => {
  await signIn(page, STUDENT);
  await expect(page.getByText("(học sinh)")).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Điều hướng chính" });
  await expect(nav.getByRole("link", { name: "Học sinh" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tạo buổi học" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Hủy buổi|Kết thúc/ })).toHaveCount(0);

  await page.goto("/students");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Học sinh", exact: true })).toHaveCount(0);
});

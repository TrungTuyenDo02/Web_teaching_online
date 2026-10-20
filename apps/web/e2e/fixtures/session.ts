import { expect, type Page } from "@playwright/test";
import type { TEACHER } from "./fake-backend";

/** Đăng nhập qua đúng trang LoginPage và Supabase Auth giả; chờ trang chính hiện tên tài khoản. */
export async function signIn(page: Page, account: typeof TEACHER) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Mật khẩu").fill(account.password);
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(account.full_name).first()).toBeVisible();
}

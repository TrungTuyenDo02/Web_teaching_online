/**
 * STU-01, STU-02, STU-03: test GIAO DIỆN trang Học sinh ở chế độ xem trước (component thật, dữ liệu minh họa
 * trong bộ nhớ trình duyệt thay cho Supabase/API). Không chứng minh quyền hay xóa dữ liệu thật: xóa học sinh
 * nhiều bước do pytest (test_student_deletion) và test RLS kiểm.
 */
import { expect, test } from "../fixtures/test";
import type { Page } from "@playwright/test";

const item = (page: Page, name: string) => page.getByRole("listitem").filter({ hasText: name });

test.beforeEach(async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/students");
  await expect(page.getByRole("heading", { name: "Học sinh", exact: true })).toBeVisible();
  await expect(item(page, "Nguyễn Lan Anh")).toBeVisible();
});

test("STU-01 thêm, tìm không dấu, sửa học sinh; bấm gửi hai lần không tạo trùng @smoke", async ({ page }) => {
  await page.getByRole("button", { name: "Thêm học sinh" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Thêm học sinh" });
  await dialog.getByRole("button", { name: "Thêm học sinh" }).click();
  const name = dialog.getByLabel("Họ tên");
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAccessibleDescription(/Hãy nhập họ tên học sinh/);

  await name.fill("Đặng Thử Nghiệm");
  await dialog.getByLabel("Lớp").fill("6C");
  await dialog.getByRole("button", { name: "Thêm học sinh" }).dblclick();
  await expect(page.getByRole("status").filter({ hasText: "Đã thêm Đặng Thử Nghiệm." })).toBeVisible();
  await expect(dialog).toBeHidden();
  await expect(item(page, "Đặng Thử Nghiệm")).toHaveCount(1);

  await page.getByLabel("Tìm theo tên hoặc lớp").fill("dang thu");
  await expect(page.getByRole("listitem")).toHaveCount(1);
  await expect(item(page, "Đặng Thử Nghiệm")).toContainText("Lớp 6C");

  await item(page, "Đặng Thử Nghiệm").getByRole("button", { name: "Sửa hồ sơ" }).click();
  const edit = page.getByRole("dialog", { name: "Sửa hồ sơ học sinh" });
  await expect(edit.getByLabel("Họ tên")).toHaveValue("Đặng Thử Nghiệm");
  await edit.getByLabel("Lớp").fill("7A");
  await edit.getByRole("button", { name: "Lưu hồ sơ" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu hồ sơ học sinh." })).toBeVisible();
  await expect(item(page, "Đặng Thử Nghiệm")).toContainText("Lớp 7A");
  await expect(item(page, "Đặng Thử Nghiệm")).toHaveCount(1);
});

test("STU-02 ngừng dạy, hủy hộp thoại xóa không mất gì, xóa dở rồi xóa tiếp @smoke", async ({ page }) => {
  const minh = item(page, "Trần Đức Minh");
  await minh.getByText("Thao tác khác").click();
  await minh.getByRole("button", { name: "Ngừng dạy" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã chuyển Trần Đức Minh sang ngừng dạy." })).toBeVisible();
  await expect(item(page, "Trần Đức Minh")).toHaveCount(0); // bộ lọc "Đang học"

  await page.getByRole("button", { name: /^Ngừng dạy \(\d+\)$/ }).click();
  const target = item(page, "Trần Đức Minh");
  await expect(target).toContainText("Ngừng dạy");
  await target.getByText("Thao tác khác").click();
  await target.getByRole("button", { name: "Xóa hẳn…" }).click();
  const confirm = page.getByRole("dialog", { name: "Xóa hẳn Trần Đức Minh?" });
  await expect(confirm.getByRole("button", { name: "Xóa hẳn" })).toBeDisabled(); // phải tích xác nhận trước
  await confirm.getByRole("button", { name: "Thôi" }).click();
  await expect(confirm).toBeHidden();
  await expect(target).toBeVisible();

  await target.getByRole("button", { name: "Xóa hẳn…" }).click();
  await confirm.getByLabel("Tôi hiểu dữ liệu này không khôi phục được.").check();
  await confirm.getByRole("button", { name: "Xóa hẳn" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Chưa xóa xong" })).toBeVisible();
  await expect(target.getByText("Đang xóa", { exact: true })).toBeVisible();

  await target.getByRole("button", { name: "Xóa tiếp" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã xóa hẳn Trần Đức Minh." })).toBeVisible();
  await expect(item(page, "Trần Đức Minh")).toHaveCount(0);
  await page.getByRole("button", { name: /^Tất cả/ }).click();
  await expect(item(page, "Trần Đức Minh")).toHaveCount(0);
  await expect(item(page, "Nguyễn Lan Anh")).toBeVisible(); // học sinh khác còn nguyên
});

test("STU-03 tạo tài khoản: lỗi tại trường, email đã dùng, rồi thành công", async ({ page }) => {
  const yen = item(page, "Lê Hoàng Yến");
  await yen.getByRole("button", { name: "Tạo tài khoản" }).click();
  const dialog = page.getByRole("dialog", { name: "Tạo tài khoản cho Lê Hoàng Yến" });
  const email = dialog.getByLabel("Email đăng nhập");
  const password = dialog.getByLabel("Mật khẩu tạm");

  await email.fill("khong-hop-le");
  await password.fill("ngan");
  await dialog.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(email).toHaveAccessibleDescription(/Hãy nhập email hợp lệ/);
  await expect(password).toHaveAccessibleDescription(/ít nhất 8 ký tự/);

  await email.fill("daco@example.com"); // dữ liệu minh họa: email đã có tài khoản
  await password.fill("matkhau-tam-123");
  await dialog.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(email).toHaveAccessibleDescription(/Email này đã được dùng/);

  await email.fill("yen.thu@e2e.test");
  await dialog.getByRole("button", { name: "Tạo tài khoản" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã tạo tài khoản yen.thu@e2e.test." })).toBeVisible();
  await expect(yen).toContainText("Đã có tài khoản đăng nhập");
  await expect(yen.getByRole("button", { name: "Đặt lại mật khẩu" })).toBeVisible();
});

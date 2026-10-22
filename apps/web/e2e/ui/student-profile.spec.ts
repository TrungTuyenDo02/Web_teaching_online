/** Hồ sơ từng học sinh (Giai đoạn 2): chỉ đọc, gom dữ liệu sẵn có; chế độ xem trước, dữ liệu minh họa. */
import { expect, test } from "../fixtures/test";

test("PRO-01 giáo viên mở hồ sơ một học sinh: chỉ thấy buổi, bài tập, lịch của em đó; mở ghi chú riêng đúng em", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/students");
  await page.getByRole("listitem").filter({ hasText: "Nguyễn Lan Anh" }).getByRole("link", { name: "Xem hồ sơ" }).click();
  await expect(page).toHaveURL(/\/students\/s1$/);
  await expect(page).toHaveTitle(/^Hồ sơ học sinh · /);
  await expect(page.getByRole("heading", { level: 1, name: "Nguyễn Lan Anh" })).toBeVisible();

  const past = page.getByRole("region", { name: "Buổi đã học" });
  await expect(past).toContainText("Phân tích đa thức");
  await expect(past).toContainText("Nhân đa thức");
  await expect(past).not.toContainText("Hàm số bậc nhất"); // buổi của học sinh khác
  const homework = page.getByRole("region", { name: "Bài tập" });
  await expect(homework).toContainText("Phiếu luyện phương trình");
  await expect(homework).not.toContainText("Vẽ 3 đồ thị");
  await expect(page.getByRole("region", { name: "Lịch học" })).toContainText("Bất phương trình");
  await expect(page.getByRole("region", { name: "Hồ sơ" })).toContainText("Mục tiêu");

  await page.getByRole("link", { name: "Ghi chú riêng và chủ đề" }).click();
  await expect(page).toHaveURL(/\/teaching-notes\?student=s1$/);
  await expect(page.getByLabel("Học sinh ghi chú")).toHaveValue("s1");
});

test("PRO-02 học sinh không xem được hồ sơ; mã không tồn tại báo không tìm thấy", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/students/khong-co");
  await expect(page.getByText("Không tìm thấy học sinh.")).toBeVisible();
  await openPreview(page, "student", "/students/s1");
  await expect(page.getByText("Chỉ giáo viên được xem hồ sơ học sinh.")).toBeVisible();
  await expect(page.getByText("Phiếu luyện phương trình")).toHaveCount(0);
});

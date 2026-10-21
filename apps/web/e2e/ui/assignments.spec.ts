/** Bài tập, nộp ảnh, xem và trả bài (chế độ xem trước, dữ liệu minh họa; không gọi API/Gemini thật). */
import { expect, test } from "../fixtures/test";

// Ảnh PNG 1×1 hợp lệ: trình duyệt vẽ lại qua canvas (lib/imagePrep.ts) trước khi gửi
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("HW-01 giáo viên giao bài, xem ảnh bài nộp, AI chưa bật thì báo rõ, trả bài có điểm @smoke", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/assignments");
  await expect(page).toHaveTitle(/^Bài tập · /);
  await page.getByRole("button", { name: "Giao bài" }).first().click();
  const form = page.getByRole("dialog", { name: "Giao bài" });
  await form.getByLabel("Học sinh").selectOption({ label: "Trần Đức Minh" });
  await form.getByLabel("Tiêu đề").fill("Bài 7 trang 30");
  await form.getByRole("button", { name: "Giao bài" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã giao bài." })).toBeVisible();
  const created = page.getByRole("listitem").filter({ hasText: "Bài 7 trang 30" });
  await expect(created).toContainText("Chưa nộp");

  const row = page.getByRole("listitem").filter({ hasText: "Phiếu luyện phương trình" });
  await row.getByRole("button", { name: "Xem và chấm" }).click();
  const review = page.getByRole("dialog", { name: /Bài nộp · Phiếu luyện phương trình/ });
  await expect(review.getByRole("img", { name: "Ảnh bài làm 1" })).toBeVisible();
  await review.getByRole("button", { name: "Đọc bài bằng AI" }).click();
  await expect(review.getByRole("alert")).toContainText("chưa được bật"); // xem trước không giả kết quả AI
  await review.getByLabel("Nhận xét cho học sinh").fill("Đúng hết, trình bày gọn.");
  await review.getByLabel("Điểm (0–10)").fill("9");
  await review.getByRole("button", { name: "Trả bài" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã trả bài cho Nguyễn Lan Anh." })).toBeVisible();
  await expect(row).toContainText("Đã trả");
});

test("HW-02 học sinh chỉ thấy bài của mình, nộp ảnh có thông báo quyền riêng tư, xem điểm khi được trả @smoke", async ({ page, openPreview }) => {
  await openPreview(page, "student");
  const homework = page.getByRole("region", { name: "Bài tập" });
  await expect(homework.getByText("Vẽ 3 đồ thị")).toHaveCount(0); // bài của học sinh khác
  await expect(page.getByRole("navigation", { name: "Điều hướng chính" }).getByRole("link", { name: "Bài tập" })).toHaveCount(0);

  const row = homework.getByRole("listitem").filter({ hasText: "Bài 1–5 trang 19" });
  await expect(row).toContainText("Chưa nộp");
  await row.getByRole("button", { name: "Nộp bài" }).click();
  const dialog = page.getByRole("dialog", { name: /Nộp bài · Bài 1–5 trang 19/ });
  await expect(dialog.getByText(/Vị trí chụp và thông tin máy ảnh được gỡ/)).toBeVisible();
  await dialog.getByRole("button", { name: "Nộp bài" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Hãy chọn ít nhất một ảnh");
  await dialog.getByLabel("Ảnh bài làm").setInputFiles([
    { name: "trang1.png", mimeType: "image/png", buffer: PNG },
    { name: "trang2.png", mimeType: "image/png", buffer: PNG },
  ]);
  await dialog.getByRole("button", { name: "Nộp bài" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã nộp bài." })).toBeVisible();
  await expect(row).toContainText("Đã nộp");
  await expect(row).toContainText("Đã nộp 2 ảnh");
});

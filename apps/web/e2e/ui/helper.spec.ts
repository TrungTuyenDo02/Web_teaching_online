import { expect, test } from "../fixtures/test";

test("HELP-01 giáo viên hỏi báo cáo, mở đúng trang và dùng bàn phím @smoke", async ({ page, openPreview }) => {
  await openPreview(page, "teacher");
  await page.getByRole("button", { name: "Mở trợ giúp", exact: true }).click();
  const chat = page.getByRole("dialog", { name: "Bạn đồng hành" });
  await expect(chat.getByText("Trợ giúp giáo viên", { exact: true })).toBeVisible();
  await expect(chat.getByLabel("Nhập câu hỏi cho trợ giúp")).toBeFocused();
  await chat.getByLabel("Nhập câu hỏi cho trợ giúp").fill("Xem báo cáo tháng ở đâu?");
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(chat.getByRole("log")).toContainText("Buổi đang học, đã hủy hoặc vắng không được tính");
  await chat.getByRole("link", { name: "Mở báo cáo tháng" }).click();
  await expect(page).toHaveURL(/\/reports$/);
  await page.getByRole("button", { name: "Mở trợ giúp", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Mở trợ giúp", exact: true })).toBeFocused();
});

test("HELP-02 học sinh hỏi ghi chú và báo cáo không có lối vào quản lý @smoke", async ({ page, openPreview }) => {
  await openPreview(page, "student");
  await page.getByRole("button", { name: "Mở trợ giúp", exact: true }).click();
  const chat = page.getByRole("dialog", { name: "Bạn đồng hành" });
  await expect(chat.getByText("Trợ giúp học sinh", { exact: true })).toBeVisible();
  for (const question of ["Xem ghi chú riêng", "Xem báo cáo tháng", "Quản lý học sinh"]) {
    await chat.getByLabel("Nhập câu hỏi cho trợ giúp").fill(question);
    await chat.getByRole("button", { name: "Gửi", exact: true }).click();
  }
  await expect(chat.getByRole("log")).toContainText("Ghi chú riêng của giáo viên không hiển thị");
  await expect(chat.locator('a[href="/students"], a[href="/reports"], a[href="/teaching-notes"]')).toHaveCount(0);
  await chat.getByLabel("Nhập câu hỏi cho trợ giúp").fill("Giải bài toán giúp em");
  await chat.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(chat.getByRole("log")).toContainText("chưa giải đáp kiến thức bài học");
});

test("HELP-03 khung chat vừa điện thoại, dịch EN và không lưu sau tải lại @smoke", async ({ page, openPreview }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await openPreview(page, "student");
  await page.getByRole("button", { name: "Mở trợ giúp", exact: true }).click();
  const chat = page.getByRole("dialog", { name: "Bạn đồng hành" });
  const box = await chat.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  await chat.getByRole("button", { name: "Xem lại bảng", exact: true }).click();
  await expect(chat.getByRole("log")).toContainText("bản cuối buổi");
  await page.reload();
  await page.getByRole("button", { name: "Mở trợ giúp", exact: true }).click();
  await expect(page.getByRole("log")).not.toContainText("bản cuối buổi");
  await page.getByRole("button", { name: "Thu gọn trò chuyện" }).click();
  await page.getByRole("button", { name: /English/ }).click();
  await page.getByRole("button", { name: "Open help", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Your companion" }).getByText("Student help", { exact: true })).toBeVisible();
});

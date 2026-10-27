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
  // Bài chờ chấm kế tiếp tự mở; bài vừa trả rời mục Chờ chấm
  await page.getByRole("dialog", { name: /Bài nộp · Đề ôn tập chương 2/ }).getByRole("button", { name: "Đóng", exact: true }).first().click();
  await page.getByRole("button", { name: /^Tất cả/ }).click();
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

test("HW-03 giáo viên chữa trên ảnh bằng bút: lưu thành ảnh chữa riêng, xóa được ảnh chữa, ảnh gốc giữ nguyên", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/assignments");
  await page.getByRole("listitem").filter({ hasText: "Phiếu luyện phương trình" }).getByRole("button", { name: "Xem và chấm" }).click();
  const review = page.getByRole("dialog", { name: /Bài nộp · Phiếu luyện phương trình/ });
  await review.getByRole("button", { name: "Chữa trên ảnh: Ảnh bài làm 1" }).click();

  const annotator = page.getByRole("dialog", { name: "Chữa bài · Phiếu luyện phương trình" });
  const save = annotator.getByRole("button", { name: "Lưu ảnh chữa" });
  await expect(save).toBeEnabled(); // ảnh bài làm đã nạp làm nền
  const box = await annotator.locator(".excalidraw__canvas.interactive").boundingBox();
  if (!box) throw new Error("Không thấy canvas chữa bài");
  // Công cụ bút đã chọn sẵn: kéo một nét qua giữa ảnh
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 10 });
  await page.mouse.up();
  await save.click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu ảnh chữa." })).toBeVisible();
  await expect(annotator).toHaveCount(0);

  const marked = review.getByRole("img", { name: "Ảnh thầy cô chữa 1" });
  await expect.poll(() => marked.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  // Nét bút đỏ nằm trong ảnh đã lưu (ảnh mẫu không có màu đỏ)
  const hasInk = await marked.evaluate((img: HTMLImageElement) => {
    const canvas = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight });
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < px.length; i += 4) if (px[i]! > 180 && px[i + 1]! < 90 && px[i + 2]! < 90) return true;
    return false;
  });
  expect(hasInk).toBe(true);
  await expect(review.getByRole("img", { name: "Ảnh bài làm 1" })).toBeVisible();
  await expect(review.getByRole("img", { name: "Ảnh bài làm 2" })).toHaveCount(0); // ảnh chữa không lẫn vào ảnh gốc

  await review.getByRole("button", { name: "Xóa ảnh chữa: Ảnh thầy cô chữa 1" }).click();
  await page.getByRole("dialog", { name: "Xóa ảnh chữa?" }).getByRole("button", { name: "Xóa ảnh chữa" }).click();
  await expect(marked).toHaveCount(0);
  await expect(review.getByRole("img", { name: "Ảnh bài làm 1" })).toBeVisible();
});

test("HW-04 giáo viên yêu cầu làm lại (bắt buộc nhận xét): bài hiện Cần làm lại, không đóng bài", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/assignments");
  const row = page.getByRole("listitem").filter({ hasText: "Phiếu luyện phương trình" });
  await row.getByRole("button", { name: "Xem và chấm" }).click();
  const review = page.getByRole("dialog", { name: /Bài nộp · Phiếu luyện phương trình/ });
  await review.getByRole("button", { name: "Yêu cầu làm lại" }).click();
  await expect(review.getByRole("alert")).toContainText("Hãy viết nhận xét");
  await review.getByLabel("Nhận xét cho học sinh").fill("Câu 3 thiếu bước thử lại nghiệm.");
  await review.getByRole("button", { name: "Yêu cầu làm lại" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã gửi yêu cầu làm lại cho Nguyễn Lan Anh." })).toBeVisible();
  await page.getByRole("dialog", { name: /Bài nộp · Đề ôn tập chương 2/ }).getByRole("button", { name: "Đóng", exact: true }).first().click();
  await page.getByRole("button", { name: /^Tất cả/ }).click();
  await expect(row).toContainText("Cần làm lại");
  await expect(row.getByRole("button", { name: "Xem lại bài nộp" })).toBeVisible();
});

test("HW-05 học sinh thấy yêu cầu làm lại, nhận xét và ảnh thầy cô chữa, rồi nộp lại được", async ({ page, openPreview }) => {
  await openPreview(page, "student");
  const row = page.getByRole("region", { name: "Bài tập" }).getByRole("listitem").filter({ hasText: "Bài 6 trang 20" });
  await expect(row).toContainText("Cần làm lại");
  await expect(row).toContainText("Thầy cô yêu cầu em làm lại");
  await expect(row).toContainText("Câu b sai dấu");
  await expect(row.getByRole("img", { name: "Ảnh thầy cô chữa 1" })).toBeVisible();
  await expect(row).toContainText("Đã nộp 1 ảnh"); // ảnh chữa không tính vào ảnh em nộp
  await row.getByRole("button", { name: "Nộp lại" }).click();
  const dialog = page.getByRole("dialog", { name: /Nộp bài · Bài 6 trang 20/ });
  await dialog.getByLabel("Ảnh bài làm").setInputFiles([{ name: "lam-lai.png", mimeType: "image/png", buffer: PNG }]);
  await dialog.getByRole("button", { name: "Nộp bài" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã nộp bài." })).toBeVisible();
  await expect(row).toContainText("Đã nộp");
  await expect(row).not.toContainText("Cần làm lại");
});

test("HW-06 học sinh chụp thêm ảnh, bỏ ảnh hỏng và gửi tiếp phần còn lại sau lỗi giữa chừng", async ({ page, openPreview }) => {
  await openPreview(page, "student");
  const row = page.getByRole("region", { name: "Bài tập" }).getByRole("listitem").filter({ hasText: "Bài 1–5 trang 19" });
  await row.getByRole("button", { name: "Nộp bài" }).click();
  const dialog = page.getByRole("dialog", { name: /Nộp bài · Bài 1–5 trang 19/ });
  const input = dialog.getByLabel("Ảnh bài làm");
  // Chọn hai lần: ảnh dồn thêm, không thay ảnh đã chọn; ảnh thứ hai không đọc được
  await input.setInputFiles([{ name: "trang1.png", mimeType: "image/png", buffer: PNG }]);
  await input.setInputFiles([{ name: "hong.png", mimeType: "image/png", buffer: Buffer.from("không phải ảnh") }]);
  const picked = dialog.getByRole("list", { name: "Ảnh sẽ nộp" });
  await expect(picked.getByRole("img")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Nộp bài" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Đã gửi 1/2 ảnh");
  await expect(picked.getByRole("listitem").first()).toContainText("Đã gửi");
  await dialog.getByRole("button", { name: "Bỏ ảnh 2" }).click();
  await dialog.getByRole("button", { name: "Gửi tiếp" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã nộp bài." })).toBeVisible();
  await expect(row).toContainText("Đã nộp 1 ảnh"); // không tạo bài nộp thứ hai
});

test("HW-07 giáo viên chấm theo hàng chờ: mục Chờ chấm, nhận xét có sẵn, chọn nhanh điểm, giữ nháp, tự mở bài tiếp theo", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/assignments");
  const filter = page.getByRole("group", { name: "Lọc bài tập" });
  await expect(filter.getByRole("button", { name: "Chờ chấm (2)" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("listitem").filter({ hasText: "Vẽ 3 đồ thị" })).toHaveCount(0); // đã trả: không ở hàng chờ

  await page.getByRole("listitem").filter({ hasText: "Phiếu luyện phương trình" }).getByRole("button", { name: "Xem và chấm" }).click();
  let review = page.getByRole("dialog", { name: /Bài nộp · Phiếu luyện phương trình/ });
  await expect(review).toContainText("Còn 1 bài khác chờ chấm");
  const bank = review.getByRole("group", { name: "Chèn nhận xét có sẵn" });
  await expect(bank.getByRole("button", { name: "Đồ thị đúng, nhớ ghi tên trục." })).toBeVisible(); // nhận xét đã dùng trước
  await bank.getByRole("button", { name: "Cần ghi đủ các bước giải, không chỉ đáp số." }).click();
  await review.getByRole("group", { name: "Chọn nhanh điểm" }).getByRole("button", { name: "9", exact: true }).click();
  await expect(review.getByLabel("Điểm (0–10)")).toHaveValue("9");

  // Lỡ đóng hộp thoại: nhận xét và điểm đang viết vẫn còn khi mở lại
  await review.getByRole("button", { name: "Đóng", exact: true }).first().click();
  await page.getByRole("listitem").filter({ hasText: "Phiếu luyện phương trình" }).getByRole("button", { name: "Xem và chấm" }).click();
  review = page.getByRole("dialog", { name: /Bài nộp · Phiếu luyện phương trình/ });
  await expect(review.getByLabel("Nhận xét cho học sinh")).toHaveValue("Cần ghi đủ các bước giải, không chỉ đáp số.");
  await expect(review.getByLabel("Điểm (0–10)")).toHaveValue("9");

  await review.getByRole("button", { name: "Trả bài" }).click();
  const next = page.getByRole("dialog", { name: /Bài nộp · Đề ôn tập chương 2/ });
  await expect(next).toBeVisible();
  await expect(next.getByLabel("Nhận xét cho học sinh")).toHaveValue(""); // nháp không lẫn sang bài khác
  await expect(next).not.toContainText("chờ chấm;"); // bài cuối hàng chờ
  await expect(filter.getByRole("button", { name: "Chờ chấm (1)" })).toBeVisible();
});

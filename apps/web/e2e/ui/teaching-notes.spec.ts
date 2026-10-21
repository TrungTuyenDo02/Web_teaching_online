import { readFile } from "node:fs/promises";
import { expect, test } from "../fixtures/test";
import { signIn } from "../fixtures/session";
import { STUDENT, TEACHER } from "../fixtures/fake-backend";

test("NOTE-01 ghi chú/chủ đề riêng, sửa lại và tải CSV/Markdown @smoke", async ({ page, openPreview }) => {
  await page.clock.setFixedTime(new Date("2026-10-20T10:00:00Z"));
  await page.setViewportSize({ width: 360, height: 740 });
  await openPreview(page, "teacher", "/teaching-notes");
  await page.getByLabel("Học sinh ghi chú").selectOption("s1");
  const row = page.getByRole("listitem").filter({ hasText: "Phân tích đa thức" });
  await row.getByRole("button", { name: "Ghi chú riêng", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ghi chú riêng sau buổi" });
  await dialog.getByLabel("Nhận xét riêng").fill('Cần luyện <img src=x>\n"Đổi dấu"');
  await dialog.getByLabel("Mức độ nắm bài").fill("Đang nắm");
  await dialog.getByLabel("Cần cải thiện").fill("Tự kiểm tra kết quả");
  await dialog.getByLabel("Tên chủ đề mới").fill("Bất phương trình");
  await dialog.getByLabel("Lớp của chủ đề").fill("9");
  await dialog.getByRole("button", { name: "Thêm chủ đề" }).click();
  await expect(dialog.getByRole("checkbox", { name: "Bất phương trình" })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const save = dialog.getByRole("button", { name: "Lưu ghi chú" });
  expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await save.click();
  await expect(dialog).toHaveCount(0);
  await expect(row).toContainText('Cần luyện <img src=x>');
  await expect(row).toContainText("Bất phương trình");
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await row.getByRole("button", { name: "Ghi chú riêng", exact: true }).click();
  await expect(dialog.getByLabel("Mức độ nắm bài")).toHaveValue("Đang nắm");
  await dialog.getByRole("button", { name: "Hủy", exact: true }).click();
  for (const format of ["CSV", "Markdown"]) {
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: `Tải ghi chú ${format}`, exact: true }).click();
    const file = await pending;
    expect(file.suggestedFilename()).toBe(`ghi-chu-rieng-2026-10.${format === "CSV" ? "csv" : "md"}`);
    const text = await readFile((await file.path())!, "utf8");
    expect(text).toContain("Nguyễn Lan Anh");
    expect(text).toContain("Bất phương trình");
    expect(text).not.toContain("guardian_contact");
    expect(text).not.toContain("Trần Đức Minh");
  }
  await page.getByLabel("Tháng ghi chú").fill("2000-01");
  await expect(page.getByText("Chưa có buổi đã kết thúc trong tháng này.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tải ghi chú CSV", exact: true })).toBeDisabled();
});

test("NOTE-02 học sinh không tải dữ liệu ghi chú riêng @smoke", async ({ page, fake }) => {
  await signIn(page, STUDENT);
  await page.goto("/teaching-notes");
  await expect(page.getByText("Chỉ giáo viên được xem ghi chú riêng.")).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Ghi chú riêng" })).toHaveCount(0);
  expect(fake.calls.filter((call) => /\/api\/(topics|sessions\/.+\/teaching-note|students\/.+\/teaching-notes)/.test(call))).toEqual([]);
});

test("NOTE-04 ghi chú theo ngôn ngữ đã chọn, tháng vẫn theo Việt Nam @smoke", async ({ page, openPreview }) => {
  await page.clock.setFixedTime(new Date("2026-09-30T18:00:00Z"));
  await openPreview(page, "teacher", "/teaching-notes");
  await page.getByRole("button", { name: "EN – English", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Private notes", exact: true })).toBeVisible();
  await expect(page.getByLabel("Notes month")).toHaveValue("2026-10");
  await page.getByLabel("Student for notes").selectOption("s1");
  await page.getByLabel("Notes month").fill("2026-09");
  await page.getByRole("button", { name: "Private notes", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Private lesson notes" });
  await expect(dialog.getByLabel("Private assessment")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Save notes", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "VI – Tiếng Việt", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ghi chú riêng", exact: true })).toBeVisible();
});

test("NOTE-03 xung đột phiên bản giữ bản nháp, tải lại rồi mới lưu @smoke", async ({ page, fake, allowConsole }) => {
  allowConsole(/status of 409/);
  let stored = { session_id: "test-note", scheduled_start: "2026-10-01T10:00:00Z", subject: "Toán", scheduled_topic: "Phương trình", revision: 0, updated_at: null as string | null, summary_md: "", understanding_level: "", improve_points: "", homework_text: "", topic_ids: [] as string[] };
  fake.on("GET", /^\/api\/topics$/, () => ({ status: 200, body: [] }));
  fake.on("GET", /^\/api\/students\/stu-a\/teaching-notes$/, () => ({ status: 200, body: [stored] }));
  fake.on("GET", /^\/api\/sessions\/test-note\/teaching-note$/, () => ({ status: 200, body: stored }));
  fake.on("PUT", /^\/api\/sessions\/test-note\/teaching-note$/, ({ body }) => {
    const input = body as typeof stored & { expected_revision: number };
    if (input.expected_revision === 0) {
      stored = { ...stored, revision: 2, summary_md: "Bản đã lưu ở tab khác" };
      return { status: 409, body: { detail: "Ghi chú đã thay đổi ở tab khác. Hãy tải lại trước khi sửa tiếp." } };
    }
    expect(input.expected_revision).toBe(2);
    stored = { ...stored, summary_md: input.summary_md, revision: 3 };
    return { status: 200, body: stored };
  });
  await signIn(page, TEACHER);
  await page.goto("/teaching-notes");
  await page.getByLabel("Học sinh ghi chú").selectOption("stu-a");
  await page.getByRole("button", { name: "Ghi chú riêng", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Ghi chú riêng sau buổi" });
  await dialog.getByLabel("Nhận xét riêng").fill("Bản nháp");
  await dialog.getByRole("button", { name: "Lưu ghi chú" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Ghi chú đã thay đổi");
  await expect(dialog.getByLabel("Nhận xét riêng")).toHaveValue("Bản nháp");
  await dialog.getByRole("button", { name: "Tải lại bản đã lưu" }).click();
  await expect(dialog.getByLabel("Nhận xét riêng")).toHaveValue("Bản đã lưu ở tab khác");
  await dialog.getByLabel("Nhận xét riêng").fill("Đã ghép đánh giá mới");
  await dialog.getByRole("button", { name: "Lưu ghi chú" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("listitem")).toContainText("Đã ghép đánh giá mới");
});

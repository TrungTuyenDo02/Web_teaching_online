/**
 * SES-01, SES-02: test GIAO DIỆN tạo/sửa/hủy buổi học. Xem trước (dữ liệu minh họa) cho luồng chính; lỗi thời
 * lượng dùng API giả vì giao diện không cho chọn quá 4 giờ. Kiểm tra lịch thật nằm ở pytest (test_schedule).
 */
import { expect, test } from "../fixtures/test";
import { signIn } from "../fixtures/session";
import { TEACHER } from "../fixtures/fake-backend";
import type { Locator, Page } from "@playwright/test";

/** Giá trị datetime-local theo giờ của trình duyệt (múi giờ Asia/Ho_Chi_Minh của context). */
function localInput(page: Page, minutesFromNow: number, roundTo = 5) {
  return page.evaluate(
    ([m, r]) => {
      const t = new Date(Math.ceil((Date.now() + m * 60_000) / (r * 60_000)) * r * 60_000);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
    },
    [minutesFromNow, roundTo] as const,
  );
}

async function openCreate(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Tạo buổi học" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Tạo buổi học" });
  await expect(dialog.getByLabel("Học sinh")).toBeVisible(); // danh sách học sinh đã tải
  return dialog;
}

test("SES-01 tạo, sửa, hủy buổi học; danh sách phản ánh từng bước @smoke", async ({ page, openPreview }) => {
  await openPreview(page, "teacher");
  const dialog = await openCreate(page);
  await dialog.getByLabel("Học sinh").selectOption({ label: "Trần Đức Minh" });
  await dialog.getByLabel("Môn").fill("Toán");
  await dialog.getByLabel("Chủ đề").fill("Ôn tập E2E");
  await dialog.getByLabel("Bắt đầu").fill(await localInput(page, 2 * 24 * 60));
  await dialog.getByLabel("Thời lượng").selectOption("90");
  await dialog.getByRole("button", { name: "Tạo buổi học" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã tạo buổi học." })).toBeVisible();

  const row = page.getByRole("listitem").filter({ hasText: "Ôn tập E2E" });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Trần Đức Minh");

  await row.getByRole("button", { name: "Sửa" }).click();
  const edit = page.getByRole("dialog", { name: "Sửa buổi học với Trần Đức Minh" });
  await expect(edit.getByLabel("Chủ đề")).toHaveValue("Ôn tập E2E");
  await expect(edit.getByLabel("Thời lượng")).toHaveValue("90");
  await edit.getByLabel("Chủ đề").fill("Ôn tập E2E đã sửa");
  await edit.getByRole("button", { name: "Lưu thay đổi" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã lưu thay đổi buổi học." })).toBeVisible();
  const edited = page.getByRole("listitem").filter({ hasText: "Ôn tập E2E đã sửa" });
  await expect(edited).toHaveCount(1);

  await edited.getByRole("button", { name: "Hủy buổi" }).click();
  const confirm = page.getByRole("dialog", { name: "Hủy buổi học?" });
  await confirm.getByRole("button", { name: "Hủy buổi học" }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole("listitem").filter({ hasText: "Ôn tập E2E" })).toHaveCount(0);
});

test("SES-02 trùng giờ và giờ đã qua: lỗi tiếng Việt gắn đúng ô Bắt đầu @smoke", async ({ page, openPreview }) => {
  await openPreview(page, "teacher");
  const dialog = await openCreate(page);
  const start = dialog.getByLabel("Bắt đầu");
  await dialog.getByLabel("Học sinh").selectOption({ label: "Trần Đức Minh" });

  await start.fill(await localInput(page, -3 * 60));
  await dialog.getByRole("button", { name: "Tạo buổi học" }).click();
  await expect(start).toHaveAttribute("aria-invalid", "true");
  await expect(start).toHaveAccessibleDescription(/Giờ học này đã qua/);

  // Dữ liệu minh họa có buổi bắt đầu sau khoảng 25 phút, dài 60 phút
  await start.fill(await localInput(page, 40));
  await dialog.getByRole("button", { name: "Tạo buổi học" }).click();
  await expect(start).toHaveAccessibleDescription(/Trùng giờ với một buổi học khác/);
  await expect(dialog).toBeVisible(); // không đóng, không tạo
});

test("SES-02 API từ chối thời lượng: lỗi gắn đúng ô Thời lượng, gửi đúng giờ kết thúc @smoke", async ({ page, fake, allowConsole }) => {
  allowConsole(/status of 422/);
  const sent: { scheduled_start: string; scheduled_end: string; student_id: string }[] = [];
  fake.on("POST", /^\/api\/sessions$/, ({ body }) => {
    sent.push(body as (typeof sent)[number]);
    return { status: 422, body: { detail: "Một buổi học dài tối đa 4 giờ" } };
  });
  await signIn(page, TEACHER);
  const dialog = await openCreate(page);
  await dialog.getByLabel("Học sinh").selectOption({ label: "Em Thử A" });
  await dialog.getByLabel("Bắt đầu").fill(await localInput(page, 3 * 24 * 60));
  await dialog.getByLabel("Thời lượng").selectOption("240");
  await dialog.getByRole("button", { name: "Tạo buổi học" }).click();

  const duration = dialog.getByLabel("Thời lượng");
  await expect(duration).toHaveAttribute("aria-invalid", "true");
  await expect(duration).toHaveAccessibleDescription(/Một buổi học dài tối đa 4 giờ/);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.student_id).toBe("stu-a");
  expect(Date.parse(sent[0]!.scheduled_end) - Date.parse(sent[0]!.scheduled_start)).toBe(240 * 60_000);
});

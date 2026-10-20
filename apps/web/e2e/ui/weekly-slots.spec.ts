/**
 * SLOT-01 lịch hằng tuần (M1a.3): test GIAO DIỆN. Sinh buổi, chống trùng, quyền và RLS do pytest
 * (test_weekly_slots.py) và supabase/tests kiểm; ở đây kiểm thao tác và dữ liệu web gửi lên API.
 */
import { expect, test } from "../fixtures/test";
import { signIn } from "../fixtures/session";
import { STUDENT, TEACHER } from "../fixtures/fake-backend";

test("SLOT-01 thêm lịch hằng tuần, thấy buổi được xếp, rồi ngừng lịch (xem trước) @smoke", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/students");
  const row = page.getByRole("listitem").filter({ hasText: "Nguyễn Lan Anh" });
  await row.getByRole("button", { name: "Lịch hằng tuần" }).click();
  const dialog = page.getByRole("dialog", { name: "Lịch hằng tuần · Nguyễn Lan Anh" });
  await expect(dialog.getByText("Chưa có lịch cố định.")).toBeVisible();

  await dialog.getByLabel("Thứ").selectOption({ label: "Thứ Bảy" });
  await dialog.getByLabel("Giờ bắt đầu").fill("21:15");
  await dialog.getByLabel("Thời lượng").selectOption({ label: "45 phút" });
  await dialog.getByLabel("Môn").fill("Toán");
  await dialog.getByRole("button", { name: "Thêm lịch" }).click();
  await expect(page.getByRole("status").filter({ hasText: /Đã thêm lịch, xếp [45] buổi trong 4 tuần tới\./ })).toBeVisible();
  const slot = dialog.getByRole("listitem").filter({ hasText: "Thứ Bảy · 21:15 · 45 phút" });
  await expect(slot).toBeVisible();

  await slot.getByRole("button", { name: "Ngừng lịch…" }).click();
  await expect(slot.getByText(/chuyển sang "Đã hủy"/)).toBeVisible();
  await slot.getByRole("button", { name: "Ngừng lịch", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: /Đã ngừng lịch, hủy [45] buổi sắp tới\./ })).toBeVisible();
  await expect(dialog.getByText("Chưa có lịch cố định.")).toBeVisible();
});

test("SLOT-01 chế độ thật: gửi đúng dữ liệu lên API, báo ngày bị bỏ vì trùng giờ", async ({ page, fake }) => {
  let sent: unknown;
  fake.on("GET", /^\/api\/weekly-slots$/, () => ({ status: 200, body: [] }));
  fake.on("POST", /^\/api\/weekly-slots$/, ({ body }) => {
    sent = body;
    const slot = { id: "slot-1", student_id: "stu-a", weekday: 3, start_time: "19:30", duration_minutes: 90, subject: "Toán", topic: null, starts_on: "2026-10-19", active: true };
    fake.on("GET", /^\/api\/weekly-slots$/, () => ({ status: 200, body: [slot] }));
    return { status: 201, body: { slot, created: 3, skipped: [inDays(9)] } };
  });
  await signIn(page, TEACHER);
  await page.goto("/students");
  await page.getByRole("listitem").filter({ hasText: STUDENT.full_name }).getByRole("button", { name: "Lịch hằng tuần" }).click();
  const dialog = page.getByRole("dialog", { name: `Lịch hằng tuần · ${STUDENT.full_name}` });
  await dialog.getByLabel("Thứ").selectOption({ label: "Thứ Tư" });
  await dialog.getByLabel("Giờ bắt đầu").fill("19:30");
  await dialog.getByLabel("Thời lượng").selectOption({ label: "90 phút" });
  await dialog.getByLabel("Môn").fill("  Toán ");
  await dialog.getByRole("button", { name: "Thêm lịch" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Đã thêm lịch, xếp 3 buổi trong 4 tuần tới." })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^.*Bỏ qua buổi trùng giờ với buổi khác: / })).toBeVisible();
  expect(sent).toEqual({ student_id: "stu-a", weekday: 3, start_time: "19:30", duration_minutes: 90, subject: "Toán" });
  await expect(dialog.getByRole("listitem").filter({ hasText: "Thứ Tư · 19:30 · 90 phút" })).toBeVisible();
  expect(fake.unmocked).toEqual([]);
});

function inDays(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

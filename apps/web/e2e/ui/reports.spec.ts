/** Báo cáo UI với preview/API giả; quyền và đếm tháng thực do pytest kiểm. */
import { readFile } from "node:fs/promises";
import { expect, test } from "../fixtures/test";
import { signIn } from "../fixtures/session";
import { STUDENT, TEACHER } from "../fixtures/fake-backend";

test("REPORT-01 chọn tháng và tải CSV tiếng Việt @smoke", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/reports");
  await expect(page.getByRole("heading", { name: "Báo cáo tháng", exact: true })).toBeVisible();
  await page.getByLabel("Tháng báo cáo").fill("2000-01");
  await expect(page.getByText("Tổng cộng: 0 buổi", { exact: true })).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải CSV" }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe("bao-cao-buoi-hoc-2000-01.csv");
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("Nguyễn Lan Anh");
  expect(csv).toContain("Số buổi đã kết thúc");
  expect(csv).not.toContain("guardian");
});

test("REPORT-02 học sinh mở đường dẫn báo cáo không tải dữ liệu @smoke", async ({ page, fake }) => {
  await signIn(page, STUDENT);
  await page.goto("/reports");
  await expect(page.getByText("Chỉ giáo viên được xem báo cáo.")).toBeVisible();
  await expect(page.getByRole("navigation").getByRole("link", { name: "Báo cáo tháng" })).toHaveCount(0);
  expect(fake.calls.some((call) => call.includes("/api/reports/"))).toBe(false);
});

test("REPORT-03 lỗi API rồi thử lại có kết quả, chưa tải được thì không xuất CSV @smoke", async ({ page, fake, allowConsole }) => {
  allowConsole(/status of 502/);
  let fail = true;
  fake.on("GET", /^\/api\/reports\/sessions$/, () => fail ? { status: 502, body: { detail: "Không tải được báo cáo tháng." } } : {
    status: 200, body: { month: "2026-10", timezone: "Asia/Ho_Chi_Minh", period_start: "", period_end: "", total: 2,
      students: [{ student_id: "a", full_name: "Em Thử A", grade: "9", active: true, completed_sessions: 2 }] },
  });
  await signIn(page, TEACHER);
  await page.goto("/reports");
  await expect(page.getByRole("alert")).toContainText("Không tải được báo cáo tháng.");
  await expect(page.getByRole("button", { name: "Tải CSV" })).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Thử lại" }).click();
  await expect(page.getByText("Tổng cộng: 2 buổi", { exact: true })).toBeVisible();
});

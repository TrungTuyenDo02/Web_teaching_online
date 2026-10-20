/**
 * HIST-01 (xem trước) và UI-03 (Supabase giả trả lỗi/rỗng): test GIAO DIỆN. Không chứng minh Storage/RLS thật.
 */
import { expect, test } from "../fixtures/test";
import { signIn } from "../fixtures/session";
import { TEACHER } from "../fixtures/fake-backend";

test("HIST-01 giáo viên xem lịch sử, mở bảng đã lưu; buổi không có bảng báo đúng", async ({ page, openPreview }) => {
  await openPreview(page, "teacher", "/history");
  await expect(page.getByRole("heading", { name: "Buổi đã học" })).toBeVisible();
  const withBoard = page.getByRole("listitem").filter({ hasText: "Phân tích đa thức" });
  const withoutBoard = page.getByRole("listitem").filter({ hasText: "Nhân đa thức" }).filter({ hasNotText: "Phân tích" });
  await expect(withoutBoard).toBeVisible();
  await expect(withoutBoard.getByRole("link", { name: "Xem lại bảng" })).toHaveCount(0);

  await withBoard.getByRole("link", { name: "Xem lại bảng" }).click();
  await expect(page.getByRole("heading", { name: "Bảng cuối buổi (chỉ xem)" })).toBeVisible();
  await expect(page.locator(".excalidraw")).toBeVisible();

  await page.goto("/history/h3/board"); // buổi không có bảng (đi thẳng bằng đường dẫn)
  await expect(page.getByText("Buổi học này không có bảng đã lưu.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Thử lại" })).toBeVisible();
});

test("HIST-01 học sinh chỉ thấy buổi của mình (kiểm giao diện, quyền thật do RLS)", async ({ page, openPreview }) => {
  await openPreview(page, "student", "/history");
  await expect(page.getByRole("listitem").filter({ hasText: "Phân tích đa thức" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Hàm số bậc nhất" })).toHaveCount(0);
});

test("UI-03 lỗi tải lịch học: báo lỗi, Thử lại tải được; danh sách rỗng có hướng dẫn @smoke", async ({ page, fake, allowConsole }) => {
  allowConsole(/status of 500/);
  let fail = true;
  fake.on("GET", /^\/rest\/v1\/sessions$/, () =>
    fail ? { status: 500, body: { message: "boom" } } : { status: 200, body: [] },
  );
  await signIn(page, TEACHER);
  await expect(page.getByText("Không tải được lịch học.").first()).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Thử lại" }).first().click();
  await expect(page.getByText("Chưa có buổi học nào sắp tới.")).toBeVisible();
  await expect(page.getByText("Không tải được lịch học.")).toHaveCount(0);
});

/**
 * BOARD-01..06: bảng viết qua trình duyệt với máy chủ whiteboard-sync THẬT chạy cục bộ. Hai browser context độc
 * lập (cookie, storage, BroadcastChannel tách riêng) cho giáo viên và học sinh. Kết quả đọc từ nội dung bảng của
 * máy nhận. Không thay cho thử bút trên tablet thật (độ trễ, tì tay): docs/tablet-wifi.md.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "../fixtures/test";
import { boardStatus, drawRect, openBoard, scene, typeText, uniqueRoom, type El } from "../fixtures/board";
import type { Page } from "@playwright/test";

const shapes = (els: El[], type: string) => els.filter((e) => e.type === type);

async function pair(newContext: (label: string) => Promise<import("@playwright/test").BrowserContext>, room: string) {
  const teacher = await (await newContext("giáo viên")).newPage();
  const student = await (await newContext("học sinh")).newPage();
  await openBoard(teacher, "teacher", room);
  await openBoard(student, "student", room);
  return { teacher, student };
}

/** Khung WebSocket trang gửi đi (JSON của giao thức bảng). */
function sentFrames(page: Page) {
  const frames: { type?: string }[] = [];
  page.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      try {
        frames.push(JSON.parse(String(f.payload)));
      } catch {
        frames.push({ type: "khong-phai-json" });
      }
    }),
  );
  return frames;
}

test("BOARD-01 giáo viên vẽ, viết chữ, dời, xóa: máy học sinh có đúng nội dung tương ứng @smoke", async ({ newContext }, info) => {
  const { teacher, student } = await pair(newContext, uniqueRoom(info));

  await drawRect(teacher, [120, 120], [320, 220]);
  const [rect] = shapes(await scene(teacher), "rectangle");
  expect(rect).toBeDefined();
  await expect.poll(async () => shapes(await scene(student), "rectangle")).toEqual([
    expect.objectContaining({ id: rect!.id, width: rect!.width, height: rect!.height, x: rect!.x }),
  ]);

  await typeText(teacher, [140, 300], "x = 4");
  await expect.poll(async () => shapes(await scene(student), "text").map((t) => t.text)).toEqual(["x = 4"]);

  // Sửa: chọn hết rồi dời sang phải bằng phím mũi tên
  await teacher.keyboard.press("Control+a");
  for (let i = 0; i < 5; i++) await teacher.keyboard.press("Shift+ArrowRight");
  const moved = shapes(await scene(teacher), "rectangle")[0]!;
  expect(moved.x).toBeGreaterThan(rect!.x);
  await expect.poll(async () => shapes(await scene(student), "rectangle")[0]?.x).toBe(moved.x);

  await teacher.keyboard.press("Delete");
  await expect.poll(async () => (await scene(student)).length).toBe(0);
  const gone = await scene(student, true);
  expect(gone.length).toBeGreaterThanOrEqual(2);
  expect(gone.every((e) => e.isDeleted)).toBe(true);
});

test("BOARD-01 học sinh chỉ xem: thử vẽ/gõ không tạo nét và không gửi cập nhật nào @smoke", async ({ newContext }, info) => {
  const room = uniqueRoom(info);
  const teacher = await (await newContext("giáo viên")).newPage();
  const student = await (await newContext("học sinh")).newPage();
  const frames = sentFrames(student);
  await openBoard(teacher, "teacher", room);
  await openBoard(student, "student", room);
  await expect(student.locator(".board__bar")).toContainText("Chỉ xem");

  await drawRect(student, [100, 100], [260, 200]);
  await typeText(student, [120, 260], "hoc sinh");
  expect(await scene(student)).toEqual([]);
  // Mốc đồng bộ: chờ lần ping kế tiếp (5 s/lần) sau thao tác; cập nhật nếu có phải được gửi trước đó
  const pings = frames.filter((f) => f.type === "ping").length;
  await expect.poll(() => frames.filter((f) => f.type === "ping").length, { timeout: 15_000 }).toBeGreaterThan(pings);
  expect(frames.filter((f) => f.type === "update")).toEqual([]);
  expect(await scene(teacher)).toEqual([]);
});

test("BOARD-02 phòng khác không nhận nét; học sinh tải lại trang vẫn đủ bảng @smoke", async ({ newContext }, info) => {
  const { teacher, student } = await pair(newContext, uniqueRoom(info));
  const other = await pair(newContext, uniqueRoom(info));

  await drawRect(teacher, [100, 100], [300, 200]);
  const [rect] = shapes(await scene(teacher), "rectangle");
  await expect.poll(async () => (await scene(student)).map((e) => e.id)).toEqual([rect!.id]);

  // Đối chứng phòng kia còn sống: nét của chính phòng đó tới nơi, nét của phòng A thì không
  await drawRect(other.teacher, [150, 150], [250, 260]);
  const [marker] = shapes(await scene(other.teacher), "rectangle");
  await expect.poll(async () => (await scene(other.student, true)).map((e) => e.id)).toEqual([marker!.id]);

  await student.reload();
  await expect(boardStatus(student)).toHaveText("Bảng đã kết nối");
  await student.waitForFunction(() => Boolean((window as unknown as { __devBoardApi?: unknown }).__devBoardApi));
  await expect.poll(async () => (await scene(student)).map((e) => e.id)).toEqual([rect!.id]);
});

test("BOARD-04 xóa, hoàn tác, làm lại: nội dung cuối ở máy nhận khớp, không hồi sinh nét đã xóa", async ({ newContext }, info) => {
  const { teacher, student } = await pair(newContext, uniqueRoom(info));
  await drawRect(teacher, [100, 100], [300, 200]);
  await drawRect(teacher, [100, 260], [300, 360]);
  await expect.poll(async () => (await scene(student)).length).toBe(2);
  const [first, second] = shapes(await scene(teacher), "rectangle");

  await teacher.keyboard.press("Control+a");
  await teacher.keyboard.press("Delete");
  await expect.poll(async () => (await scene(student)).length).toBe(0);
  await teacher.keyboard.press("Control+z"); // hoàn tác xóa
  await expect.poll(async () => (await scene(student)).map((e) => e.id).sort()).toEqual([first!.id, second!.id].sort());
  await teacher.keyboard.press("Control+Shift+z"); // làm lại xóa
  await expect.poll(async () => (await scene(student)).length).toBe(0);
  expect(await scene(teacher)).toEqual([]);
});

test("BOARD-05 tải ảnh bảng: bảng trống báo lỗi; có nét thì ra tệp PNG hợp lệ", async ({ newContext }, info) => {
  const page = await (await newContext("giáo viên")).newPage();
  await openBoard(page, "teacher", uniqueRoom(info));
  await page.getByRole("button", { name: "Tải ảnh bảng" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Bảng đang trống" })).toBeVisible();

  await drawRect(page, [100, 100], [300, 220]);
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Tải ảnh bảng" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^bang-viet-.+\.png$/);
  const file = info.outputPath("bang.png");
  await download.saveAs(file);
  const png = readFileSync(file);
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
  const [rect] = shapes(await scene(page), "rectangle");
  // Ảnh bao hình đã vẽ (cộng lề), không phải ảnh rỗng
  expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(Math.floor(rect!.width));
  expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(Math.floor(rect!.height));
});

test("BOARD-06 dán ảnh bị chặn, không tạo và không gửi phần tử ảnh", async ({ newContext }, info) => {
  test.info().annotations.push({
    type: "known-gap",
    description:
      'Excalidraw tự chặn bằng hộp thoại tiếng Anh "Images are disabled." (không có nút đóng): gói vi-VN của Excalidraw 0.18.1 dịch 49%, dưới ngưỡng 85% nên thư viện bỏ qua langCode="vi-VN". Ghi ở docs/testing.md.',
  });
  const room = uniqueRoom(info);
  const teacher = await (await newContext("giáo viên")).newPage();
  const student = await (await newContext("học sinh")).newPage();
  const frames = sentFrames(teacher);
  await openBoard(teacher, "teacher", room);
  await openBoard(student, "student", room);
  await drawRect(teacher, [100, 100], [260, 200]); // có sẵn một nét đã tới máy nhận (đối chứng kênh còn sống)
  await expect.poll(async () => shapes(await scene(student), "rectangle").length).toBe(1);

  const box = (await teacher.locator(".excalidraw__canvas.interactive").boundingBox())!;
  await teacher.mouse.click(box.x + box.width - 40, box.y + box.height / 2); // focus bảng
  await teacher.evaluate(() => {
    // PNG 1x1 hợp lệ, dán như từ clipboard
    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "anh.png", { type: "image/png" }));
    document.activeElement!.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(teacher.getByRole("dialog").filter({ hasText: "Images are disabled." })).toBeVisible();
  expect(shapes(await scene(teacher, true), "image")).toEqual([]);

  // Mốc đồng bộ: lần ping kế tiếp của giáo viên; ảnh nếu bị gửi phải nằm trong khung trước đó
  const pings = frames.filter((f) => f.type === "ping").length;
  await expect.poll(() => frames.filter((f) => f.type === "ping").length, { timeout: 15_000 }).toBeGreaterThan(pings);
  const sentImages = frames.flatMap((f) => (f as { elements?: { type: string }[] }).elements ?? []).filter((e) => e.type === "image");
  expect(sentImages).toEqual([]);
  expect(shapes(await scene(student, true), "image")).toEqual([]);
});

test("BOARD-03 đường truyền giáo viên treo, viết tiếp, nối lại: học sinh nhận đủ nét, không bị treo theo @slow", async ({ newContext }, info) => {
  test.setTimeout(150_000);
  const { teacher, student } = await pair(newContext, uniqueRoom(info));
  await student.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __statusSeen: string[] }).__statusSeen = seen;
    const node = document.querySelector(".board__bar [role=status]")!;
    new MutationObserver(() => seen.push(node.textContent ?? "")).observe(node, { childList: true, characterData: true, subtree: true });
  });

  await teacher.getByRole("button", { name: "Treo đường truyền tab này 40 giây" }).click();
  await drawRect(teacher, [100, 100], [260, 200]);
  await drawRect(teacher, [100, 260], [260, 360]);
  const ids = shapes(await scene(teacher), "rectangle").map((e) => e.id).sort();
  expect(ids).toHaveLength(2);
  // Treo thật: máy chủ chưa nhận gì nên học sinh chưa có nét; tab giáo viên tự phát hiện mất kết nối
  await expect(boardStatus(teacher)).toHaveText(/Mất kết nối/, { timeout: 30_000 });
  expect(await scene(student)).toEqual([]);

  await expect.poll(async () => (await scene(student)).map((e) => e.id).sort(), { timeout: 90_000 }).toEqual(ids);
  await expect(boardStatus(teacher)).toHaveText("Bảng đã kết nối", { timeout: 30_000 });
  const seen = await student.evaluate(() => (window as unknown as { __statusSeen: string[] }).__statusSeen);
  expect(seen.filter((s) => /Mất kết nối/.test(s))).toEqual([]);
});

/**
 * Trợ giúp cho test bảng: trang /dev/whiteboard (chỉ bản development) với máy chủ whiteboard-sync thật chạy
 * cục bộ (global-setup). Nội dung đọc từ Excalidraw API của chính trang (window.__devBoardApi), tức phần tử
 * thật trên bảng của máy nhận, không dựa vào nhãn "đã kết nối" hay BroadcastChannel.
 */
import { expect, type Page, type TestInfo } from "@playwright/test";

export interface El {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  isDeleted: boolean;
}

/** Phòng riêng cho từng test: không lẫn nét giữa các test chạy song song hay chạy lại. */
export function uniqueRoom(info: TestInfo) {
  return `dev-e2e-${info.workerIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function boardStatus(page: Page) {
  return page.locator(".board__bar").getByRole("status");
}

export async function openBoard(page: Page, role: "teacher" | "student", room: string) {
  await page.goto(`/dev/whiteboard?role=${role}&room=${room}`);
  await expect(boardStatus(page)).toHaveText("Bảng đã kết nối");
  await page.waitForFunction(() => Boolean((window as unknown as { __devBoardApi?: unknown }).__devBoardApi));
}

/** Phần tử trên bảng của trang này (mặc định bỏ phần tử đã xóa). */
export function scene(page: Page, includeDeleted = false): Promise<El[]> {
  return page.evaluate((all) => {
    const api = (window as unknown as { __devBoardApi: { getSceneElements(): El[]; getSceneElementsIncludingDeleted(): El[] } }).__devBoardApi;
    const els = all ? api.getSceneElementsIncludingDeleted() : api.getSceneElements();
    return els.map(({ id, type, x, y, width, height, text, isDeleted }) => ({ id, type, x, y, width, height, text, isDeleted }));
  }, includeDeleted);
}

// Gốc tọa độ vẽ lệch vào trong: mép trái có bảng thuộc tính (màu, nét) hiện khi chọn công cụ, mép trên là thanh công cụ
const ORIGIN = { x: 360, y: 90 };

async function canvasBox(page: Page) {
  const box = await page.locator(".excalidraw__canvas.interactive").boundingBox();
  if (!box) throw new Error("Không thấy canvas của bảng");
  return box;
}

const at = (box: { x: number; y: number }, p: [number, number]) => [box.x + ORIGIN.x + p[0], box.y + ORIGIN.y + p[1]] as const;

// Focus bảng: click vùng trống giữa mép phải (góc dưới trái là nút thu phóng, mép trên là thanh công cụ)
async function focusBoard(page: Page, box: { x: number; y: number; width: number; height: number }) {
  await page.mouse.click(box.x + box.width - 40, box.y + box.height / 2);
}

/** Vẽ hình chữ nhật bằng chuột thật (phím tắt r của Excalidraw); tọa độ tính từ ORIGIN trong canvas. */
export async function drawRect(page: Page, from: [number, number], to: [number, number]) {
  const box = await canvasBox(page);
  await focusBoard(page, box);
  await page.keyboard.press("r");
  await page.mouse.move(...at(box, from));
  await page.mouse.down();
  await page.mouse.move(...at(box, to), { steps: 8 });
  await page.mouse.up();
  await page.keyboard.press("Escape");
}

/** Gõ chữ bằng công cụ văn bản (phím t). */
export async function typeText(page: Page, point: [number, number], text: string) {
  const box = await canvasBox(page);
  await focusBoard(page, box);
  await page.keyboard.press("t");
  await page.mouse.click(...at(box, point));
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
}

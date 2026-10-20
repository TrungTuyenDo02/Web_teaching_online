/**
 * ROOM-01, ROOM-02, END-01: test GIAO DIỆN phòng học với API giả (lib/api.ts thật gọi HTTP, route trả lời).
 * Không chứng minh API/LiveKit thật: hợp đồng 404/409/502 và finalize_pending do pytest kiểm.
 */
import { expect, test } from "../fixtures/test";
import { signIn } from "../fixtures/session";
import { TEACHER, type Reply } from "../fixtures/fake-backend";
import type { Page } from "@playwright/test";

const SESSION = "11111111-e2e0-4000-8000-000000000001";
const JOIN = new RegExp(`^/api/sessions/${SESSION}/join$`);
const END = new RegExp(`^/api/sessions/${SESSION}/end$`);

function joined(mode: "main" | "board", livekitUrl = ""): Reply {
  return {
    status: 200,
    body: {
      session_id: SESSION,
      room_name: "room-e2e",
      role: "teacher",
      mode,
      livekit: mode === "main" ? { url: livekitUrl, token: livekitUrl ? "e2e-token-gia" : "" } : null,
      whiteboard: { url: "", token: "" },
    },
  };
}

/** Đếm getUserMedia và WebSocket mà trang tạo (ghi trước khi mã trang chạy). */
async function watchMedia(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __media: { gum: number; sockets: string[] } };
    w.__media = { gum: 0, sockets: [] };
    const md = navigator.mediaDevices;
    if (md?.getUserMedia) {
      const original = md.getUserMedia.bind(md);
      md.getUserMedia = (c) => {
        w.__media.gum += 1;
        return original(c);
      };
    }
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        w.__media.sockets.push(String(url));
      }
    } as typeof WebSocket;
  });
  return () => page.evaluate(() => (window as unknown as { __media: { gum: number; sockets: string[] } }).__media);
}

for (const [status, detail] of [
  [404, "Không tìm thấy buổi học"],
  [409, "Buổi học đã kết thúc hoặc bị hủy"],
  [502, "Chưa mở được phòng video, thử lại"],
] as const) {
  test(`ROOM-02 join ${status}: báo đúng lỗi, không kẹt ở đang tải, thử lại vào được @smoke`, async ({ page, fake, allowConsole }) => {
    allowConsole(new RegExp(`status of ${status}`));
    fake.sequence("POST", JOIN, [{ status, body: { detail } }, joined("main")]);
    await signIn(page, TEACHER);
    await page.goto(`/room/${SESSION}?mode=main`);
    await expect(page.getByText("Chưa vào được phòng")).toBeVisible();
    await expect(page.getByText(detail)).toBeVisible();
    await expect(page.getByText("Đang vào phòng…")).toHaveCount(0);

    await page.getByRole("button", { name: "Thử lại" }).click();
    await expect(page.getByRole("heading", { name: "Phòng học" })).toBeVisible();
    expect(fake.calls.filter((c) => c.startsWith("POST /api/sessions/") && c.endsWith("/join"))).toHaveLength(2);
  });
}

test("ROOM-02 đang chờ API: hiện đang vào phòng, chỉ gọi join một lần @smoke", async ({ page, fake }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  fake.on("POST", JOIN, async () => {
    await gate;
    return joined("main");
  });
  await signIn(page, TEACHER);
  await page.goto(`/room/${SESSION}?mode=main`);
  await expect(page.getByText("Đang vào phòng…")).toBeVisible();
  release();
  await expect(page.getByRole("heading", { name: "Phòng học" })).toBeVisible();
  expect(fake.calls.filter((c) => c.endsWith("/join"))).toHaveLength(1); // StrictMode không điểm danh trùng
});

test("ROOM-01 tablet mode=board: chỉ bảng, không gọi camera/micro, không kết nối video @smoke", async ({ page, fake }) => {
  const media = await watchMedia(page);
  let sentMode: unknown;
  fake.on("POST", JOIN, ({ body }) => {
    sentMode = (body as { mode?: string }).mode;
    return joined("board");
  });
  await signIn(page, TEACHER);
  const font = page.waitForResponse((r) => r.url().includes("/excalidraw-assets/fonts/"));
  await page.goto(`/room/${SESSION}?mode=board`);
  await expect(page.getByRole("heading", { name: "Bảng viết (tablet)" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Bảng viết" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Video" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Kết thúc buổi học" })).toHaveCount(0);
  expect(sentMode).toBe("board");
  // Font của bảng lấy từ chính web, không từ CDN (guard chặn và báo mọi yêu cầu ra ngoài). Yêu cầu thẳng font
  // chữ viết tay của Excalidraw: trước đây lượt tải chỉ tình cờ xảy ra vì font giao diện trùng tên "Nunito"
  await page.evaluate(() => document.fonts.load("20px Excalifont"));
  expect((await font).status()).toBe(200);
  const seen = await media();
  expect(seen.gum).toBe(0);
  expect(seen.sockets.filter((u) => /\/rtc/.test(u))).toEqual([]);
});

test("ROOM-01 đối chứng: mode=main có địa chỉ video thì trang thử kết nối LiveKit (bộ đếm hoạt động)", async ({ page, fake, allowConsole }) => {
  allowConsole(/./); // LiveKit báo lỗi vì cổng 9 không có máy chủ: đây là chủ đích của đối chứng
  const media = await watchMedia(page);
  fake.on("POST", JOIN, () => joined("main", "ws://127.0.0.1:9"));
  await signIn(page, TEACHER);
  await page.goto(`/room/${SESSION}?mode=main`);
  await expect(page.getByRole("heading", { name: "Phòng học" })).toBeVisible();
  await expect.poll(async () => (await media()).sockets.some((u) => u.startsWith("ws://127.0.0.1:9/rtc"))).toBe(true);
});

test("END-01 kết thúc còn việc chờ: không báo xong khi server còn pending, thử lại tới khi xong @smoke", async ({ page, fake }) => {
  const bodies: unknown[] = [];
  const pending = (value: boolean) => (): Reply => ({
    status: 200,
    body: { session_id: SESSION, status: "completed", ended_at: new Date().toISOString(), finalize_pending: value },
  });
  fake.on("POST", JOIN, () => joined("main"));
  fake.on("POST", END, (req) => {
    bodies.push(req.body);
    return pending(bodies.length < 3)(); // hai lần đầu còn việc chờ, lần ba xong
  });
  await signIn(page, TEACHER);
  await page.goto(`/room/${SESSION}?mode=main`);
  await page.getByRole("button", { name: "Kết thúc buổi học" }).click();
  const dialog = page.getByRole("dialog", { name: "Kết thúc buổi học" });
  await dialog.getByLabel("Nội dung đã dạy").fill("Giải phương trình bậc nhất");
  await dialog.getByRole("button", { name: "Kết thúc buổi học" }).click();

  const retry = page.getByRole("button", { name: "Thử lại ngay" });
  await expect(retry).toBeVisible();
  await expect(page.getByText(/Chưa đóng xong phòng video hoặc chưa lưu được bảng/)).toBeVisible();
  await retry.click();
  await expect.poll(() => bodies.length).toBe(2);
  await expect(retry).toBeVisible(); // lần 2 vẫn pending: vẫn ở màn hình chờ
  await retry.click();
  await expect(page).toHaveURL(/\/$/);
  expect(bodies).toHaveLength(3);
  expect(bodies[0]).toMatchObject({ summary: "Giải phương trình bậc nhất" });
});

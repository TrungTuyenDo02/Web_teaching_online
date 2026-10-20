/**
 * Fixture chung cho mọi test trình duyệt:
 * - Chặn và ghi lại mọi HTTP/WebSocket ra ngoài loopback; gom console.error/pageerror. Cuối test: có truy cập
 *   ngoài hoặc lỗi chưa khai báo là test đỏ (BUILD-02, UI-03). Áp cho context mặc định và mọi context tạo
 *   bằng `newContext` (test bảng cần hai thiết bị độc lập).
 * - `allowConsole(re)`: khai báo lỗi console có chủ đích của chính test (vd. trình duyệt log HTTP 502).
 * - `fake` (tự bật): Supabase/API giả ở ranh giới mạng, dữ liệu riêng cho test (fixtures/fake-backend.ts).
 * - `openPreview`: chế độ xem trước (dữ liệu minh họa trong bộ nhớ trình duyệt, chỉ bản development).
 * Mỗi test có browser context mới (cookie, storage, BroadcastChannel tách riêng).
 */
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import { FakeBackend } from "./fake-backend";

export { expect };

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

interface Watch {
  blocked: string[];
  errors: string[];
  allowed: RegExp[];
}

async function guardContext(context: BrowserContext, watch: Watch, label: string) {
  // Đăng ký trước nên ưu tiên thấp nhất: route giả của test (đăng ký sau) được xét trước
  await context.route(
    (url) => /^(https?|wss?):$/.test(url.protocol) && !LOOPBACK.has(url.hostname),
    (route) => {
      watch.blocked.push(`${label}: ${route.request().url()}`);
      return route.abort("blockedbyclient");
    },
  );
  await context.routeWebSocket(
    (url) => !LOOPBACK.has(url.hostname),
    (ws) => {
      watch.blocked.push(`${label}: ${ws.url()}`);
      ws.close();
    },
  );
  context.on("console", (msg) => {
    if (msg.type() === "error") watch.errors.push(`${label} console: ${msg.text()}`);
  });
  context.on("weberror", (err) => watch.errors.push(`${label} pageerror: ${err.error().message}`));
}

interface Fixtures {
  watch: Watch;
  allowConsole: (pattern: RegExp) => void;
  fake: FakeBackend;
  newContext: (label: string) => Promise<BrowserContext>;
  openPreview: (page: Page, role: "teacher" | "student", path?: string) => Promise<void>;
}

export const test = base.extend<Fixtures>({
  watch: [
    async ({ context }, use) => {
      const watch: Watch = { blocked: [], errors: [], allowed: [] };
      await guardContext(context, watch, "context");
      await use(watch);
      expect(watch.blocked, "Không được gọi ra ngoài loopback").toEqual([]);
      const unexpected = watch.errors.filter((text) => !watch.allowed.some((re) => re.test(text)));
      expect(unexpected, "Lỗi console/pageerror chưa khai báo").toEqual([]);
    },
    { auto: true },
  ],
  allowConsole: async ({ watch }, use) => use((pattern) => watch.allowed.push(pattern)),
  fake: [
    async ({ context }, use) => {
      const fake = new FakeBackend();
      await fake.install(context);
      await use(fake);
      expect(fake.unmocked, "Lời gọi Supabase/API chưa được mock").toEqual([]);
    },
    { auto: true },
  ],
  newContext: async ({ browser, watch }, use) => {
    const created: BrowserContext[] = [];
    await use(async (label) => {
      const context = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL,
        locale: "vi-VN",
        timezoneId: "Asia/Ho_Chi_Minh",
        acceptDownloads: true,
      });
      created.push(context);
      await guardContext(context, watch, label);
      return context;
    });
    await Promise.all(created.map((c) => c.close()));
  },
  openPreview: async ({}, use) =>
    use(async (page, role, path = "/") => {
      await page.goto(`/?preview=${role}`);
      await expect(page.getByRole("note").filter({ hasText: "Dữ liệu minh họa" })).toBeVisible();
      if (path !== "/") await page.goto(path);
    }),
});

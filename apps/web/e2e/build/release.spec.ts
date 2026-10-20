/**
 * BUILD-01: bản production không chứa và không mở được công cụ chỉ có ở development (xem trước, trang thử bảng,
 * mã ghép nối, giả lập mất mạng, móc đọc bảng của test), và tự phục vụ font của Excalidraw.
 * Build vào thư mục tạm, không nạp file môi trường nào (envDir: false), URL dịch vụ là loopback giả.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, preview, type PreviewServer } from "vite";
import { expect, test } from "../fixtures/test";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FORBIDDEN = [
  "preview=teacher",
  "Dữ liệu minh họa",
  "Phòng thử cục bộ",
  "Mã ghép nối",
  "Treo đường truyền",
  "Ngắt máy chủ thử",
  "__devBoardApi",
  "installPreview",
  ":8789",
];

test.describe.configure({ mode: "serial" });

let outDir = "";
let server: PreviewServer | undefined;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  outDir = mkdtempSync(path.join(tmpdir(), "gia-su-web-build-"));
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) if (key.startsWith("VITE_")) delete process.env[key];
  Object.assign(process.env, { VITE_SUPABASE_URL: "http://127.0.0.1:9", VITE_SUPABASE_ANON_KEY: "e2e-anon-key", VITE_API_URL: "http://127.0.0.1:9" });
  try {
    await build({ root: WEB_DIR, mode: "production", envDir: false, logLevel: "error", build: { outDir, emptyOutDir: true } });
  } finally {
    process.env = saved;
  }
  server = await preview({ root: WEB_DIR, envDir: false, logLevel: "error", build: { outDir }, preview: { host: "127.0.0.1", port: 0, strictPort: false } });
});

test.afterAll(async () => {
  await server?.close();
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

const base = () => server!.resolvedUrls!.local[0]!.replace(/\/$/, "");

test("BUILD-01 bundle production không chứa chuỗi của công cụ dev @smoke", () => {
  const files = readdirSync(outDir, { recursive: true, encoding: "utf8" }).filter((f) => /\.(js|html|css)$/.test(f));
  expect(files.length).toBeGreaterThan(0);
  const hits = files.flatMap((f) => {
    const text = readFileSync(path.join(outDir, f), "utf8");
    return FORBIDDEN.filter((needle) => text.includes(needle)).map((needle) => `${f}: ${needle}`);
  });
  expect(hits).toEqual([]);
  // Đối chứng: mỗi chuỗi cấm thật sự có trong mã nguồn development (gõ sai thì kiểm tra trên vô nghĩa)
  const devSource = ["src/dev/preview.tsx", "src/dev/whiteboard.tsx", "src/main.tsx"].map((f) => readFileSync(path.join(WEB_DIR, f), "utf8")).join("\n");
  expect(FORBIDDEN.filter((needle) => !devSource.includes(needle))).toEqual([]);
});

test("BUILD-01 font Excalidraw được chép vào bản build (không phụ thuộc CDN) @smoke", () => {
  const fonts = readdirSync(path.join(outDir, "excalidraw-assets/fonts"), { recursive: true, encoding: "utf8" });
  expect(fonts.some((f) => /Nunito[\\/].+\.woff2$/.test(f))).toBe(true);
  expect(fonts.some((f) => /Excalifont[\\/].+\.woff2$/.test(f))).toBe(true);
  // Font giao diện (Nunito, có dấu tiếng Việt) cũng nằm trong bản build, không tải từ dịch vụ ngoài
  expect(readdirSync(path.join(outDir, "assets")).some((f) => /^nunito-vietnamese-wght-normal.*\.woff2$/.test(f))).toBe(true);
});

test("BUILD-01 bản production mở /dev/whiteboard và ?preview= không ra công cụ dev, không bỏ qua đăng nhập @smoke", async ({ page }) => {
  await page.goto(`${base()}/dev/whiteboard`);
  await expect(page.getByText("Không tìm thấy trang")).toBeVisible();
  await expect(page.getByText("Phòng thử cục bộ")).toHaveCount(0);

  // Khách ở "/" thấy trang giới thiệu; ?preview= không mở được trang chính bằng dữ liệu minh họa
  await page.goto(`${base()}/?preview=teacher`);
  await expect(page.getByRole("heading", { level: 1, name: "Học cùng thầy cô, như ngồi cạnh nhau" })).toBeVisible();
  await expect(page.getByText("Dữ liệu minh họa")).toHaveCount(0);
  await expect(page.getByText("Buổi học tiếp theo")).toHaveCount(0);
  await page.goto(`${base()}/students?preview=teacher`);
  await expect(page).toHaveURL(/\/login$/);

  const font = await page.request.get(`${base()}/excalidraw-assets/fonts/Nunito/${readdirSync(path.join(outDir, "excalidraw-assets/fonts/Nunito"))[0]}`);
  expect(font.status()).toBe(200);
});

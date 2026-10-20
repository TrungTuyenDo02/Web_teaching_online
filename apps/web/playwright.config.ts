import { defineConfig, devices } from "@playwright/test";

/**
 * Test trình duyệt (docs/testing.md). global-setup dựng Vite `--mode e2e` và máy chủ bảng thử ở cổng ngẫu nhiên,
 * truyền địa chỉ cho worker qua biến môi trường E2E_*. Không gọi Supabase/API/LiveKit thật.
 * - `npm run test:e2e:smoke`: nhóm @smoke (nhanh, chạy mỗi PR).
 * - `npm run test:e2e`: toàn bộ, gồm nhóm @slow (đường truyền treo, chờ heartbeat thật).
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  outputDir: "test-results",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: 0, // không chạy lại để che lỗi chập chờn
  workers: process.env.CI ? 2 : undefined,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL,
    locale: "vi-VN",
    timezoneId: "Asia/Ho_Chi_Minh",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Camera/micro giả: không hỏi quyền, không dùng thiết bị thật
        launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] },
      },
    },
  ],
});

import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import { isIPv4 } from "node:net";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

// Font của Excalidraw (main.tsx đặt EXCALIDRAW_ASSET_PATH = /excalidraw-assets/): phục vụ khi dev, chép vào
// bản build, thay cho CDN esm.sh mặc định. Xiaolai (chữ Hán, ~13 MB) chỉ được tải theo unicode-range khi cần.
const FONT_SRC = path.resolve(import.meta.dirname, "node_modules/@excalidraw/excalidraw/dist/prod/fonts");
const FONT_URL = "/excalidraw-assets/fonts/";
function excalidrawFonts(): Plugin {
  return {
    name: "excalidraw-fonts",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? "").split("?")[0]!);
        if (!url.startsWith(FONT_URL)) return next();
        const file = path.resolve(FONT_SRC, url.slice(FONT_URL.length));
        if (!file.startsWith(FONT_SRC + path.sep) || !statSync(file, { throwIfNoEntry: false })?.isFile()) return next();
        res.setHeader("Content-Type", file.endsWith(".woff2") ? "font/woff2" : "application/octet-stream");
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const name of readdirSync(FONT_SRC, { recursive: true, encoding: "utf8" })) {
        const file = path.join(FONT_SRC, name);
        if (!statSync(file).isFile()) continue;
        this.emitFile({ type: "asset", fileName: `excalidraw-assets/fonts/${name.split(path.sep).join("/")}`, source: readFileSync(file) });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  // `--mode lan` (make dev-web-lan, thử bảng bằng tablet cùng Wi-Fi): chỉ nghe đúng IP nội bộ trong LAN_IP
  // (không 0.0.0.0) và không nạp file môi trường nào, để máy chủ dev mở ra mạng nội bộ không phát cấu hình
  // VITE_*. Trang /dev/whiteboard không cần cấu hình này.
  const lanIp = mode === "lan" ? (process.env.LAN_IP ?? "") : undefined;
  if (lanIp !== undefined && !(isIPv4(lanIp) && /^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(lanIp))) {
    throw new Error(`LAN_IP phải là IP Wi-Fi nội bộ của laptop (10.x, 172.16–31.x, 192.168.x), nhận được "${lanIp}"`);
  }
  // `--mode e2e` (test trình duyệt, e2e/global-setup.ts): không nạp file môi trường nào; chỉ nhận VITE_* do
  // test đặt (URL loopback giả), để test không bao giờ gọi Supabase/API thật hay đọc cấu hình riêng của máy
  const e2e = mode === "e2e";
  return {
    plugins: [react(), excalidrawFonts()],
    // e2e: không tải nóng. Sửa mã trong lúc test chạy (phiên khác, trình soạn thảo) làm trang đang test tự
    // tải lại giữa chừng (trang trắng, lỗi context React); lần mở trang sau vẫn nhận mã mới
    server: { port: 5173, host: e2e ? "127.0.0.1" : lanIp, hmr: e2e ? false : undefined },
    envDir: lanIp || e2e ? false : undefined,
    cacheDir: e2e ? process.env.E2E_VITE_CACHE : undefined, // thư mục tạm riêng của lần chạy test (global-setup.ts)
  };
});

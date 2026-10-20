/**
 * Dựng môi trường thử cho mỗi lần chạy Playwright và dọn đúng những gì nó tạo:
 * - Cổng trống ngẫu nhiên (không dùng 5173 hay 8788–8790 của người dùng), chỉ nghe 127.0.0.1.
 * - Máy chủ bảng thử thật (services/whiteboard-sync/dev/local-board.ts --e2e): dữ liệu trong thư mục tạm,
 *   tự xóa khi tiến trình này đóng stdin của nó.
 * - Vite `--mode e2e`: không nạp file môi trường nào; VITE_SUPABASE_URL và VITE_API_URL trỏ tới hai cổng
 *   loopback do chính file này giữ ("hố chặn" trả 599). Test giả Supabase/API bằng route của Playwright; lời
 *   gọi nào lọt qua sẽ rơi vào hố chặn và bị ghi nhận, không bao giờ tới dịch vụ thật.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BOARD_DIR = path.resolve(WEB_DIR, "../../services/whiteboard-sync");
const HOST = "127.0.0.1";
const START_TIMEOUT_MS = 90_000;

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => resolve((server.address() as AddressInfo).port));
  });
}

async function freePort(): Promise<number> {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Hố chặn: giữ cổng cho URL giả, trả 599 cho mọi lời gọi không được test mock. */
async function sink(name: string): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    res.writeHead(599, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    });
    res.end(JSON.stringify({ detail: `E2E: ${name} chưa được mock (${req.method} ${req.url})` }));
  });
  return { server, port: await listen(server) };
}

function waitForLine(child: ChildProcess, pattern: RegExp, what: string): Promise<RegExpMatchArray> {
  return new Promise((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`${what} không sẵn sàng sau ${START_TIMEOUT_MS / 1000}s:\n${out}`)), START_TIMEOUT_MS);
    const onData = (chunk: Buffer) => {
      out += chunk.toString().replace(/\u001b\[[0-9;]*m/g, ""); // bỏ mã màu của log
      const match = out.match(pattern);
      if (match) {
        clearTimeout(timer);
        resolve(match);
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`${what} thoát sớm (mã ${code}):\n${out}`));
    });
  });
}

function stopChild(child: ChildProcess, graceful: () => void): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill(), 10_000); // không tự thoát kịp: buộc dừng đúng tiến trình này
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    graceful();
  });
}

export default async function globalSetup() {
  const children: ChildProcess[] = [];
  const sinks: Server[] = [];
  const viteCache = mkdtempSync(path.join(tmpdir(), "gia-su-vite-e2e-"));
  const teardown = async () => {
    await Promise.all(children.map((child, i) => stopChild(child, i === 0 ? () => child.stdin?.end() : () => child.kill())));
    await Promise.all(sinks.map((s) => new Promise((resolve) => s.close(resolve))));
    rmSync(viteCache, { recursive: true, force: true });
  };

  try {
    const webPort = await freePort();
    const supabase = await sink("Supabase");
    const api = await sink("API");
    sinks.push(supabase.server, api.server);

    const board = spawn(
      process.execPath,
      [...(process.execArgv.includes("--experimental-transform-types") ? ["--experimental-transform-types"] : ["--import", "tsx"]), "dev/local-board.ts", "--e2e", `--web-port=${webPort}`, "--board-port=0", "--token-port=0", "--line-port=0"],
      { cwd: BOARD_DIR, stdio: ["pipe", "pipe", "pipe"] },
    );
    children.push(board);
    const ready = JSON.parse((await waitForLine(board, /E2E_READY (\{.*\})/, "Máy chủ bảng thử"))[1]!) as {
      boardPort: number;
      tokenPort: number;
      linePort: number;
    };

    // Môi trường sạch: bỏ mọi VITE_* có sẵn trong shell, chỉ đặt giá trị giả trỏ về loopback
    const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITE_")));
    Object.assign(env, {
      VITE_SUPABASE_URL: `http://${HOST}:${supabase.port}`,
      VITE_SUPABASE_ANON_KEY: "e2e-anon-key",
      VITE_API_URL: `http://${HOST}:${api.port}`,
      VITE_DEV_BOARD_TOKEN_PORT: String(ready.tokenPort),
      // Bộ đệm thư viện riêng (vite.config.ts): Vite khác chạy cùng thư mục (dev của người dùng, phiên khác)
      // tối ưu lại node_modules/.vite giữa chừng làm trang đang test hỏng (ERR_ABORTED, trang trắng)
      E2E_VITE_CACHE: viteCache,
    });
    const vite = spawn(
      process.execPath,
      [path.join(WEB_DIR, "node_modules/vite/bin/vite.js"), "--mode", "e2e", "--port", String(webPort), "--strictPort"],
      { cwd: WEB_DIR, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    children.push(vite);
    await waitForLine(vite, new RegExp(`http://${HOST.replace(/\./g, "\\.")}:${webPort}`), "Vite");

    Object.assign(process.env, {
      E2E_BASE_URL: `http://${HOST}:${webPort}`,
      E2E_SUPABASE_ORIGIN: `http://${HOST}:${supabase.port}`,
      E2E_API_ORIGIN: `http://${HOST}:${api.port}`,
      E2E_BOARD_TOKEN_ORIGIN: `http://${HOST}:${ready.tokenPort}`,
    });
  } catch (err) {
    await teardown();
    throw err;
  }
  return teardown;
}

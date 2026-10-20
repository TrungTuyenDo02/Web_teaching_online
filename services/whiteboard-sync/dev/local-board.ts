/**
 * Máy chủ bảng THỬ CỤC BỘ cho trang /dev/whiteboard của web (chỉ development): `npm run dev:local`.
 * - Dùng đúng createBoardServer thật (xác thực, Origin, giới hạn kích thước giữ nguyên).
 * - Cấu hình truyền trực tiếp, không đọc file môi trường; khóa ký ngẫu nhiên mỗi lần chạy, chỉ nằm ở đây.
 * - Mặc định chỉ nghe 127.0.0.1, cổng riêng (8788 bảng, 8789 cấp token, 8790 proxy đường truyền), dữ liệu trong
 *   thư mục tạm, xóa khi tắt. Trình duyệt nối bảng qua proxy (dev/line-proxy.ts) để giả lập đường truyền treo.
 * - Chế độ Wi-Fi (`--lan=<IP riêng của laptop>`, thử bằng tablet cùng mạng): cấp token và proxy nghe trên đúng IP
 *   đó (máy chủ bảng vẫn chỉ 127.0.0.1), chỉ nhận Origin `http://<IP>:<cổng web>`, và mọi lệnh HTTP phải kèm
 *   `pair=<mã ghép nối>`: mã ngẫu nhiên mỗi lần chạy, chỉ trong RAM, hết hiệu lực khi tắt tiến trình.
 * - Cấp token thử cho phòng `dev-*` qua GET /token?role=teacher|student&room=dev-1&line=<id tab>, chỉ Origin của Vite
 *   (mặc định cổng 5173; Vite đổi cổng khi 5173 bận thì chạy `npm run dev:local -- --web-port=5174`).
 * - POST /pause?room=dev-1&seconds=10: giả lập mất kết nối: cắt các kết nối của phòng và ngừng nhận kết nối
 *   mới trong N giây (khóa và nội dung trong RAM giữ nguyên, token cũ vẫn dùng được khi bật lại).
 * - POST /hang?line=<id tab>&seconds=25: giả lập đường truyền treo của MỘT tab: không đóng kết nối, không gửi
 *   gì; dữ liệu hai chiều bị giữ rồi chuyển nốt khi khôi phục (như gói tin tới muộn). Kết nối mới cũng treo.
 * Không có trong image Docker (Dockerfile chỉ chép src/).
 */
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { isIPv4, type AddressInfo } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { SignJWT } from "jose";
import { startLineProxy, type LineProxy } from "./line-proxy.ts";
import { createBoardServer, isMain, type BoardServer } from "../src/server.ts";

export const DEV_WEB_PORT = 5173;
export const devOrigins = (webPort: number) => [`http://localhost:${webPort}`, `http://127.0.0.1:${webPort}`];
export const DEV_BOARD_PORT = 8788;
export const DEV_TOKEN_PORT = 8789;
export const DEV_LINE_PORT = 8790;
const LOOPBACK = "127.0.0.1";
const ROOM = /^dev-[a-z0-9-]{1,40}$/; // trong SAFE_ID của store; không trùng UUID của buổi thật
const ROLES = new Set(["teacher", "student"]);
const LINE = /^[a-z0-9]{6,32}$/;
const TOKEN_TTL = "2h";
// Mã ghép nối: 8 ký tự từ 31 ký tự dễ đọc (~39 bit), không có 0/O, 1/I/L
const PAIR_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** IP riêng (10/8, 172.16/12, 192.168/16) có trên card mạng của máy; trả lỗi tiếng Việt hoặc null. */
export function lanError(ip: string, interfaces = networkInterfaces()): string | null {
  if (!isIPv4(ip)) return `"${ip}" không phải địa chỉ IPv4.`;
  const [a, b] = ip.split(".").map(Number) as [number, number];
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (!isPrivate) return `${ip} không phải IP mạng nội bộ (10.x, 172.16–31.x, 192.168.x). Không mở bảng thử ra Internet.`;
  const own = Object.values(interfaces).some((list) => list?.some((i) => i.address === ip));
  return own ? null : `${ip} không phải IP của máy này.`;
}

/** IP riêng của máy (gợi ý khi chạy thiếu hoặc sai --lan). */
export function lanCandidates(interfaces = networkInterfaces()): string[] {
  return Object.entries(interfaces).flatMap(([name, list]) =>
    (list ?? []).filter((i) => i.family === "IPv4" && !lanError(i.address, interfaces)).map((i) => `${i.address} (${name})`),
  );
}

export function newPairCode(): string {
  const chars = Array.from({ length: 8 }, () => PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

// Người dùng gõ trên tablet: không phân biệt hoa thường, bỏ gạch/khoảng trắng
const normalizePair = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
const samePair = (given: string | null, expected: string) => {
  const a = Buffer.from(normalizePair(given ?? ""));
  const b = Buffer.from(normalizePair(expected));
  return a.length === b.length && timingSafeEqual(a, b);
};

export interface LocalBoard {
  board: BoardServer;
  tokenServer: Server;
  boardPort: number;
  tokenPort: number;
  proxy: LineProxy;
  dataDir: string;
  /** Địa chỉ cấp token và proxy nghe (127.0.0.1 hoặc IP LAN) */
  host: string;
  /** Chỉ có ở chế độ Wi-Fi */
  pairCode?: string;
  /** Địa chỉ trang thử để mở trên trình duyệt */
  webUrl: string;
  close(): Promise<void>;
}

const listen = (server: Server, port: number, host: string) =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
  });

/** `lan`: IP riêng của laptop để tablet cùng Wi-Fi vào được; người gọi kiểm bằng lanError trước. */
export async function startLocalBoard({
  boardPort = DEV_BOARD_PORT,
  tokenPort = DEV_TOKEN_PORT,
  linePort = DEV_LINE_PORT,
  webPort = DEV_WEB_PORT,
  lan = undefined as string | undefined,
} = {}): Promise<LocalBoard> {
  const host = lan ?? LOOPBACK;
  const origins = lan ? [`http://${lan}:${webPort}`] : devOrigins(webPort);
  const pairCode = lan ? newPairCode() : undefined;
  const secret = randomBytes(32).toString("hex");
  const dataDir = mkdtempSync(join(tmpdir(), "gia-su-board-thu-"));
  const board = createBoardServer({
    port: boardPort,
    jwtSecret: secret,
    allowedOrigins: origins,
    roomLingerMs: 10 * 60 * 1000,
    dataDir,
    saveDelayMs: 500,
  });
  let actualBoardPort = boardPort;
  let proxy: LineProxy | undefined;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  const hangTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function pause(room: string, seconds: number) {
    board.server.close(); // ngừng nhận kết nối mới; kết nối đang mở cắt ở dưới
    for (const peer of board.hub.peersOf(room)) peer.socket.terminate(); // như rớt mạng: không có khung đóng
    resumeTimer = setTimeout(() => {
      resumeTimer = undefined;
      board.server.listen(actualBoardPort, LOOPBACK);
    }, seconds * 1000);
  }

  const tokenServer = createServer((req, res) => {
    const origin = req.headers.origin ?? "";
    if (!origins.includes(origin)) return void res.writeHead(403).end();
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    const url = new URL(req.url ?? "/", `http://${host}`);
    // Chế độ Wi-Fi: người khác cùng mạng không có mã thì không lấy được token, không điều khiển được
    if (pairCode && !samePair(url.searchParams.get("pair"), pairCode)) return void res.writeHead(401).end();
    const role = url.searchParams.get("role") ?? "";
    const room = url.searchParams.get("room") ?? "";
    if (req.method === "POST" && url.pathname === "/pause") {
      const seconds = Number(url.searchParams.get("seconds") ?? 10);
      if (!ROOM.test(room) || !Number.isInteger(seconds) || seconds < 1 || seconds > 60) return void res.writeHead(400).end();
      if (resumeTimer) return void res.writeHead(409).end(); // đang tạm ngắt
      pause(room, seconds);
      return void res.writeHead(204).end();
    }
    if (req.method === "POST" && url.pathname === "/hang") {
      const line = url.searchParams.get("line") ?? "";
      const seconds = Number(url.searchParams.get("seconds") ?? 25);
      if (!LINE.test(line) || !Number.isInteger(seconds) || seconds < 1 || seconds > 120) return void res.writeHead(400).end();
      if (hangTimers.has(line)) return void res.writeHead(409).end(); // đường này đang treo
      proxy!.hang(line);
      hangTimers.set(line, setTimeout(() => (hangTimers.delete(line), proxy!.restore(line)), seconds * 1000));
      return void res.writeHead(204).end();
    }
    if (req.method !== "GET" || url.pathname !== "/token") return void res.writeHead(404).end();
    const line = url.searchParams.get("line") ?? "";
    if (!ROLES.has(role) || !ROOM.test(room) || (line && !LINE.test(line))) return void res.writeHead(400).end();
    new SignJWT({ sid: room, role, mode: "main" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(`thu-${role}`)
      .setIssuedAt()
      .setExpirationTime(TOKEN_TTL)
      .sign(new TextEncoder().encode(secret))
      .then((token) => {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        const query = line ? `/?line=${line}` : "";
        res.end(JSON.stringify({ url: `ws://${host}:${proxy!.port}${query}`, token, role, room }));
      }, () => void res.writeHead(500).end());
  });

  try {
    actualBoardPort = await listen(board.server, boardPort, LOOPBACK);
    proxy = await startLineProxy(actualBoardPort, host, linePort);
    const actualTokenPort = await listen(tokenServer, tokenPort, host);
    const lineProxy = proxy;
    return {
      board,
      tokenServer,
      boardPort: actualBoardPort,
      tokenPort: actualTokenPort,
      proxy: lineProxy,
      dataDir,
      host,
      pairCode,
      webUrl: `http://${lan ?? "localhost"}:${webPort}/dev/whiteboard`,
      close: async () => {
        clearTimeout(resumeTimer);
        for (const timer of hangTimers.values()) clearTimeout(timer);
        await new Promise<void>((resolve) => tokenServer.close(() => resolve()));
        await lineProxy.close();
        await board.close();
        rmSync(dataDir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    tokenServer.close();
    await proxy?.close();
    board.server.close();
    rmSync(dataDir, { recursive: true, force: true });
    throw err;
  }
}

if (isMain(import.meta.url, process.argv[1])) {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  // Cổng: 0 = để hệ điều hành chọn cổng trống (test trình duyệt tự động, mỗi lần chạy một bộ cổng)
  const port = (name: string, fallback: number, allowZero = false) => {
    const value = arg(name) === undefined ? fallback : Number(arg(name));
    if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 65535) {
      console.error(`--${name} phải là số cổng, vd. --${name}=${fallback}`);
      process.exit(1);
    }
    return value;
  };
  const webPort = port("web-port", DEV_WEB_PORT);
  const boardPort = port("board-port", DEV_BOARD_PORT, true);
  const tokenPort = port("token-port", DEV_TOKEN_PORT, true);
  const linePort = port("line-port", DEV_LINE_PORT, true);
  // --e2e: in một dòng JSON khi sẵn sàng; tiến trình cha đóng stdin thì tắt và xóa dữ liệu thử (trên Windows
  // kill không chạy được SIGTERM handler nên không dựa vào tín hiệu)
  const e2e = process.argv.includes("--e2e");
  const lan = arg("lan");
  if (lan !== undefined) {
    const problem = lanError(lan);
    if (problem) {
      const candidates = lanCandidates();
      console.error(`--lan: ${problem}`);
      console.error(candidates.length ? `IP Wi-Fi/LAN của máy này: ${candidates.join(", ")}` : "Máy này chưa có IP mạng nội bộ nào (chưa vào Wi-Fi?).");
      process.exit(1);
    }
  }
  startLocalBoard({ webPort, lan, boardPort, tokenPort, linePort }).then(
    (local) => {
      if (e2e) {
        const ready = { boardPort: local.boardPort, tokenPort: local.tokenPort, linePort: local.proxy.port };
        console.log(`E2E_READY ${JSON.stringify(ready)}`);
        const stop = () => local.close().then(() => process.exit(0));
        process.stdin.on("end", stop).on("close", stop).resume();
        return;
      }
      console.log(`Máy chủ bảng thử: ws://${LOOPBACK}:${local.boardPort} (dữ liệu giả trong thư mục tạm)`);
      console.log(`Proxy đường truyền: ws://${local.host}:${local.proxy.port} (trình duyệt nối qua đây)`);
      console.log(`Cấp token thử:    http://${local.host}:${local.tokenPort}/token`);
      if (local.pairCode) {
        console.log("");
        console.log("CHẾ ĐỘ WI-FI: chỉ dữ liệu giả, chỉ dùng trong Wi-Fi tin cậy (nhà). Không mở ra Internet.");
        console.log(`Cửa sổ 2 chạy:     make dev-web-lan LAN_IP=${lan} WEB_PORT=${webPort}`);
        console.log(`Mở trên laptop và tablet: ${local.webUrl}`);
        console.log(`Mã ghép nối:       ${local.pairCode}   (đổi mỗi lần chạy, hết hiệu lực khi tắt)`);
        console.log("Ctrl+C để tắt và xóa dữ liệu thử.");
      } else {
        console.log(`Mở ${local.webUrl} (chạy make dev-web). Ctrl+C để tắt và xóa dữ liệu thử.`);
      }
      const shutdown = () => local.close().then(() => process.exit(0));
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    },
    (err: NodeJS.ErrnoException) => {
      const hint = err.code === "EADDRINUSE" ? " (cổng 8788/8789/8790 đang bận: đã có máy chủ thử khác đang chạy?)" : "";
      console.error(`Không khởi động được máy chủ bảng thử: ${err.code ?? err.name}${hint}`);
      process.exit(1);
    },
  );
}

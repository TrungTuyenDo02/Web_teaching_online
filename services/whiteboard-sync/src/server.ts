import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { verifyBoardToken, verifyCloseToken, type BoardClaims } from "./auth.ts";
import { loadConfig, loadRootEnv, type Config } from "./config.ts";
import { RoomHub, type Peer } from "./rooms.ts";
import { isBoardElement } from "./scene.ts";
import { errorCode, SceneStore } from "./store.ts";

/**
 * Giao thức (JSON):
 *   client -> server: {type:"auth", token}  (bắt buộc là tin đầu tiên, trong 5 giây)
 *                     {type:"update", elements:[...]}   (chỉ giáo viên; của học sinh bị bỏ qua)
 *                     {type:"ping", n}  (sau khi xác thực; web gửi mỗi 5 giây để phát hiện đường truyền treo)
 *   server -> client: {type:"init", elements:[...], peers:n}
 *                     {type:"update", elements:[...], from:userId}
 *                     {type:"peers", count:n}
 *                     {type:"pong", n}  trả lời ping, chỉ có số thứ tự
 *                     {type:"ended"} rồi đóng với mã 4410 khi giáo viên kết thúc buổi học
 *
 * HTTP (chỉ API gọi): POST /rooms/<id buổi học>/close, Authorization: Bearer <token {sid, act:"close"}>
 *                     -> 200 {elements:[...]} nội dung bảng cuối để API lưu vào Storage
 *                     -> 400 id trên URL sai mã hóa; 401 token sai hoặc của buổi khác;
 *                        500 lỗi đĩa (đã ngắt và chặn phòng, gọi lại để lưu tiếp)
 *                     Gọi lại được, kể cả sau khi máy chủ khởi động lại.
 *                     POST /rooms/<id>/purge, token {sid, act:"purge"} (xóa học sinh)
 *                     -> 204: ngắt mọi người, xóa nội dung bảng trên đĩa, giữ dấu đóng; gọi lại được
 */
const AUTH_TIMEOUT_MS = 5000;
// Máy chủ ping khung điều khiển mỗi 15 s; không có pong hay tin nào trong một chu kỳ thì gỡ (15–30 s).
// Rộng hơn hạn 10 s của web để máy chủ không ngắt trước khi web tự thấy; xem quyết định 21.
const HEARTBEAT_MS = 15_000;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
const MAX_ELEMENTS_PER_UPDATE = 2000;
const CLOSE_SESSION_ENDED = 4410;
const CLOSE_PATH = /^\/rooms\/([^/]+)\/(close|purge)$/;

const send = (target: WebSocket, message: unknown) => {
  if (target.readyState === target.OPEN) target.send(JSON.stringify(message));
};

export interface BoardServer {
  server: Server;
  hub: RoomHub;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function createBoardServer(config: Config): BoardServer {
  const store = config.dataDir ? new SceneStore(config.dataDir) : undefined;
  const hub = new RoomHub(config.roomLingerMs, store, config.saveDelayMs);
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", rooms: hub.roomCount }));
      return;
    }
    const closeMatch = req.method === "POST" ? CLOSE_PATH.exec(req.url ?? "") : null;
    if (closeMatch) {
      let sid: string;
      try {
        sid = decodeURIComponent(closeMatch[1] ?? "");
      } catch {
        return void res.writeHead(400).end(); // URL sai mã hóa (vd. "%"): không để URIError làm sập tiến trình
      }
      const act = closeMatch[2] ?? "close";
      const token = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
      verifyCloseToken(token, config.jwtSecret, act).then(
        (tokenSid) => {
          if (tokenSid !== sid) return void res.writeHead(401).end(); // token của buổi học khác
          const peers = [...hub.peersOf(sid)];
          let elements;
          try {
            if (act === "purge") hub.purge(sid);
            else elements = hub.end(sid);
          } catch (err) {
            console.error("Không lưu/xóa được bảng hoặc dấu đóng phòng", sid, errorCode(err));
            elements = null;
          }
          // Lỗi đĩa vẫn ngắt mọi người: buổi đã kết thúc ở API, hub đã chặn vào lại trong RAM
          for (const peer of peers) {
            send(peer.socket, { type: "ended" });
            peer.socket.close(CLOSE_SESSION_ENDED, "session ended");
          }
          if (elements === null) return void res.writeHead(500).end();
          if (act === "purge") return void res.writeHead(204).end();
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ elements }));
        },
        () => void res.writeHead(401).end(),
      );
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({
    server,
    maxPayload: MAX_PAYLOAD_BYTES,
    verifyClient: ({ origin }, done) => {
      // Trình duyệt luôn gửi Origin; chặn trang lạ kết nối vào máy chủ này
      if (origin && !config.allowedOrigins.includes(origin)) return done(false, 403, "Origin không được phép");
      done(true);
    },
  });

  wss.on("connection", (socket: WebSocket) => {
    let claims: BoardClaims | undefined;
    let peer: Peer | undefined;

    const authTimer = setTimeout(() => {
      if (!claims) socket.close(4401, "auth timeout");
    }, AUTH_TIMEOUT_MS);

    // Đường truyền treo (TCP chưa đóng) không có sự kiện close. Ping khung điều khiển do trình duyệt tự
    // trả lời ở tầng mạng, không phụ thuộc timer JS (tab nền bị hoãn ping ứng dụng vẫn không bị ngắt oan).
    // terminate() phát close một lần, handler close bên dưới gỡ khỏi phòng.
    let alive = true;
    const markAlive = () => void (alive = true);
    socket.on("pong", markAlive);
    socket.on("message", markAlive);
    const heartbeat = setInterval(() => {
      if (!alive) {
        console.warn("Gỡ kết nối bảng không phản hồi", claims?.sid ?? "chưa xác thực");
        return socket.terminate();
      }
      alive = false;
      socket.ping(); // đang đóng dở (vd. 4410 chưa được trả lời) thì không gửi, chu kỳ sau terminate
    }, config.heartbeatMs ?? HEARTBEAT_MS);

    // Thiếu listener thì lỗi giao thức (gói > maxPayload, frame sai) làm sập cả tiến trình.
    // ws đã tự đóng kết nối này (vd. 1009); chỉ log mã lỗi, không log token hay nội dung gói.
    socket.on("error", (err) => {
      console.warn("Đóng kết nối bảng lỗi", claims?.sid ?? "chưa xác thực", errorCode(err));
    });

    socket.on("message", async (raw: RawData) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return socket.close(4400, "bad json");
      }
      if (typeof msg !== "object" || msg === null) return socket.close(4400, "bad message");
      const m = msg as { type?: unknown; token?: unknown; elements?: unknown; n?: unknown };

      if (!claims) {
        if (m.type !== "auth" || typeof m.token !== "string") return socket.close(4401, "auth required");
        try {
          claims = await verifyBoardToken(m.token, config.jwtSecret);
        } catch {
          return socket.close(4401, "invalid token");
        }
        clearTimeout(authTimer);
        // Đóng (hay bị gỡ) trong lúc chờ kiểm token: handler close đã chạy, vào phòng thì không ai gỡ nữa
        if (socket.readyState !== socket.OPEN) return;
        let room;
        try {
          if (hub.isEnded(claims.sid)) return socket.close(CLOSE_SESSION_ENDED, "session ended");
          peer = { socket, claims };
          room = hub.join(claims.sid, peer);
        } catch (err) {
          console.error("Không đọc được bảng đã lưu", claims.sid, errorCode(err));
          peer = undefined;
          return socket.close(1011, "storage error");
        }
        send(socket, { type: "init", elements: room.scene.snapshot(), peers: room.peers.size });
        for (const other of room.peers) {
          if (other !== peer) send(other.socket, { type: "peers", count: room.peers.size });
        }
        return;
      }

      // Heartbeat của web client: chỉ sau xác thực (trước đó mọi tin khác auth đều bị đóng 4401).
      // Chỉ trả lại số thứ tự, không phản hồi dữ liệu nào khác của tin gửi tới.
      if (m.type === "ping") {
        return send(socket, { type: "pong", n: typeof m.n === "number" && Number.isFinite(m.n) ? m.n : undefined });
      }

      if (m.type === "update") {
        // Học sinh chỉ xem bảng (quyết định 14): bỏ qua, không đóng kết nối
        if (claims.role !== "teacher") return;
        if (!Array.isArray(m.elements) || m.elements.length > MAX_ELEMENTS_PER_UPDATE) {
          return socket.close(4400, "bad update");
        }
        const valid = m.elements.filter(isBoardElement);
        const room = peer && hub.roomOf(claims.sid, peer); // buổi đã đóng: bỏ qua nét đến muộn
        if (!room || !peer) return;
        const accepted = room.scene.apply(valid);
        if (accepted.length === 0) return;
        hub.changed(claims.sid);
        for (const other of room.peers) {
          if (other !== peer) send(other.socket, { type: "update", elements: accepted, from: claims.sub });
        }
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
      clearInterval(heartbeat);
      if (claims && peer) {
        hub.leave(claims.sid, peer);
        const remaining = hub.peersOf(claims.sid);
        for (const other of remaining) send(other.socket, { type: "peers", count: remaining.size });
      }
    });
  });

  return {
    server,
    hub,
    listen: (port = config.port) =>
      new Promise((resolve) => {
        server.listen(port, () => {
          const address = server.address();
          resolve(typeof address === "object" && address ? address.port : port);
        });
      }),
    close: () =>
      new Promise((resolve) => {
        hub.closeAll();
        for (const client of wss.clients) client.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}

/** File này có đang được chạy trực tiếp không (so sánh dạng URL để đúng cả trên Windows). */
export function isMain(metaUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && pathToFileURL(argv1).href === metaUrl;
}

// Chạy trực tiếp: `npm run dev` / `npm start`
if (isMain(import.meta.url, process.argv[1])) {
  loadRootEnv();
  const config = loadConfig();
  const board = createBoardServer(config);
  board.listen().then((port) => console.log(`whiteboard-sync lắng nghe cổng ${port}`));
  const shutdown = () => board.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

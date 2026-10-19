import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import { verifyBoardToken, type BoardClaims } from "./auth.ts";
import { loadConfig, type Config } from "./config.ts";
import { RoomHub, type Peer } from "./rooms.ts";
import { isBoardElement } from "./scene.ts";

/**
 * Giao thức (JSON):
 *   client -> server: {type:"auth", token}  (bắt buộc là tin đầu tiên, trong 5 giây)
 *                     {type:"update", elements:[...]}
 *   server -> client: {type:"init", elements:[...], peers:n}
 *                     {type:"update", elements:[...], from:userId}
 *                     {type:"peers", count:n}
 */
const AUTH_TIMEOUT_MS = 5000;
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024;
const MAX_ELEMENTS_PER_UPDATE = 2000;

export interface BoardServer {
  server: Server;
  hub: RoomHub;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function createBoardServer(config: Config): BoardServer {
  const hub = new RoomHub(config.roomLingerMs);
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok", rooms: hub.roomCount }));
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

    const send = (target: WebSocket, message: unknown) => {
      if (target.readyState === target.OPEN) target.send(JSON.stringify(message));
    };

    socket.on("message", async (raw: RawData) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return socket.close(4400, "bad json");
      }
      if (typeof msg !== "object" || msg === null) return socket.close(4400, "bad message");
      const m = msg as { type?: unknown; token?: unknown; elements?: unknown };

      if (!claims) {
        if (m.type !== "auth" || typeof m.token !== "string") return socket.close(4401, "auth required");
        try {
          claims = await verifyBoardToken(m.token, config.jwtSecret);
        } catch {
          return socket.close(4401, "invalid token");
        }
        clearTimeout(authTimer);
        peer = { socket, claims };
        const room = hub.join(claims.sid, peer);
        send(socket, { type: "init", elements: room.scene.snapshot(), peers: room.peers.size });
        for (const other of room.peers) {
          if (other !== peer) send(other.socket, { type: "peers", count: room.peers.size });
        }
        return;
      }

      if (m.type === "update") {
        if (!Array.isArray(m.elements) || m.elements.length > MAX_ELEMENTS_PER_UPDATE) {
          return socket.close(4400, "bad update");
        }
        const valid = m.elements.filter(isBoardElement);
        const room = peer && hub.join(claims.sid, peer); // lấy lại phòng (idempotent)
        if (!room || !peer) return;
        const accepted = room.scene.apply(valid);
        if (accepted.length === 0) return;
        for (const other of room.peers) {
          if (other !== peer) send(other.socket, { type: "update", elements: accepted, from: claims.sub });
        }
      }
    });

    socket.on("close", () => {
      clearTimeout(authTimer);
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

// Chạy trực tiếp: `npm run dev` / `npm start`
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const board = createBoardServer(config);
  board.listen().then((port) => console.log(`whiteboard-sync lắng nghe cổng ${port}`));
  const shutdown = () => board.close().then(() => process.exit(0));
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

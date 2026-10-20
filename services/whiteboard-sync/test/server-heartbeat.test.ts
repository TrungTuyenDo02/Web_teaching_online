// Máy chủ tự gỡ kết nối im lặng (quyết định 21): đường truyền treo mà TCP không đóng thì trước đây máy chủ
// vẫn giữ peer, số thiết bị đếm thừa đến khi TCP tự hết hạn. Máy chủ ping bằng khung điều khiển của
// WebSocket (trình duyệt tự trả lời ở tầng mạng, không phụ thuộc timer JS của tab), không chờ ping ứng dụng.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { SignJWT } from "jose";
import WebSocket from "ws";
import {
  BoardConnection,
  type BoardScene,
  type BoardStatus,
  type ConnectionOptions,
  type SyncElement,
} from "../../../apps/web/src/lib/boardConnection.ts";
import { startLineProxy } from "../dev/line-proxy.ts";
import type { Config } from "../src/config.ts";
import { shouldAccept, type BoardElement } from "../src/scene.ts";
import { createBoardServer } from "../src/server.ts";

const SECRET = "server-heartbeat-test-secret-0123456789";
const SID = "55555555-0000-0000-0000-000000000001";
const HEARTBEAT_MS = 100; // thật: 15 s
const SERVER_DETECT_LIMIT_MS = 2 * HEARTBEAT_MS + 250; // tối đa hai chu kỳ + sai số
// Tab nền: trình duyệt hoãn timer nên web không gửi ping ứng dụng trong suốt test
const THROTTLED: ConnectionOptions = {
  heartbeatIntervalMs: 60_000,
  heartbeatTimeoutMs: 60_000,
  handshakeTimeoutMs: 60_000,
  retryBaseMs: 50,
  maxRetryMs: 200,
};
// Web bình thường, chu kỳ ngắn (thật: 5 s / 10 s)
const FAST: ConnectionOptions = { heartbeatIntervalMs: 100, heartbeatTimeoutMs: 300, handshakeTimeoutMs: 300, retryBaseMs: 50, maxRetryMs: 200 };

class FakeScene implements BoardScene {
  readonly map = new Map<string, SyncElement>();
  elements() {
    return [...this.map.values()];
  }
  applyRemote(remote: SyncElement[]) {
    for (const el of remote as BoardElement[]) {
      if (shouldAccept(this.map.get(el.id) as BoardElement | undefined, el)) this.map.set(el.id, el);
    }
  }
  draw(id: string) {
    this.map.set(id, { id, version: 1, versionNonce: 1, type: "freedraw" });
  }
}

const sign = (sub: string, role = "teacher", sid = SID) =>
  new SignJWT({ sid, role, mode: "main" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(SECRET));

const cleanup: Array<() => unknown> = [];
after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function setup(extra: Partial<Config> = {}) {
  const board = createBoardServer({
    port: 0,
    jwtSecret: SECRET,
    allowedOrigins: [],
    roomLingerMs: 60_000,
    heartbeatMs: HEARTBEAT_MS,
    ...extra,
  });
  const port = await board.listen(0);
  const proxy = await startLineProxy(port);
  cleanup.push(() => board.close(), () => proxy.close());
  const line = (id: string) => `ws://127.0.0.1:${proxy.port}/?line=${id}`;
  return { board, port, proxy, line, direct: `ws://127.0.0.1:${port}` };
}

function client(url: string, token: string, options: ConnectionOptions = FAST) {
  const scene = new FakeScene();
  const statuses: BoardStatus[] = [];
  const peers: number[] = [];
  const events = { onStatus: (s: BoardStatus) => statuses.push(s), onPeers: (n: number) => peers.push(n) };
  const conn = new BoardConnection(url, token, scene, events, options);
  cleanup.push(() => conn.stop());
  conn.start();
  return { conn, scene, statuses, peers };
}

/** Kết nối thô (như trình duyệt: tự trả lời ping khung điều khiển, trừ khi autoPong: false). */
async function raw(url: string, token: string, options: WebSocket.ClientOptions = {}) {
  const ws = new WebSocket(url, options);
  const inbox: any[] = [];
  ws.on("message", (data) => inbox.push(JSON.parse(data.toString())));
  ws.on("error", () => {});
  cleanup.push(() => ws.terminate());
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "auth", token }));
  await until(() => inbox.some((m) => m.type === "init"), 2000, "init");
  return { ws, inbox };
}

async function until(cond: () => boolean, ms = 4000, what = "điều kiện") {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`hết giờ chờ ${what}`);
    await delay(5);
  }
}

const timers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;

describe("máy chủ gỡ kết nối im lặng", { timeout: 30_000 }, () => {
  // Chạy đầu tiên: lúc này tiến trình chưa có timer nào khác để đếm lẫn
  it("tắt máy chủ: dọn hết timer kiểm tra đường truyền", async () => {
    const base = timers();
    const board = createBoardServer({ port: 0, jwtSecret: SECRET, allowedOrigins: [], roomLingerMs: 60_000, heartbeatMs: 50 });
    const port = await board.listen(0);
    const a = await raw(`ws://127.0.0.1:${port}`, await sign("t"));
    const b = new WebSocket(`ws://127.0.0.1:${port}`); // chưa xác thực
    b.on("error", () => {});
    await once(b, "open");
    assert.ok(timers() > base, "có timer khi đang có kết nối");
    await board.close();
    await until(() => timers() === base, 1000, "không còn timer sau khi tắt");
    a.ws.terminate();
    b.terminate();
  });

  it("gỡ kết nối treo trong hạn; máy khỏe vẫn đồng bộ; số thiết bị giảm rồi tăng lại khi nối lại", async () => {
    const { board, proxy, line, direct } = await setup();
    const t = client(direct, await sign("t"));
    const s1 = client(direct, await sign("s1", "student"));
    const s2 = client(line("hs1"), await sign("s2", "student"), THROTTLED); // tab nền, không ping ứng dụng
    await until(() => t.peers.at(-1) === 3 && s1.peers.at(-1) === 3, 4000, "3 thiết bị");

    proxy.hang("hs1");
    const hungAt = Date.now();
    await until(() => board.hub.peersOf(SID).size === 2, 3000, "máy chủ gỡ kết nối treo");
    const detectMs = Date.now() - hungAt;
    assert.ok(detectMs <= SERVER_DETECT_LIMIT_MS, `gỡ sau ${detectMs} ms (giới hạn ${SERVER_DETECT_LIMIT_MS})`);
    await until(() => t.peers.at(-1) === 2 && s1.peers.at(-1) === 2, 1000, "máy còn lại thấy 2 thiết bị");
    assert.equal(s2.statuses.at(-1), "online", "tab treo chưa biết gì (không có timer chạy)");

    t.scene.draw("a");
    t.conn.flush();
    await until(() => s1.scene.map.has("a"), 2000, "học sinh khỏe nhận a");
    await delay(5 * HEARTBEAT_MS);
    assert.equal(board.hub.peersOf(SID).size, 2, "không gỡ nhầm máy khỏe");

    proxy.restore("hs1"); // việc máy chủ đóng kết nối tới tab, tab nối lại
    await until(() => s2.scene.map.has("a"), 4000, "tab vừa treo nối lại và nhận a");
    await until(() => board.hub.peersOf(SID).size === 3 && t.peers.at(-1) === 3, 2000, "3 thiết bị sau khi nối lại");
  });

  it("kết nối cũ bị gỡ, phản hồi và đóng muộn của nó không ảnh hưởng kết nối mới", async () => {
    // Máy chủ chậm hơn web: web tự nối lại trước, máy chủ gỡ kết nối cũ sau
    const { board, proxy, line, direct } = await setup({ heartbeatMs: 1000 });
    const t = client(direct, await sign("t"));
    const s = client(line("hs2"), await sign("s", "student"));
    await until(() => t.peers.at(-1) === 2 && s.statuses.at(-1) === "online", 4000, "2 thiết bị");

    proxy.hang("hs2", { existingOnly: true }); // kết nối cũ chết lặng lẽ, kết nối mới đi được
    await until(() => s.statuses.includes("offline") && s.statuses.at(-1) === "online", 4000, "web nối lại");
    assert.equal(board.hub.peersOf(SID).size, 3, "ngay sau khi nối lại: kết nối cũ chưa bị gỡ");
    await until(() => board.hub.peersOf(SID).size === 2, 2 * 1000 + 500, "máy chủ gỡ kết nối cũ");
    await until(() => t.peers.at(-1) === 2, 1000, "giáo viên thấy 2 thiết bị");

    const statuses = s.statuses.length;
    proxy.restore("hs2"); // pong và việc đóng của kết nối cũ tới muộn
    await delay(500);
    assert.equal(board.hub.peersOf(SID).size, 2, "kết nối mới vẫn trong phòng");
    assert.deepEqual(s.statuses.slice(statuses), [], "web không đổi trạng thái");
    t.scene.draw("b");
    t.conn.flush();
    await until(() => s.scene.map.has("b"), 2000, "học sinh nhận b qua kết nối mới");
  });

  it("tab không gửi ping ứng dụng nhưng trả lời ping đường truyền thì không bị ngắt", async () => {
    const { board, direct } = await setup();
    const quiet = await raw(direct, await sign("s", "student")); // chỉ xác thực, không gửi gì thêm
    const deaf = await raw(direct, await sign("x", "student"), { autoPong: false }); // không trả lời ping
    let pings = 0;
    quiet.ws.on("ping", () => pings++);
    await until(() => board.hub.peersOf(SID).size === 1, SERVER_DETECT_LIMIT_MS + 200, "gỡ kết nối không trả lời");
    await delay(10 * HEARTBEAT_MS);
    assert.ok(pings >= 5, `nhận ${pings} ping khung điều khiển`);
    assert.equal(quiet.ws.readyState, WebSocket.OPEN);
    assert.equal(board.hub.peersOf(SID).size, 1, "tab im lặng vẫn trong phòng");
    assert.ok(!quiet.inbox.some((m) => m.type === "pong"), "không gửi gì ở tầng ứng dụng");
    assert.notEqual(deaf.ws.readyState, WebSocket.OPEN);
  });

  it("người cuối bị gỡ: nét đang chờ lưu vẫn được lưu khi hết hạn giữ phòng, vào lại thấy đủ", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "board-hb-"));
    cleanup.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const { board, proxy, line, direct } = await setup({ dataDir, saveDelayMs: 60_000, roomLingerMs: 300 });
    const t = await raw(line("gv3"), await sign("t"));
    t.ws.send(JSON.stringify({ type: "update", elements: [{ id: "a", version: 1, versionNonce: 1 }] }));
    t.ws.send(JSON.stringify({ type: "ping", n: 1 }));
    await until(() => t.inbox.some((m) => m.type === "pong"), 2000, "máy chủ đã nhận nét");

    proxy.hang("gv3");
    await until(() => board.hub.peersOf(SID).size === 0, SERVER_DETECT_LIMIT_MS + 200, "gỡ người cuối");
    assert.equal(board.hub.roomCount, 1, "phòng còn giữ trong hạn");
    await until(() => board.hub.roomCount === 0, 2000, "hết hạn giữ phòng");
    const saved = JSON.parse(readFileSync(join(dataDir, `${SID}.json`), "utf8"));
    assert.deepEqual(saved.map((e: BoardElement) => e.id), ["a"], "nét đã lưu xuống đĩa");

    const again = await raw(direct, await sign("t"));
    assert.deepEqual(again.inbox[0].elements.map((e: BoardElement) => e.id), ["a"]);
  });

  it("buổi kết thúc lúc đường truyền treo: kết nối bị gỡ, phòng không mở lại, tab nhận 'ended' khi có mạng", async () => {
    const { board, proxy, line } = await setup({ roomLingerMs: 300 });
    const t = client(line("gv4"), await sign("t"), THROTTLED);
    await until(() => t.statuses.at(-1) === "online");
    proxy.hang("gv4");
    const peers = [...board.hub.peersOf(SID)]; // như POST /rooms/:id/close
    board.hub.end(SID);
    for (const peer of peers) peer.socket.close(4410, "session ended");
    await until(() => peers.every((p) => p.socket.readyState === WebSocket.CLOSED), SERVER_DETECT_LIMIT_MS + 200, "gỡ socket đã đóng dở");
    assert.equal(board.hub.roomCount, 0, "không mở lại phòng");
    assert.ok(board.hub.isEnded(SID));
    proxy.restore("gv4");
    await until(() => t.statuses.at(-1) === "ended", 2000, "tab nhận ended");
    await delay(500);
    assert.equal(proxy.connections("gv4"), 1, "không nối lại sau 4410");
    assert.equal(board.hub.roomCount, 0);
  });

  it("kết nối đóng trong lúc đang kiểm token: không bị thêm vào phòng", async () => {
    const { board, direct } = await setup();
    const token = await sign("s", "student");
    for (let i = 0; i < 20; i++) {
      const ws = new WebSocket(direct);
      ws.on("error", () => {});
      await once(ws, "open");
      ws.send(JSON.stringify({ type: "auth", token }), () => ws.terminate());
    }
    await delay(300);
    assert.equal(board.hub.peersOf(SID).size, 0, "không còn peer của kết nối đã đóng");
  });
});

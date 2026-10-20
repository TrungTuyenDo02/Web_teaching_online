// Đường truyền treo: kết nối không đóng nhưng không còn trao đổi dữ liệu (mất sóng, Offline của DevTools).
// Trước đây web client chỉ dựa vào sự kiện close nên vẫn báo "đã kết nối" và nét tới chậm vài phút.
// Proxy thử (dev/line-proxy.ts) giữ dữ liệu hai chiều, không gửi close, không tắt tiến trình.
import assert from "node:assert/strict";
import { once } from "node:events";
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
import { startLineProxy, type LineProxy } from "../dev/line-proxy.ts";
import { shouldAccept, type BoardElement } from "../src/scene.ts";
import { createBoardServer, type BoardServer } from "../src/server.ts";

const SECRET = "heartbeat-test-secret-0123456789abcdef";
const SID = "44444444-0000-0000-0000-000000000001";
// Chu kỳ ngắn cho test (thật: 5 s / 10 s); mọi giới hạn thời gian dưới đây suy từ đây
const FAST: ConnectionOptions = {
  heartbeatIntervalMs: 100,
  heartbeatTimeoutMs: 300,
  handshakeTimeoutMs: 300,
  retryBaseMs: 50,
  maxRetryMs: 200,
};
const DETECT_LIMIT_MS = 100 + 300 + 250; // một chu kỳ + hạn chờ pong + sai số

class FakeScene implements BoardScene {
  readonly map = new Map<string, SyncElement>();
  applied = 0;
  elements() {
    return [...this.map.values()];
  }
  applyRemote(remote: SyncElement[]) {
    this.applied++;
    for (const el of remote as BoardElement[]) {
      if (shouldAccept(this.map.get(el.id) as BoardElement | undefined, el)) this.map.set(el.id, el);
    }
  }
  draw(id: string, version = 1) {
    this.map.set(id, { id, version, versionNonce: 1, type: "freedraw" });
  }
  keys() {
    return [...this.map.values()].map((e) => `${e.id}:${e.version}`).sort();
  }
}

const sign = (sub: string, role = "teacher", secret = SECRET) =>
  new SignJWT({ sid: SID, role, mode: "main" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));

const cleanup: Array<() => unknown> = [];
after(async () => {
  for (const fn of cleanup.reverse()) await fn();
});

async function setup() {
  const board = createBoardServer({ port: 0, jwtSecret: SECRET, allowedOrigins: [], roomLingerMs: 60_000 });
  const port = await board.listen(0);
  const proxy = await startLineProxy(port);
  cleanup.push(() => board.close(), () => proxy.close());
  return { board, port, proxy };
}

function client(url: string, token: string, options: ConnectionOptions = FAST, scene = new FakeScene()) {
  const statuses: BoardStatus[] = [];
  const conn = new BoardConnection(url, token, scene, { onStatus: (s) => statuses.push(s), onPeers: () => {} }, options);
  cleanup.push(() => conn.stop());
  conn.start();
  return { conn, scene, statuses };
}

const viaProxy = (proxy: LineProxy, line: string) => `ws://127.0.0.1:${proxy.port}/?line=${line}`;

async function until(cond: () => boolean, ms = 4000, what = "điều kiện") {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error(`hết giờ chờ ${what}`);
    await delay(10);
  }
}

describe("heartbeat: phát hiện đường truyền treo", { timeout: 30_000 }, () => {
  it("báo mất kết nối trong hạn; nét gửi ngay trước khi treo và nét viết lúc treo tới học sinh sau khi khôi phục", async () => {
    const { board, port, proxy } = await setup();
    const t = client(viaProxy(proxy, "gv"), await sign("t"));
    const s = client(`ws://127.0.0.1:${port}`, await sign("s", "student"));
    await until(() => t.statuses.at(-1) === "online" && s.statuses.at(-1) === "online", 4000, "hai máy vào phòng");
    t.scene.draw("a");
    t.conn.flush();
    await until(() => s.scene.map.has("a"), 4000, "học sinh nhận a");

    proxy.hang("gv");
    const hungAt = Date.now();
    t.scene.draw("b"); // gửi "thành công" ở phía trình duyệt nhưng không tới máy chủ
    t.conn.flush();
    await until(() => t.statuses.at(-1) === "offline", 3000, "báo mất kết nối");
    const detectMs = Date.now() - hungAt;
    assert.ok(detectMs <= DETECT_LIMIT_MS, `báo mất kết nối sau ${detectMs} ms (giới hạn ${DETECT_LIMIT_MS})`);
    t.scene.draw("c"); // viết tiếp lúc mất kết nối: vẫn giữ ở máy giáo viên
    t.conn.flush();

    // Đang treo: thử lại theo backoff, không tạo kết nối dày đặc
    const before = proxy.connections("gv");
    await delay(1000);
    const attempts = proxy.connections("gv") - before;
    assert.ok(attempts <= 4, `${attempts} lần nối trong 1 s khi đang treo`);
    assert.ok(!s.scene.map.has("b") && !s.scene.map.has("c"), "học sinh chưa nhận gì khi đang treo");

    // Khôi phục, bỏ dữ liệu bị giữ (kết nối cũ coi như mất hẳn): b chỉ tới nếu được gửi bù
    proxy.restore("gv", { discard: true });
    await until(() => t.statuses.at(-1) === "online", 4000, "nối lại");
    await until(() => s.scene.map.has("b") && s.scene.map.has("c"), 4000, "học sinh nhận b, c");
    assert.deepEqual(s.scene.keys(), t.scene.keys(), "hai máy hội tụ");
    await until(() => board.hub.peersOf(SID).size === 2, 4000, "chỉ còn 2 kết nối trên máy chủ");
  });

  it("phản hồi muộn từ kết nối cũ không đổi trạng thái hay dữ liệu", async () => {
    const { board, port, proxy } = await setup();
    const t = client(viaProxy(proxy, "gv2"), await sign("t"));
    const s = client(viaProxy(proxy, "hs2"), await sign("s", "student"));
    await until(() => t.statuses.at(-1) === "online" && s.statuses.at(-1) === "online");

    proxy.hang("hs2", { existingOnly: true }); // kết nối hiện có treo, kết nối mới đi được
    t.scene.draw("x");
    t.conn.flush(); // update tới kết nối cũ của học sinh bị giữ lại
    await until(() => s.statuses.includes("offline"), 3000, "học sinh báo mất kết nối");
    await until(() => s.statuses.at(-1) === "online" && s.scene.map.has("x"), 4000, "học sinh nối lại và nhận x qua kết nối mới");

    const statusesBefore = s.statuses.length;
    const appliedBefore = s.scene.applied;
    proxy.restore("hs2"); // pong, update cũ tới muộn trên kết nối đã bỏ
    await delay(500);
    assert.deepEqual(s.statuses.slice(statusesBefore), [], "kết nối cũ không đổi trạng thái");
    assert.equal(s.scene.applied, appliedBefore, "kết nối cũ không đưa dữ liệu vào bảng");
    await until(() => board.hub.peersOf(SID).size === 2, 4000, "kết nối cũ được máy chủ gỡ khi khôi phục");
    void port;
  });

  it("quay lại tab sau khi ngủ: không tin phản hồi cũ, kiểm tra lại ngay", async () => {
    const { proxy } = await setup();
    let fakeNow = Date.now();
    // Chu kỳ dài: chỉ verify() gửi ping, giống timer bị trình duyệt hoãn khi tab ẩn
    const t = client(viaProxy(proxy, "gv3"), await sign("t"), { ...FAST, heartbeatIntervalMs: 60_000, now: () => fakeNow });
    await until(() => t.statuses.at(-1) === "online");

    fakeNow += 180_000; // thiết bị ngủ 3 phút, không timer nào chạy (> 2 chu kỳ 60 s)
    t.conn.verify();
    assert.equal(t.statuses.at(-1), "checking", "không hiện 'đã kết nối' dựa trên phản hồi cũ");
    await until(() => t.statuses.at(-1) === "online", 2000, "pong mới xác nhận lại");

    t.conn.verify(); // vừa có pong: không ping thừa, không đổi trạng thái
    assert.equal(t.statuses.at(-1), "online");

    proxy.hang("gv3");
    fakeNow += 180_000;
    t.conn.verify();
    await until(() => t.statuses.at(-1) === "offline", 2000, "đường treo: báo mất kết nối sau hạn pong");
    proxy.restore("gv3", { discard: true });
    await until(() => t.statuses.at(-1) === "online", 4000, "nối lại");
  });

  it("stop() khi đang treo: không nối lại, không đổi trạng thái nữa", async () => {
    const { proxy } = await setup();
    const t = client(viaProxy(proxy, "gv4"), await sign("t"));
    await until(() => t.statuses.at(-1) === "online");
    proxy.hang("gv4");
    t.conn.stop(); // unmount, đổi phòng
    const statuses = t.statuses.length;
    const conns = proxy.connections("gv4");
    await delay(1000);
    assert.equal(t.statuses.length, statuses, "không có trạng thái sau stop");
    assert.equal(proxy.connections("gv4"), conns, "không nối lại sau stop");
  });

  it("buổi kết thúc (4410) và token sai (4401): dừng heartbeat, không nối lại", async () => {
    const { board, proxy } = await setup();
    const t = client(viaProxy(proxy, "gv5"), await sign("t"));
    await until(() => t.statuses.at(-1) === "online");
    const peers = [...board.hub.peersOf(SID)]; // như handler close của máy chủ: lấy trước khi end
    board.hub.end(SID);
    for (const peer of peers) peer.socket.close(4410, "session ended");
    await until(() => t.statuses.at(-1) === "ended");

    const bad = client(viaProxy(proxy, "gv6"), await sign("t", "teacher", "khoa-sai-0123456789abcdef0123456789"));
    await until(() => bad.statuses.at(-1) === "expired");
    await delay(1000); // > nhiều chu kỳ heartbeat và hạn bắt tay
    assert.equal(t.statuses.at(-1), "ended");
    assert.equal(bad.statuses.at(-1), "expired");
    assert.equal(proxy.connections("gv5"), 1, "không nối lại sau 4410");
    assert.equal(proxy.connections("gv6"), 1, "không nối lại sau 4401");
  });

  it("máy chủ: chỉ trả pong cho kết nối đã xác thực, pong chỉ có số thứ tự", async () => {
    const { port } = await setup();
    const anon = new WebSocket(`ws://127.0.0.1:${port}`);
    await once(anon, "open");
    anon.send(JSON.stringify({ type: "ping", n: 1 }));
    const [code] = await once(anon, "close");
    assert.equal(code, 4401, "ping trước khi xác thực bị đóng như mọi tin khác");

    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const inbox: any[] = [];
    ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "auth", token: await sign("s", "student") }));
    await until(() => inbox.some((m) => m.type === "init"));
    ws.send(JSON.stringify({ type: "ping", n: 7 }));
    ws.send(JSON.stringify({ type: "ping", n: "khong-phai-so", token: "x" }));
    await until(() => inbox.filter((m) => m.type === "pong").length === 2, 2000, "hai pong");
    const pongs = inbox.filter((m) => m.type === "pong");
    assert.deepEqual(pongs[0], { type: "pong", n: 7 });
    assert.deepEqual(pongs[1], { type: "pong" }, "không phản hồi lại dữ liệu lạ");
    ws.close();
  });
});

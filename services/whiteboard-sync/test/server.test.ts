import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { SignJWT } from "jose";
import WebSocket from "ws";
import { createBoardServer, type BoardServer } from "../src/server.ts";

const SECRET = "test-whiteboard-secret-0123456789abcdef";
const ORIGIN = "http://localhost:5173";

async function token(sub: string, sid: string, role = "teacher", mode = "main", secret = SECRET, expSeconds = 3600) {
  return new SignJWT({ sid, role, mode })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSeconds)
    .sign(new TextEncoder().encode(secret));
}

/** Mở kết nối và gom các tin nhận được; tiện cho việc chờ tin cụ thể. */
function connect(port: number, origin = ORIGIN) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
  const inbox: any[] = [];
  const waiters: Array<{ pred: (m: any) => boolean; resolve: (m: any) => void }> = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    inbox.push(msg);
    for (const w of [...waiters]) {
      if (w.pred(msg)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve(msg);
      }
    }
  });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
  const next = (pred: (m: any) => boolean, ms = 2000) =>
    new Promise<any>((resolve, reject) => {
      const found = inbox.find(pred);
      if (found) return resolve(found);
      const timer = setTimeout(() => reject(new Error("timeout chờ tin nhắn")), ms);
      waiters.push({ pred, resolve: (m) => (clearTimeout(timer), resolve(m)) });
    });
  const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
  return { ws, inbox, opened, next, closed };
}

describe("whiteboard-sync server", () => {
  let board: BoardServer;
  let port: number;

  before(async () => {
    board = createBoardServer({ port: 0, jwtSecret: SECRET, allowedOrigins: [ORIGIN], roomLingerMs: 50 });
    port = await board.listen(0);
  });
  after(async () => {
    await board.close();
  });

  it("đồng bộ nét vẽ giữa hai thiết bị cùng buổi học", async () => {
    const a = connect(port);
    const b = connect(port);
    await Promise.all([a.opened, b.opened]);
    a.ws.send(JSON.stringify({ type: "auth", token: await token("teacher-1", "s1") }));
    b.ws.send(JSON.stringify({ type: "auth", token: await token("student-1", "s1", "student") }));
    await a.next((m) => m.type === "init");
    await b.next((m) => m.type === "init");

    a.ws.send(JSON.stringify({ type: "update", elements: [{ id: "x", version: 1, versionNonce: 7, type: "freedraw" }] }));
    const got = await b.next((m) => m.type === "update");
    assert.equal(got.elements[0].id, "x");
    assert.equal(got.from, "teacher-1");
    a.ws.close();
    b.ws.close();
  });

  it("người vào sau nhận lại toàn bộ nội dung bảng", async () => {
    const a = connect(port);
    await a.opened;
    a.ws.send(JSON.stringify({ type: "auth", token: await token("teacher-1", "s2") }));
    await a.next((m) => m.type === "init");
    a.ws.send(JSON.stringify({ type: "update", elements: [{ id: "y", version: 1, versionNonce: 1 }] }));
    await new Promise((r) => setTimeout(r, 50));

    const late = connect(port);
    await late.opened;
    late.ws.send(JSON.stringify({ type: "auth", token: await token("student-1", "s2", "student") }));
    const init = await late.next((m) => m.type === "init");
    assert.deepEqual(init.elements.map((e: any) => e.id), ["y"]);
    a.ws.close();
    late.ws.close();
  });

  it("không gửi nét vẽ sang buổi học khác", async () => {
    const a = connect(port);
    const other = connect(port);
    await Promise.all([a.opened, other.opened]);
    a.ws.send(JSON.stringify({ type: "auth", token: await token("t", "s3") }));
    other.ws.send(JSON.stringify({ type: "auth", token: await token("t2", "s4") }));
    await a.next((m) => m.type === "init");
    await other.next((m) => m.type === "init");

    a.ws.send(JSON.stringify({ type: "update", elements: [{ id: "z", version: 1, versionNonce: 1 }] }));
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(other.inbox.some((m) => m.type === "update"), false);
    a.ws.close();
    other.ws.close();
  });

  it("đóng kết nối khi token sai chữ ký", async () => {
    const c = connect(port);
    await c.opened;
    c.ws.send(JSON.stringify({ type: "auth", token: await token("u", "s5", "teacher", "main", "wrong-secret-wrong-secret-wrong-secret!") }));
    assert.equal(await c.closed, 4401);
  });

  it("đóng kết nối khi token hết hạn", async () => {
    const c = connect(port);
    await c.opened;
    c.ws.send(JSON.stringify({ type: "auth", token: await token("u", "s6", "teacher", "main", SECRET, -10) }));
    assert.equal(await c.closed, 4401);
  });

  it("đóng kết nối khi gửi dữ liệu trước khi xác thực", async () => {
    const c = connect(port);
    await c.opened;
    c.ws.send(JSON.stringify({ type: "update", elements: [] }));
    assert.equal(await c.closed, 4401);
  });

  it("từ chối Origin lạ", async () => {
    const c = connect(port, "https://evil.example");
    await assert.rejects(c.opened, /403/);
  });

  it("báo số người trong phòng khi có người vào/ra", async () => {
    const a = connect(port);
    await a.opened;
    a.ws.send(JSON.stringify({ type: "auth", token: await token("t", "s7") }));
    await a.next((m) => m.type === "init");

    const b = connect(port);
    await b.opened;
    b.ws.send(JSON.stringify({ type: "auth", token: await token("s", "s7", "student") }));
    await b.next((m) => m.type === "init");
    const two = await a.next((m) => m.type === "peers" && m.count === 2);
    assert.equal(two.count, 2);

    b.ws.close();
    const one = await a.next((m) => m.type === "peers" && m.count === 1);
    assert.equal(one.count, 1);
    a.ws.close();
  });
});

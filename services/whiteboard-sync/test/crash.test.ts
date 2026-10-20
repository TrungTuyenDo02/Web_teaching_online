import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, it, type TestContext } from "node:test";
import { SignJWT } from "jose";
import WebSocket from "ws";

// Lỗi P1 (review-2026-10-20): yêu cầu lỗi trước xác thực làm sập cả tiến trình máy chủ bảng.
// Máy chủ thử chạy trong tiến trình con để thấy được tiến trình chết (mã thoát), không chỉ một test lỗi.
const SECRET = "crash-test-secret-0123456789abcdef0123";
const ORIGIN = "http://localhost:5173";
const CHILD = fileURLToPath(new URL("./fixtures/board-child.ts", import.meta.url));
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // bằng giới hạn trong src/server.ts

const sign = (claims: Record<string, unknown>, sub?: string) => {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m");
  return (sub ? jwt.setSubject(sub) : jwt).sign(new TextEncoder().encode(SECRET));
};
const boardToken = (sub: string, sid: string, role: string) => sign({ sid, role, mode: "main" }, sub);
const closeToken = (sid: string, act = "close") => sign({ sid, act });

interface Child {
  port: number;
  exitInfo: () => string | null;
  stderr: () => string;
}

/** Chạy máy chủ thử; luôn dọn tiến trình và thư mục dữ liệu khi test kết thúc, kể cả khi test lỗi. */
async function startChild(t: TestContext): Promise<Child> {
  const dataDir = mkdtempSync(join(tmpdir(), "board-crash-"));
  // Bỏ cờ của test runner, giữ loader TypeScript (tsx hoặc --experimental-transform-types)
  const execArgv = process.execArgv.filter((arg) => !arg.startsWith("--test"));
  const child = spawn(process.execPath, [...execArgv, CHILD], {
    env: { ...process.env, TEST_BOARD_SECRET: SECRET, TEST_BOARD_DATA_DIR: dataDir },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let exitInfo: string | null = null;
  child.stderr.on("data", (d) => (stderr += d));
  child.on("exit", (code, signal) => (exitInfo = `mã thoát ${code}, tín hiệu ${signal}`));
  t.after(async () => {
    if (exitInfo === null) {
      child.stdin.end();
      child.kill();
      await once(child, "exit");
    }
    rmSync(dataDir, { recursive: true, force: true });
  });

  const port = await new Promise<number>((resolve, reject) => {
    let out = "";
    const timer = setTimeout(() => reject(new Error(`máy chủ thử không báo cổng sau 10 s\n${stderr}`)), 10_000);
    child.stdout.on("data", (d) => {
      out += d;
      if (!out.includes("\n")) return;
      clearTimeout(timer);
      resolve(JSON.parse(out.split("\n")[0] ?? "").port);
    });
    child.once("exit", () => (clearTimeout(timer), reject(new Error(`máy chủ thử thoát khi khởi động\n${stderr}`))));
  });
  return { port, exitInfo: () => exitInfo, stderr: () => stderr };
}

/** Tiến trình còn sống và /health trả 200 (chờ một chút để lỗi bất đồng bộ kịp làm sập nếu có). */
async function assertAlive(h: Child, after: string) {
  await delay(300);
  assert.equal(h.exitInfo(), null, `máy chủ thử đã chết sau ${after} (${h.exitInfo()})\n${h.stderr()}`);
  const res = await fetch(`http://127.0.0.1:${h.port}/health`);
  assert.equal(res.status, 200, `/health sau ${after}`);
}

function post(port: number, path: string, token?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "POST", path, timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    if (token) req.setHeader("authorization", `Bearer ${token}`);
    req.on("timeout", () => req.destroy(new Error(`quá giờ chờ ${path}`)));
    req.on("error", reject);
    req.end();
  });
}

/** Mở WebSocket, gom tin nhắn; `next` chờ tin khớp điều kiện. */
async function connect(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: ORIGIN });
  ws.on("error", () => {}); // phía thử: máy chủ đóng ngang là chuyện đang kiểm, không phải lỗi test
  const inbox: any[] = [];
  ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
  const closed = new Promise<number>((resolve) => ws.once("close", resolve));
  await once(ws, "open");
  const next = async (pred: (m: any) => boolean, ms = 3000) => {
    for (const end = Date.now() + ms; Date.now() < end; await delay(20)) {
      const found = inbox.find(pred);
      if (found) return found;
    }
    throw new Error("quá giờ chờ tin nhắn");
  };
  return { ws, next, closed };
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, delay(ms).then(() => Promise.reject(new Error(`quá giờ: ${what}`)))]);

/** Một phòng hợp lệ vẫn đồng bộ nét giữa giáo viên và học sinh. */
async function assertRoomSyncs(port: number, sid: string) {
  const teacher = await connect(port);
  const student = await connect(port);
  teacher.ws.send(JSON.stringify({ type: "auth", token: await boardToken("t1", sid, "teacher") }));
  student.ws.send(JSON.stringify({ type: "auth", token: await boardToken("s1", sid, "student") }));
  await teacher.next((m) => m.type === "init");
  await student.next((m) => m.type === "init");
  const element = { id: `net-${sid}`, version: 1, versionNonce: 1, type: "freedraw" };
  teacher.ws.send(JSON.stringify({ type: "update", elements: [element] }));
  const got = await student.next((m) => m.type === "update");
  assert.equal(got.elements[0].id, element.id);
  teacher.ws.close();
  student.ws.close();
}

describe("máy chủ bảng không chết vì yêu cầu lỗi", () => {
  it("URL sai mã hóa ở close/purge trả 400, xác thực token giữ nguyên", { timeout: 30_000 }, async (t) => {
    const h = await startChild(t);
    const bad = ["/rooms/%/close", "/rooms/%/purge", "/rooms/%E0%A4%A/close", "/rooms/a%ZZ/purge"];
    for (const path of bad) {
      for (const token of [undefined, await closeToken("%", path.endsWith("purge") ? "purge" : "close")]) {
        // Kết nối bị ngắt thì báo rõ tiến trình đã chết (mã thoát, stderr) thay vì chỉ ECONNRESET
        const status = await post(h.port, path, token).catch(async (err) => {
          await assertAlive(h, `POST ${path}`);
          throw err;
        });
        assert.equal(status, 400, path);
        await assertAlive(h, `POST ${path}${token ? " có token" : ""}`);
      }
    }

    // Xác thực và kiểm tra token thuộc buổi học không đổi
    assert.equal(await post(h.port, "/rooms/s-a/close"), 401, "thiếu token");
    assert.equal(await post(h.port, "/rooms/s-a/close", await closeToken("s-b")), 401, "token buổi khác");
    assert.equal(await post(h.port, "/rooms/s-a/purge", await closeToken("s-a")), 401, "token close dùng cho purge");
    assert.equal(await post(h.port, "/rooms/s-a/close", await boardToken("t1", "s-a", "teacher")), 401, "token vào phòng");
    // Id mã hóa trên URL (%73 = "s"): giải mã đúng rồi mới so với token
    assert.equal(await post(h.port, "/rooms/%73-a/close", await closeToken("s-a")), 200);
    assert.equal(await post(h.port, "/rooms/%73-a/purge", await closeToken("s-a", "purge")), 204);
    await assertAlive(h, "các yêu cầu hợp lệ");
    await assertRoomSyncs(h.port, "s-sync-url");
  });

  it("gói WebSocket vượt 5 MiB: đóng đúng kết nối đó, máy chủ và phòng khác vẫn chạy", { timeout: 30_000 }, async (t) => {
    const h = await startChild(t);
    const oversized = Buffer.alloc(MAX_PAYLOAD_BYTES + 1, 0x61);

    // Trước xác thực
    const anon = await connect(h.port);
    anon.ws.send(oversized);
    assert.equal(await withTimeout(anon.closed, 5000, "đóng kết nối chưa xác thực"), 1009);
    await assertAlive(h, "gói quá lớn trước xác thực");

    // Sau xác thực, đang ở trong phòng có người khác
    const teacher = await connect(h.port);
    const student = await connect(h.port);
    teacher.ws.send(JSON.stringify({ type: "auth", token: await boardToken("t1", "s-big", "teacher") }));
    student.ws.send(JSON.stringify({ type: "auth", token: await boardToken("s1", "s-big", "student") }));
    await teacher.next((m) => m.type === "init");
    await student.next((m) => m.type === "init");
    student.ws.send(oversized);
    assert.equal(await withTimeout(student.closed, 5000, "đóng kết nối đã xác thực"), 1009);
    await teacher.next((m) => m.type === "peers" && m.count === 1);
    assert.equal(teacher.ws.readyState, WebSocket.OPEN, "kết nối của người khác trong phòng không bị đóng");
    teacher.ws.close();
    await assertAlive(h, "gói quá lớn sau xác thực");

    // Gói đúng bằng giới hạn vẫn được nhận (JSON sai thì đóng 4400 như trước, không phải 1009)
    const atLimit = await connect(h.port);
    atLimit.ws.send(Buffer.alloc(MAX_PAYLOAD_BYTES, 0x61));
    assert.equal(await withTimeout(atLimit.closed, 5000, "đóng gói đúng giới hạn"), 4400);

    await assertAlive(h, "gói đúng giới hạn");
    await assertRoomSyncs(h.port, "s-sync-ws");
  });
});

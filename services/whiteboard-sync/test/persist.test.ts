import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { SignJWT } from "jose";
import WebSocket from "ws";
import { createBoardServer } from "../src/server.ts";
import { SceneStore } from "../src/store.ts";

const SECRET = "test-whiteboard-secret-0123456789abcdef";
const ORIGIN = "http://localhost:5173";
const SID = "11111111-2222-3333-4444-555555555555";
const dir = mkdtempSync(join(tmpdir(), "board-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const sign = (claims: Record<string, unknown>) =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + 60)
    .sign(new TextEncoder().encode(SECRET));

const config = () => ({
  port: 0,
  jwtSecret: SECRET,
  allowedOrigins: [ORIGIN],
  roomLingerMs: 50,
  dataDir: dir,
  saveDelayMs: 20,
});

/** Vào phòng với vai trò giáo viên, trả về socket và tin init. */
async function joinAsTeacher(port: number) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: ORIGIN });
  await new Promise((resolve) => ws.once("open", resolve));
  const init = new Promise<any>((resolve) =>
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "init") resolve(msg);
    }),
  );
  ws.send(JSON.stringify({ type: "auth", token: await sign({ sub: "t", sid: SID, role: "teacher", mode: "main" }) }));
  return { ws, init: await init };
}

/** Mở kết nối với token cho trước; `closed` là mã đóng (4410 = buổi đã kết thúc). */
async function joinWith(port: number, token: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: ORIGIN });
  const closed = new Promise<number>((resolve) => ws.once("close", resolve));
  const init = new Promise<void>((resolve) => ws.once("message", () => resolve()));
  await new Promise((resolve) => ws.once("open", resolve));
  ws.send(JSON.stringify({ type: "auth", token }));
  return { ws, closed, init };
}

const closeRoom = async (port: number, sid: string) =>
  fetch(`http://127.0.0.1:${port}/rooms/${sid}/close`, {
    method: "POST",
    headers: { authorization: `Bearer ${await sign({ sid, act: "close" })}` },
  });

const purgeRoom = async (port: number, sid: string, act = "purge") =>
  fetch(`http://127.0.0.1:${port}/rooms/${sid}/purge`, {
    method: "POST",
    headers: { authorization: `Bearer ${await sign({ sid, act })}` },
  });

describe("lưu bảng xuống đĩa", { timeout: 5000 }, () => {
  it("máy chủ khởi động lại vẫn còn nội dung bảng; đóng phòng trả về nội dung cuối", async () => {
    const first = createBoardServer(config());
    const port1 = await first.listen(0);
    const a = await joinAsTeacher(port1);
    a.ws.send(JSON.stringify({ type: "update", elements: [{ id: "x", version: 1, versionNonce: 1, type: "line" }] }));
    await new Promise((r) => setTimeout(r, 100)); // quá saveDelayMs
    a.ws.terminate();
    await first.close(); // như máy chủ bị khởi động lại

    const second = createBoardServer(config());
    const port2 = await second.listen(0);
    const b = await joinAsTeacher(port2);
    assert.deepEqual(b.init.elements.map((e: any) => e.id), ["x"]);

    const resp = await fetch(`http://127.0.0.1:${port2}/rooms/${SID}/close`, {
      method: "POST",
      headers: { authorization: `Bearer ${await sign({ sid: SID, act: "close" })}` },
    });
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as { elements: { id: string }[] };
    assert.deepEqual(body.elements.map((e) => e.id), ["x"]);
    b.ws.terminate();
    await second.close();
  });

  it("đóng phòng rồi khởi động lại: token cũ còn hạn vẫn bị từ chối, đóng lại vẫn trả bản cuối", async () => {
    const sid = "22222222-0000-0000-0000-000000000001";
    const teacherToken = await sign({ sub: "t", sid, role: "teacher", mode: "main" });
    const first = createBoardServer(config());
    const port1 = await first.listen(0);
    const a = await joinWith(port1, teacherToken);
    await a.init;
    a.ws.send(JSON.stringify({ type: "update", elements: [{ id: "cuoi", version: 1, versionNonce: 1, type: "line" }] }));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await closeRoom(port1, sid)).status, 200);
    assert.equal(await a.closed, 4410);
    await first.close();

    const second = createBoardServer(config());
    const port2 = await second.listen(0);
    const again = await joinWith(port2, teacherToken);
    assert.equal(await again.closed, 4410);
    // API gọi đóng lần nữa (thử lại sau lỗi): vẫn lấy được bản cuối
    const resp = await closeRoom(port2, sid);
    assert.equal(resp.status, 200);
    assert.deepEqual(((await resp.json()) as any).elements.map((e: any) => e.id), ["cuoi"]);
    assert.equal(second.hub.roomCount, 0);
    await second.close();
  });

  it("nét đến sau lúc đóng không mở lại phòng và không ghi đè bản cuối", async () => {
    const sid = "22222222-0000-0000-0000-000000000002";
    const board = createBoardServer(config());
    const port = await board.listen(0);
    const a = await joinWith(port, await sign({ sub: "t", sid, role: "teacher", mode: "main" }));
    await a.init;
    a.ws.send(JSON.stringify({ type: "update", elements: [{ id: "truoc", version: 1, versionNonce: 1 }] }));
    await new Promise((r) => setTimeout(r, 50));
    // Đóng trực tiếp ở hub: socket của giáo viên chưa bị ngắt, như tin đang trên đường
    assert.deepEqual(board.hub.end(sid).map((e) => e.id), ["truoc"]);
    a.ws.send(JSON.stringify({ type: "update", elements: [{ id: "sau", version: 1, versionNonce: 1 }] }));
    await new Promise((r) => setTimeout(r, 100)); // quá saveDelayMs
    assert.equal(board.hub.roomCount, 0);
    assert.deepEqual(new SceneStore(dir).load(sid).map((e) => e.id), ["truoc"]);
    a.ws.terminate();
    await board.close();
  });

  it("lỗi ghi đĩa lúc đóng: trả 500 thay vì báo thành công, vẫn ngắt và chặn; sửa xong gọi lại thì lưu được", async () => {
    const sid = "22222222-0000-0000-0000-000000000003";
    const teacherToken = await sign({ sub: "t", sid, role: "teacher", mode: "main" });
    const board = createBoardServer(config());
    const port = await board.listen(0);
    const a = await joinWith(port, teacherToken);
    await a.init;
    a.ws.send(JSON.stringify({ type: "update", elements: [{ id: "x", version: 1, versionNonce: 1 }] }));
    await new Promise((r) => setTimeout(r, 50));
    const blocker = join(dir, `${sid}.json.tmp`); // thư mục trùng tên file tạm: ghi sẽ lỗi
    mkdirSync(blocker);
    const failed = await closeRoom(port, sid);
    assert.equal(failed.status, 500);
    assert.equal(await a.closed, 4410);
    assert.equal(await (await joinWith(port, teacherToken)).closed, 4410);
    // dấu đóng đã ghi dù bảng chưa lưu được: restart trước lần gọi lại vẫn chặn token cũ
    assert.equal(new SceneStore(dir).isEnded(sid), true);

    rmSync(blocker, { recursive: true });
    const ok = await closeRoom(port, sid);
    assert.equal(ok.status, 200);
    assert.deepEqual(((await ok.json()) as any).elements.map((e: any) => e.id), ["x"]);
    await board.close();

    const restarted = createBoardServer(config());
    const port2 = await restarted.listen(0);
    assert.equal(await (await joinWith(port2, teacherToken)).closed, 4410);
    assert.deepEqual(new SceneStore(dir).load(sid).map((e) => e.id), ["x"]);
    await restarted.close();
  });

  it("xóa dữ liệu bảng (xóa học sinh): xóa scene, giữ dấu đóng; token cũ bị chặn cả sau restart", async () => {
    const sid = "22222222-0000-0000-0000-000000000004";
    const teacherToken = await sign({ sub: "t", sid, role: "teacher", mode: "main" });
    const scene = join(dir, `${sid}.json`);
    const board = createBoardServer(config());
    const port = await board.listen(0);
    const a = await joinWith(port, teacherToken);
    await a.init;
    a.ws.send(JSON.stringify({ type: "update", elements: [{ id: "bai-lam", version: 1, versionNonce: 1 }] }));
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(existsSync(scene));
    // nét mới đang chờ ghi (chưa quá saveDelayMs) lúc xóa: không được ghi lại file sau đó
    a.ws.send(JSON.stringify({ type: "update", elements: [{ id: "net-cuoi", version: 1, versionNonce: 1 }] }));
    await new Promise((r) => setTimeout(r, 5));

    // token đóng phòng không dùng để xóa được
    assert.equal((await purgeRoom(port, sid, "close")).status, 401);
    assert.equal((await purgeRoom(port, sid)).status, 204);
    assert.equal(await a.closed, 4410);
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(!existsSync(scene) && !existsSync(`${scene}.tmp`));
    assert.equal((await purgeRoom(port, sid)).status, 204); // gọi lại được
    await board.close();

    const restarted = createBoardServer(config());
    const port2 = await restarted.listen(0);
    assert.equal(await (await joinWith(port2, teacherToken)).closed, 4410);
    const closed = await closeRoom(port2, sid);
    assert.deepEqual(((await closed.json()) as any).elements, []); // finalize muộn không lấy lại được bài
    assert.ok(!existsSync(scene));
    await restarted.close();
  });

  it("không cho id buổi học lạ thoát khỏi thư mục dữ liệu", () => {
    const store = new SceneStore(dir);
    assert.throws(() => store.save("../ngoai", []));
    assert.throws(() => store.load("a/b"));
  });
});

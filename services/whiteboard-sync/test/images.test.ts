import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SignJWT } from "jose";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import WebSocket from "ws";
import { createBoardServer } from "../src/server.ts";
import { BoardConnection, type SyncElement } from "../../../apps/web/src/lib/boardConnection.ts";

const SECRET = "test-image-secret-012345678901234567890";
const ORIGIN = "http://localhost:5173";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
const sign = (payload: Record<string, unknown>) => new SignJWT(payload)
  .setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(new TextEncoder().encode(SECRET));

async function fixture(t: any) {
  const dir = mkdtempSync(join(tmpdir(), "board-images-"));
  const config = { port: 0, jwtSecret: SECRET, allowedOrigins: [ORIGIN], roomLingerMs: 100, dataDir: dir, saveDelayMs: 10 };
  let board = createBoardServer(config);
  let port = await board.listen(0);
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const ws of sockets) ws.terminate(); await board.close(); rmSync(dir, { recursive: true, force: true }); });
  async function connect(sid = "image-room", role = "teacher") {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin: ORIGIN });
    sockets.push(ws);
    const messages: any[] = [];
    ws.on("message", raw => messages.push(JSON.parse(raw.toString())));
    await new Promise(resolve => ws.once("open", resolve));
    ws.send(JSON.stringify({ type: "auth", token: await sign({ sub: role, sid, role, mode: "board" }) }));
    const wait = async (type: string) => {
      const until = Date.now() + 1800;
      while (Date.now() < until) {
        const at = messages.findIndex(m => m.type === type);
        if (at >= 0) return messages.splice(at, 1)[0];
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error(`Không nhận được ${type}`);
    };
    return { ws, wait, init: await wait("init"), messages };
  }
  const upload = (ws: WebSocket, data = PNG, uploadId = "upload-1", mimeType = "image/png") =>
    ws.send(JSON.stringify({ type: "file_chunk", uploadId, mimeType, offset: 0, total: data.length, data }));
  const control = async (sid: string, act: string) => fetch(`http://127.0.0.1:${port}/rooms/${sid}/${act}`, {
    method: "POST", headers: { Authorization: `Bearer ${await sign({ sid, act })}` },
  });
  return { connect, upload, control, dir, async restart() {
    for (const ws of sockets) ws.terminate(); await board.close();
    board = createBoardServer(config); port = await board.listen(0);
  } };
}

test("ảnh giáo viên được nhận ở máy học sinh, restart và đóng lại vẫn đủ ảnh", { timeout: 8000 }, async t => {
  const f = await fixture(t);
  const teacher = await f.connect();
  const student = await f.connect("image-room", "student");
  f.upload(teacher.ws);
  const ack = await teacher.wait("file_ack");
  assert.match(ack.id, /^[a-f0-9]{64}$/);
  const received = await student.wait("file_data");
  assert.equal(received.data, PNG);
  assert.equal(received.id, ack.id);
  teacher.ws.send(JSON.stringify({ type: "update", elements: [{ id: "picture", type: "image", fileId: ack.id, version: 1, versionNonce: 1 }] }));
  assert.equal((await student.wait("update")).elements[0].fileId, ack.id);
  await f.restart();
  const restored = await f.connect();
  assert.deepEqual(restored.init.fileIds, [ack.id]);
  assert.equal((await restored.wait("file_data")).data, PNG);
  const closed = await f.control("image-room", "close");
  assert.equal(closed.status, 200);
  const snapshot = await closed.json() as any;
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.files[ack.id].dataURL, `data:image/png;base64,${PNG}`);
  assert.equal(snapshot.elements[0].fileId, ack.id);
  assert.deepEqual(await (await f.control("image-room", "close")).json(), snapshot);
});

test("ảnh được cách ly theo phòng và học sinh không tải được", { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const student = await f.connect("image-room", "student");
  f.upload(student.ws);
  assert.equal((await student.wait("file_error")).message, "Chỉ giáo viên được chèn ảnh.");
  const teacher = await f.connect();
  f.upload(teacher.ws);
  const ack = await teacher.wait("file_ack");
  const other = await f.connect("other-room");
  assert.deepEqual(other.init.fileIds, []);
  other.ws.send(JSON.stringify({ type: "update", elements: [{ id: "cross", type: "image", fileId: ack.id, version: 1, versionNonce: 1 }] }));
  await other.wait("update_error");
  const closed = await (await f.control("other-room", "close")).json() as any;
  assert.deepEqual(closed.elements, []);
});

test("từ chối ảnh giả/quá lớn, purge giữa lượt tải không tái tạo file", { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const teacher = await f.connect();
  f.upload(teacher.ws, PNG, "bad", "image/jpeg");
  await teacher.wait("file_error");
  teacher.ws.send(JSON.stringify({ type: "file_chunk", uploadId: "big", mimeType: "image/png", offset: 0, total: 4_000_000, data: PNG }));
  await teacher.wait("file_error");
  teacher.ws.send(JSON.stringify({ type: "file_chunk", uploadId: "partial", mimeType: "image/png", offset: 0, total: PNG.length, data: PNG.slice(0, 20) }));
  assert.equal((await f.control("image-room", "purge")).status, 204);
  await f.restart();
  const snapshot = await (await f.control("image-room", "close")).json() as any;
  assert.deepEqual(snapshot.elements, []);
  assert.equal(snapshot.files, undefined);
});

test("web client nhận files trước khi hiển thị ảnh, nối lại vẫn giữ ảnh", { timeout: 8000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), "image-client-"));
  const server = createBoardServer({ port: 0, jwtSecret: SECRET, allowedOrigins: [], roomLingerMs: 50, dataDir: dir, saveDelayMs: 10 });
  const port = await server.listen(0);
  const connections: BoardConnection[] = [];
  t.after(async () => { for (const c of connections) c.stop(); await server.close(); rmSync(dir, { recursive: true, force: true }); });
  const until = async (condition: () => boolean) => {
    const end = Date.now() + 2500;
    while (!condition()) { if (Date.now() > end) throw new Error("client timeout"); await new Promise(r => setTimeout(r, 10)); }
  };
  const connect = async (role: string) => {
    const files: Record<string, any> = {};
    const elements: SyncElement[] = [];
    let online = false;
    const c = new BoardConnection(`ws://127.0.0.1:${port}`, await sign({ sub: role, role, sid: "client-image", mode: "board" }), {
      elements: () => elements,
      files: () => files,
      applyFiles: received => { for (const f of received) files[f.id] = f; },
      applyRemote: received => {
        for (const el of received) {
          if (el.type === "image") assert.ok(files[String(el.fileId)], "ảnh phải có dữ liệu trước khi apply");
          if (!elements.some(e => e.id === el.id)) elements.push(el);
        }
      },
    }, { onStatus: s => { online = s === "online"; }, onPeers: () => {} }, { retryBaseMs: 20 });
    connections.push(c); c.start(); await until(() => online);
    return { c, files, elements, online: () => online };
  };
  const teacher = await connect("teacher"), student = await connect("student");
  const file = await teacher.c.uploadFile({ mimeType: "image/png", dataURL: `data:image/png;base64,${PNG}` });
  teacher.elements.push({ id: "photo", type: "image", fileId: file.id, version: 1, versionNonce: 1 });
  teacher.c.flush();
  await until(() => student.elements.length === 1);
  assert.equal(student.files[file.id].dataURL, file.dataURL);
  for (const peer of server.hub.peersOf("client-image")) peer.socket.terminate();
  await until(() => !teacher.online()); await until(teacher.online);
  const later = await connect("student");
  await until(() => later.elements.length === 1);
  assert.equal(later.files[file.id].dataURL, file.dataURL);
});

test("PNG sai checksum không được ACK hoặc ghi vào snapshot", { timeout: 5000 }, async t => {
  const f = await fixture(t), teacher = await f.connect();
  const corrupted = Buffer.from(PNG, "base64");
  corrupted[29] = corrupted[29]! ^ 1; // CRC của IHDR: ảnh có đúng chữ ký nhưng nội dung hỏng
  f.upload(teacher.ws, corrupted.toString("base64"));
  await teacher.wait("file_error");
  assert.equal(teacher.messages.some(m => m.type === "file_ack"), false);
  assert.equal((await (await f.control("image-room", "close")).json() as any).files, undefined);
});

test("JPEG thiếu dữ liệu quét không được lưu để tránh snapshot không thể finalize", { timeout: 5000 }, async t => {
  const f = await fixture(t), teacher = await f.connect();
  f.upload(teacher.ws, Buffer.from("ffd8ffc00008080001000100ffd9", "hex").toString("base64"), "broken-jpeg", "image/jpeg");
  await teacher.wait("file_error");
  assert.equal(teacher.messages.some(m => m.type === "file_ack"), false);
});

test("ảnh chia nhiều mảnh chỉ ACK khi đủ, lỗi đĩa không ACK và thử lại được", { timeout: 5000 }, async t => {
  const f = await fixture(t), teacher = await f.connect();
  teacher.ws.send(JSON.stringify({ type: "file_chunk", uploadId: "parts", mimeType: "image/png", offset: 0, total: PNG.length, data: PNG.slice(0, 20) }));
  teacher.ws.send(JSON.stringify({ type: "ping", n: 9 }));
  await teacher.wait("pong");
  assert.equal(teacher.messages.some(m => m.type === "file_ack"), false);
  teacher.ws.send(JSON.stringify({ type: "file_chunk", uploadId: "parts", mimeType: "image/png", offset: 20, total: PNG.length, data: PNG.slice(20) }));
  await teacher.wait("file_ack");
  const other = await f.connect("disk-error");
  const id = createHash("sha256").update(Buffer.from(PNG, "base64")).digest("hex");
  const block = join(f.dir, "disk-error.images", `${id}.json.tmp`);
  mkdirSync(block, { recursive: true });
  f.upload(other.ws); await other.wait("file_error");
  assert.equal(other.messages.some(m => m.type === "file_ack"), false);
  // block được dựng từ thư mục tạm fixture + hash, không phải đường dẫn của ứng dụng thật.
  rmSync(block, { recursive: true });
  f.upload(other.ws); await other.wait("file_ack");
});

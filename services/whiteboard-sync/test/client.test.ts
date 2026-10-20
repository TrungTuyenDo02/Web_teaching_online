// Web client (apps/web/src/lib/boardConnection.ts) chạy với máy chủ bảng thật: mất mạng, máy chủ
// khởi động lại, bảng lớn, xung đột phiên bản. Scene giả gộp theo cùng quy tắc với Excalidraw.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { SignJWT } from "jose";
import {
  BoardConnection,
  MAX_BATCH_BYTES,
  toBatches,
  type BoardScene,
  type BoardStatus,
  type SyncElement,
} from "../../../apps/web/src/lib/boardConnection.ts";
import { shouldAccept, type BoardElement } from "../src/scene.ts";
import { createBoardServer, type BoardServer } from "../src/server.ts";

const SECRET = "test-whiteboard-secret-0123456789abcdef";
const SID = "33333333-0000-0000-0000-000000000001";

type El = SyncElement & { isDeleted?: boolean; data?: string };

class FakeScene implements BoardScene {
  readonly map = new Map<string, El>();
  elements() {
    return [...this.map.values()];
  }
  applyRemote(remote: SyncElement[]) {
    for (const el of remote as BoardElement[]) {
      if (shouldAccept(this.map.get(el.id) as BoardElement | undefined, el)) this.map.set(el.id, el as El);
    }
  }
  draw(id: string, version = 1, versionNonce = 1, extra: Partial<El> = {}) {
    this.map.set(id, { id, version, versionNonce, type: "freedraw", ...extra });
  }
}

const sign = (sub: string, role = "teacher", expSeconds = 600) =>
  new SignJWT({ sid: SID, role, mode: "main" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSeconds)
    .sign(new TextEncoder().encode(SECRET));

const servers: BoardServer[] = [];
const conns: BoardConnection[] = [];
after(async () => {
  for (const c of conns) c.stop();
  for (const s of servers) await s.close();
});

async function startServer(port = 0) {
  const board = createBoardServer({ port, jwtSecret: SECRET, allowedOrigins: [], roomLingerMs: 50 });
  servers.push(board);
  return { board, port: await board.listen(port) };
}

async function connect(port: number, token: string, scene = new FakeScene()) {
  const statuses: BoardStatus[] = [];
  const conn = new BoardConnection(
    `ws://127.0.0.1:${port}`,
    token,
    scene,
    { onStatus: (s) => statuses.push(s), onPeers: () => {} },
    { retryBaseMs: 20, maxRetryMs: 100 },
  );
  conns.push(conn);
  conn.start();
  await until(() => statuses.at(-1) === "online");
  return { conn, scene, statuses };
}

async function until(cond: () => boolean, ms = 4000) {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("hết giờ chờ điều kiện");
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** Ngắt mạng phía máy chủ đối với mọi thiết bị đang trong buổi. */
const dropAll = (board: BoardServer) => {
  for (const peer of board.hub.peersOf(SID)) peer.socket.terminate();
};

describe("web client với máy chủ bảng", { timeout: 20_000 }, () => {
  it("bảng 2.001 phần tử, gần 6 MB: gửi đủ theo lô, không bị máy chủ ngắt", async () => {
    const { board, port } = await startServer();
    const teacher = new FakeScene();
    for (let i = 0; i < 2001; i++) teacher.draw(`e${i}`, 1, 1, { data: "x".repeat(3000) });
    const t = await connect(port, await sign("t"), teacher);
    const viewer = await connect(port, await sign("s", "student"));
    await until(() => viewer.scene.map.size === 2001);
    assert.ok(!t.statuses.includes("offline"), "giáo viên không bị ngắt kết nối");
    t.conn.stop();
    viewer.conn.stop();
    await board.close();
  });

  it("mất mạng khi đang viết: nét vẽ lúc mất mạng được gửi bù khi nối lại", async () => {
    const { board, port } = await startServer();
    const t = await connect(port, await sign("t"));
    const viewer = await connect(port, await sign("s", "student"));
    t.scene.draw("a");
    t.conn.flush();
    await until(() => viewer.scene.map.has("a"));

    dropAll(board);
    await until(() => t.statuses.at(-1) !== "online");
    t.scene.draw("b"); // viết tiếp trong lúc mất mạng
    t.conn.flush(); // chưa có kết nối: không gửi được, không coi là đã gửi
    await until(() => viewer.scene.map.has("b"));
    assert.equal(t.statuses.at(-1), "online");
    await board.close();
  });

  it("máy chủ khởi động lại trước khi kịp lưu: máy giáo viên gửi lại toàn bộ", async () => {
    const first = await startServer();
    const t = await connect(first.port, await sign("t"));
    t.scene.draw("a");
    t.scene.draw("b");
    t.conn.flush();
    await new Promise((r) => setTimeout(r, 50));
    await first.board.close(); // không có dataDir: máy chủ mới không còn gì

    const second = await startServer(first.port);
    await until(() => t.statuses.filter((s) => s === "online").length >= 2);
    const viewer = await connect(second.port, await sign("s", "student"));
    await until(() => viewer.scene.map.size === 2);
    await second.board.close();
  });

  it("máy khác xóa nét lúc máy này mất mạng: nối lại thì hội tụ, không hồi sinh nét đã xóa", async () => {
    const { board, port } = await startServer();
    const laptop = await connect(port, await sign("laptop"));
    const tablet = await connect(port, await sign("tablet"));
    laptop.scene.draw("x");
    laptop.conn.flush();
    await until(() => tablet.scene.map.has("x"));

    for (const peer of board.hub.peersOf(SID)) if (peer.claims.sub === "laptop") peer.socket.terminate();
    tablet.scene.draw("x", 2, 1, { isDeleted: true });
    tablet.conn.flush();
    await until(() => laptop.scene.map.get("x")?.isDeleted === true);
    const viewer = await connect(port, await sign("s", "student"));
    assert.equal(viewer.scene.map.get("x")?.isDeleted, true);
    await board.close();
  });

  it("cùng version khác versionNonce: máy giữ bản thắng vẫn gửi nó đi, mọi máy hội tụ", async () => {
    const { board, port } = await startServer();
    const laptop = await connect(port, await sign("t"));
    const tablet = await connect(port, await sign("t"));
    laptop.scene.draw("x");
    laptop.conn.flush();
    await until(() => tablet.scene.map.has("x"));

    tablet.scene.draw("x", 2, 5); // tablet sửa, chưa kịp gửi
    laptop.scene.draw("x", 2, 9); // laptop sửa cùng lúc và gửi trước
    laptop.conn.flush();
    await new Promise((r) => setTimeout(r, 100)); // tablet nhận bản nonce 9, giữ bản nonce 5 (thắng)
    assert.equal(tablet.scene.map.get("x")?.versionNonce, 5);
    tablet.conn.flush();
    await until(() => laptop.scene.map.get("x")?.versionNonce === 5);
    const viewer = await connect(port, await sign("s", "student"));
    assert.equal(viewer.scene.map.get("x")?.versionNonce, 5);
    await board.close();
  });

  it("token hết hạn: dừng ở trạng thái hết phiên, không thử lại", async () => {
    const { board, port } = await startServer();
    const statuses: BoardStatus[] = [];
    const conn = new BoardConnection(
      `ws://127.0.0.1:${port}`,
      await sign("t", "teacher", -10),
      new FakeScene(),
      { onStatus: (s) => statuses.push(s), onPeers: () => {} },
      { retryBaseMs: 20 },
    );
    conns.push(conn);
    conn.start();
    await until(() => statuses.at(-1) === "expired");
    await new Promise((r) => setTimeout(r, 150));
    assert.deepEqual(statuses, ["connecting", "expired"]);
    await board.close();
  });

  it("phần tử quá lớn và ảnh không được gửi; phần còn lại vẫn đồng bộ, không rớt kết nối", async () => {
    const { board, port } = await startServer();
    const t = await connect(port, await sign("t"));
    const viewer = await connect(port, await sign("s", "student"));
    t.scene.draw("big", 1, 1, { data: "x".repeat(MAX_BATCH_BYTES + 10) });
    t.scene.draw("img", 1, 1, { type: "image" });
    t.scene.draw("ok");
    t.conn.flush();
    await until(() => viewer.scene.map.has("ok"));
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(!viewer.scene.map.has("big") && !viewer.scene.map.has("img"));
    assert.ok(!t.statuses.includes("offline"));
    await board.close();
  });
});

describe("toBatches", () => {
  it("chia theo số phần tử và số byte, tách phần tử quá lớn", () => {
    const els = Array.from({ length: 1200 }, (_, i) => ({ id: `e${i}`, version: 1, versionNonce: 1 }));
    const byCount = toBatches(els, 500, 1e9);
    assert.deepEqual(byCount.batches.map((b) => b.length), [500, 500, 200]);

    const fat = (id: string) => ({ id, version: 1, versionNonce: 1, data: "x".repeat(400) });
    const byBytes = toBatches([fat("a"), fat("b"), fat("c"), { ...fat("d"), data: "x".repeat(2000) }], 500, 1000);
    assert.deepEqual(byBytes.batches.map((b) => b.map((e) => e.id)), [["a", "b"], ["c"]]);
    assert.deepEqual(byBytes.oversized.map((e) => e.id), ["d"]);
  });
});

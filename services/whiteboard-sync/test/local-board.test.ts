import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, describe, it } from "node:test";
import WebSocket from "ws";
import { lanCandidates, lanError, newPairCode, startLocalBoard, type LocalBoard } from "../dev/local-board.ts";

// Máy chủ bảng thử cho trang /dev/whiteboard: dùng đúng máy chủ thật, chỉ khác cách cấp token.
const ORIGIN = "http://localhost:5173";

describe("máy chủ bảng thử cục bộ", { timeout: 30_000 }, () => {
  let local: LocalBoard;
  before(async () => {
    local = await startLocalBoard({ boardPort: 0, tokenPort: 0, linePort: 0 });
  });
  after(async () => {
    await local.close();
  });

  const tokenUrl = (q: string) => `http://127.0.0.1:${local.tokenPort}/token?${q}`;
  const getToken = async (role: string, room: string) => {
    const res = await fetch(tokenUrl(`role=${role}&room=${room}`), { headers: { origin: ORIGIN } });
    assert.equal(res.status, 200);
    return (await res.json()) as { url: string; token: string };
  };

  async function join(role: string, room: string) {
    const { url, token } = await getToken(role, room);
    const ws = new WebSocket(url, { origin: ORIGIN });
    const inbox: any[] = [];
    ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
    await once(ws, "open");
    ws.send(JSON.stringify({ type: "auth", token }));
    const next = async (pred: (m: any) => boolean, ms = 3000) => {
      for (const end = Date.now() + ms; Date.now() < end; await delay(20)) {
        const found = inbox.find(pred);
        if (found) return found;
      }
      throw new Error("quá giờ chờ tin nhắn");
    };
    await next((m) => m.type === "init");
    return { ws, inbox, next };
  }

  it("chỉ nghe 127.0.0.1, dữ liệu ở thư mục tạm", () => {
    assert.equal((local.board.server.address() as { address: string }).address, "127.0.0.1");
    assert.equal((local.tokenServer.address() as { address: string }).address, "127.0.0.1");
    assert.equal((local.proxy.server.address() as { address: string }).address, "127.0.0.1");
    assert.ok(existsSync(local.dataDir));
  });

  it("chỉ cấp token cho Origin của web dev, vai trò và phòng thử hợp lệ", async () => {
    assert.equal((await fetch(tokenUrl("role=teacher&room=dev-1"))).status, 403, "không có Origin");
    assert.equal((await fetch(tokenUrl("role=teacher&room=dev-1"), { headers: { origin: "http://evil.test" } })).status, 403);
    for (const q of ["role=admin&room=dev-1", "role=teacher&room=11111111-1111-1111-1111-111111111111", "role=teacher&room=dev-../x", "role=teacher"]) {
      assert.equal((await fetch(tokenUrl(q), { headers: { origin: ORIGIN } })).status, 400, q);
    }
    const ok = await fetch(tokenUrl("role=student&room=dev-1"), { headers: { origin: ORIGIN } });
    assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
  });

  it("--web-port đổi đúng một origin được phép", async () => {
    const alt = await startLocalBoard({ boardPort: 0, tokenPort: 0, linePort: 0, webPort: 5174 });
    try {
      const at = (origin: string) => fetch(`http://127.0.0.1:${alt.tokenPort}/token?role=teacher&room=dev-1`, { headers: { origin } });
      assert.equal((await at("http://localhost:5174")).status, 200);
      assert.equal((await at(ORIGIN)).status, 403);
    } finally {
      await alt.close();
    }
  });

  it("tạm ngắt: cắt kết nối, không nhận kết nối mới, bật lại thì token cũ và nội dung vẫn còn", async () => {
    const teacher = await join("teacher", "dev-p");
    teacher.ws.send(JSON.stringify({ type: "update", elements: [{ id: "net-p", version: 1, versionNonce: 1, type: "freedraw" }] }));
    await delay(100);
    const { url, token } = await getToken("student", "dev-p");
    const pause = (q: string) => fetch(`http://127.0.0.1:${local.tokenPort}/pause?${q}`, { method: "POST", headers: { origin: ORIGIN } });
    const closed = once(teacher.ws, "close"); // máy chủ cắt kết nối trước khi trả lời
    assert.equal((await pause("room=dev-p&seconds=0")).status, 400);
    assert.equal((await pause("room=dev-p&seconds=1")).status, 204);
    assert.equal((await pause("room=dev-p&seconds=1")).status, 409, "đang tạm ngắt");
    const [code] = await closed;
    assert.equal(code, 1006, "đóng như rớt mạng");

    const during = new WebSocket(url, { origin: ORIGIN });
    const [err] = await once(during, "error");
    // Qua proxy đường truyền: proxy nhận TCP rồi cắt vì máy chủ bảng không nhận (ECONNRESET)
    assert.match(String((err as NodeJS.ErrnoException).code), /ECONNREFUSED|ECONNRESET/);

    await delay(1300);
    const again = new WebSocket(url, { origin: ORIGIN });
    const inbox: any[] = [];
    again.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
    await once(again, "open");
    again.send(JSON.stringify({ type: "auth", token }));
    for (let i = 0; i < 100 && !inbox.some((m) => m.type === "init"); i++) await delay(20);
    assert.deepEqual(inbox.find((m) => m.type === "init")?.elements.map((e: { id: string }) => e.id), ["net-p"]);
    again.close();
  });

  it("treo đường truyền của một tab: không đóng kết nối, dữ liệu tới khi khôi phục; tab khác không bị ảnh hưởng", async () => {
    const lineToken = async (role: string, line: string) => {
      const res = await fetch(tokenUrl(`role=${role}&room=dev-h&line=${line}`), { headers: { origin: ORIGIN } });
      assert.equal(res.status, 200);
      return (await res.json()) as { url: string; token: string };
    };
    const open = async (role: string, line: string) => {
      const { url, token } = await lineToken(role, line);
      assert.match(url, new RegExp(`:${local.proxy.port}/\\?line=${line}$`), "nối qua proxy đường truyền");
      const ws = new WebSocket(url, { origin: ORIGIN });
      const inbox: any[] = [];
      let closed = false;
      ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
      ws.on("close", () => (closed = true));
      await once(ws, "open");
      ws.send(JSON.stringify({ type: "auth", token }));
      for (let i = 0; i < 100 && !inbox.some((m) => m.type === "init"); i++) await delay(20);
      return { ws, inbox, isClosed: () => closed };
    };
    const hang = (q: string) => fetch(`http://127.0.0.1:${local.tokenPort}/hang?${q}`, { method: "POST", headers: { origin: ORIGIN } });
    const teacher = await open("teacher", "tabgv01");
    const student = await open("student", "tabhs01");
    assert.equal((await fetch(tokenUrl("role=teacher&room=dev-h&line=X!"), { headers: { origin: ORIGIN } })).status, 400);
    assert.equal((await hang("line=tabhs01&seconds=0")).status, 400);
    assert.equal((await hang("line=tabhs01&seconds=1")).status, 204);
    assert.equal((await hang("line=tabhs01&seconds=1")).status, 409, "đang treo");

    teacher.ws.send(JSON.stringify({ type: "update", elements: [{ id: "net-h", version: 1, versionNonce: 1, type: "freedraw" }] }));
    student.ws.send(JSON.stringify({ type: "ping", n: 1 }));
    teacher.ws.send(JSON.stringify({ type: "ping", n: 2 }));
    await delay(400);
    assert.ok(!student.inbox.some((m) => m.type === "update" || m.type === "pong"), "tab bị treo không nhận gì");
    assert.ok(!student.isClosed(), "kết nối không bị đóng");
    assert.ok(teacher.inbox.some((m) => m.type === "pong" && m.n === 2), "tab khác vẫn trao đổi bình thường");

    await delay(900); // hết 1 s: dữ liệu bị giữ được chuyển nốt
    assert.ok(student.inbox.some((m) => m.type === "update" && m.elements[0].id === "net-h"));
    assert.ok(student.inbox.some((m) => m.type === "pong" && m.n === 1));
    teacher.ws.close();
    student.ws.close();
  });

    it("máy chủ bảng vẫn chặn Origin lạ và token giả", async () => {
    const { url } = await getToken("teacher", "dev-1");
    const foreign = new WebSocket(url, { origin: "http://evil.test" });
    const [, res] = await once(foreign, "unexpected-response");
    assert.equal(res.statusCode, 403);

    const fake = new WebSocket(url, { origin: ORIGIN });
    await once(fake, "open");
    fake.send(JSON.stringify({ type: "auth", token: "khong-phai-token" }));
    const [code] = await once(fake, "close");
    assert.equal(code, 4401);
  });

  it("giáo viên viết, học sinh cùng phòng nhận; phòng khác không nhận; tải lại vẫn đủ nội dung", async () => {
    const teacher = await join("teacher", "dev-a");
    const student = await join("student", "dev-a");
    const other = await join("student", "dev-b");
    const stroke = { id: "net-1", version: 1, versionNonce: 5, type: "freedraw" };
    teacher.ws.send(JSON.stringify({ type: "update", elements: [stroke] }));
    assert.equal((await student.next((m) => m.type === "update")).elements[0].id, "net-1");

    // Học sinh không sửa được: nét của học sinh bị máy chủ bỏ qua
    student.ws.send(JSON.stringify({ type: "update", elements: [{ ...stroke, id: "net-hs" }] }));
    await delay(300);
    assert.ok(!teacher.inbox.some((m) => m.type === "update"), "giáo viên không nhận nét của học sinh");
    assert.ok(!other.inbox.some((m) => m.type === "update"), "phòng dev-b không nhận nét của dev-a");

    student.ws.close();
    const reloaded = await join("student", "dev-a");
    const init = reloaded.inbox.find((m) => m.type === "init");
    assert.deepEqual(init.elements.map((e: { id: string }) => e.id), ["net-1"]);
    for (const c of [teacher, reloaded, other]) c.ws.close();
  });
});

// Chế độ Wi-Fi (tablet cùng mạng). Test không mở cổng ra mạng thật: dùng 127.0.0.1 làm "IP LAN",
// còn việc chọn IP hợp lệ kiểm riêng bằng danh sách card mạng giả.
describe("máy chủ bảng thử: chế độ Wi-Fi", { timeout: 30_000 }, () => {
  const fakeInterfaces = {
    "Wi-Fi": [{ address: "192.168.1.9", family: "IPv4" }],
    "vEthernet (WSL)": [{ address: "172.18.144.1", family: "IPv4" }],
    Loopback: [{ address: "127.0.0.1", family: "IPv4" }],
  } as unknown as ReturnType<typeof import("node:os").networkInterfaces>;

  it("chỉ nhận IP mạng nội bộ có trên máy này", () => {
    assert.equal(lanError("192.168.1.9", fakeInterfaces), null);
    assert.equal(lanError("172.18.144.1", fakeInterfaces), null);
    for (const bad of ["0.0.0.0", "127.0.0.1", "8.8.8.8", "172.32.0.1", "192.168.1.50", "localhost", "", "::"]) {
      assert.ok(lanError(bad, fakeInterfaces), `phải từ chối ${JSON.stringify(bad)}`);
    }
    assert.deepEqual(lanCandidates(fakeInterfaces), ["192.168.1.9 (Wi-Fi)", "172.18.144.1 (vEthernet (WSL))"]);
  });

  it("mã ghép nối ngẫu nhiên mỗi lần, dễ gõ", () => {
    const codes = new Set(Array.from({ length: 50 }, newPairCode));
    assert.equal(codes.size, 50);
    for (const code of codes) assert.match(code, /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
  });

  it("Origin đúng địa chỉ web thử, bắt buộc mã ghép nối, vẫn chỉ phòng dev-*, máy chủ bảng chỉ 127.0.0.1", async () => {
    const lan = await startLocalBoard({ boardPort: 0, tokenPort: 0, linePort: 0, webPort: 5174, lan: "127.0.0.1" });
    const other = await startLocalBoard({ boardPort: 0, tokenPort: 0, linePort: 0, webPort: 5174, lan: "127.0.0.1" });
    try {
      const origin = "http://127.0.0.1:5174";
      const code = lan.pairCode!;
      assert.notEqual(code, other.pairCode, "mỗi lần chạy một mã");
      assert.equal(lan.webUrl, "http://127.0.0.1:5174/dev/whiteboard");
      assert.equal((lan.board.server.address() as AddressInfo).address, "127.0.0.1", "máy chủ bảng không nghe ra mạng");
      const call = (path: string, q: string, o = origin, method = "GET") =>
        fetch(`http://127.0.0.1:${lan.tokenPort}${path}?${q}`, { method, headers: { origin: o } });

      assert.equal((await call("/token", "role=teacher&room=dev-1")).status, 401, "thiếu mã");
      const wrong = await call("/token", "role=teacher&room=dev-1&pair=AAAA-AAAA");
      assert.equal(wrong.status, 401, "sai mã");
      assert.equal(wrong.headers.get("access-control-allow-origin"), origin, "trang đọc được 401 để hỏi mã");
      assert.equal((await call("/token", `role=teacher&room=dev-1&pair=${other.pairCode}`)).status, 401, "mã của lần chạy khác");
      assert.equal((await call("/pause", "room=dev-1&seconds=1", origin, "POST")).status, 401, "điều khiển cũng cần mã");
      assert.equal((await call("/hang", "line=tabhs01&seconds=1", origin, "POST")).status, 401);
      for (const o of ["http://localhost:5174", "http://127.0.0.1:5173", "http://192.168.1.9:5174", "*"]) {
        assert.equal((await call("/token", `role=teacher&room=dev-1&pair=${code}`, o)).status, 403, `Origin ${o}`);
      }
      assert.equal((await call("/token", `role=teacher&room=11111111-1111-1111-1111-111111111111&pair=${code}`)).status, 400, "chỉ phòng dev-*");

      const typed = code.toLowerCase().replace("-", " "); // gõ trên tablet: chữ thường, khoảng trắng
      const ok = await call("/token", `role=student&room=dev-1&line=tabhs01&pair=${encodeURIComponent(typed)}`);
      assert.equal(ok.status, 200);
      const { url, token } = (await ok.json()) as { url: string; token: string };
      assert.equal(url, `ws://127.0.0.1:${lan.proxy.port}/?line=tabhs01`, "địa chỉ WebSocket là IP LAN, không phải localhost");

      const ws = new WebSocket(url, { origin });
      const inbox: any[] = [];
      ws.on("message", (raw) => inbox.push(JSON.parse(raw.toString())));
      await once(ws, "open");
      ws.send(JSON.stringify({ type: "auth", token }));
      for (let i = 0; i < 100 && !inbox.some((m) => m.type === "init"); i++) await delay(20);
      assert.ok(inbox.some((m) => m.type === "init"), "vào bảng qua proxy");
      ws.close();
      const foreign = new WebSocket(url, { origin: "http://localhost:5174" });
      const [, res] = await once(foreign, "unexpected-response");
      assert.equal(res.statusCode, 403, "máy chủ bảng cũng chỉ nhận Origin của web thử");
    } finally {
      await lan.close();
      await other.close();
    }
  });
});

/**
 * Proxy TCP thử (chỉ development/test): giả lập "đường truyền treo" như mất sóng, Offline của DevTools.
 * Khi treo một đường truyền: không đóng kết nối, không gửi gì; dữ liệu hai chiều bị giữ lại (như gói tin
 * chưa tới) và chuyển nốt khi khôi phục, kể cả việc đóng kết nối. Kết nối mới của đường đó cũng treo.
 * Đường truyền nhận diện bằng `?line=<id>` trong URL WebSocket; kết nối không có id dùng chung id "".
 */
import { createServer, connect, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";

type Chunk = Buffer | null; // null: phía bên kia đã đóng

interface Pipe {
  line: string | undefined; // undefined: chưa đọc được dòng yêu cầu HTTP
  hung: boolean; // treo riêng kết nối này (hang với existingOnly)
  client: Socket;
  upstream: Socket;
  toUpstream: Chunk[];
  toClient: Chunk[];
}

export interface LineProxy {
  server: Server;
  port: number;
  /** Số kết nối đã nhận theo đường truyền (để kiểm không có vòng lặp nối lại dày đặc). */
  connections(line?: string): number;
  /** existingOnly: chỉ treo kết nối đang có, kết nối mới đi bình thường (kết nối cũ "chết" lặng lẽ). */
  hang(line?: string, options?: { existingOnly?: boolean }): void;
  /** discard: bỏ dữ liệu đang giữ và cắt kết nối cũ (như NAT đã quên kết nối), thay vì chuyển nốt. */
  restore(line?: string, options?: { discard?: boolean }): void;
  isHung(line?: string): boolean;
  close(): Promise<void>;
}

const LINE_IN_REQUEST = /^GET [^ ]*[?&]line=([A-Za-z0-9-]{1,64})/;

/** `host`: địa chỉ proxy nghe (chế độ Wi-Fi: IP LAN). Máy chủ bảng phía sau luôn ở 127.0.0.1. */
export async function startLineProxy(targetPort: number, host = "127.0.0.1", port = 0): Promise<LineProxy> {
  const pipes = new Set<Pipe>();
  const hung = new Set<string>();
  const counts = new Map<string, number>();

  const deliver = (pipe: Pipe, queue: Chunk[], to: Socket) => {
    if (pipe.line === undefined || pipe.hung || hung.has(pipe.line)) return;
    while (queue.length) {
      const chunk = queue.shift()!;
      if (chunk === null) {
        to.end();
        return;
      }
      to.write(chunk);
    }
  };
  const flush = (pipe: Pipe) => {
    deliver(pipe, pipe.toUpstream, pipe.upstream);
    deliver(pipe, pipe.toClient, pipe.client);
  };

  const server = createServer((client) => {
    const upstream = connect(targetPort, "127.0.0.1");
    const pipe: Pipe = { line: undefined, hung: false, client, upstream, toUpstream: [], toClient: [] };
    pipes.add(pipe);
    client.on("data", (chunk: Buffer) => {
      if (pipe.line === undefined) {
        pipe.line = LINE_IN_REQUEST.exec(chunk.toString("latin1"))?.[1] ?? "";
        counts.set(pipe.line, (counts.get(pipe.line) ?? 0) + 1);
      }
      pipe.toUpstream.push(chunk);
      flush(pipe);
    });
    upstream.on("data", (chunk: Buffer) => {
      pipe.toClient.push(chunk);
      flush(pipe);
    });
    // Đóng (end hoặc close đột ngột) cũng đi qua hàng đợi: đường đang treo thì bên kia chưa biết
    const finish = (queue: Chunk[]) => {
      if (!queue.includes(null)) queue.push(null);
      flush(pipe);
    };
    client.on("end", () => finish(pipe.toUpstream));
    upstream.on("end", () => finish(pipe.toClient));
    client.on("close", () => finish(pipe.toUpstream));
    upstream.on("close", () => finish(pipe.toClient));
    // Lỗi socket (vd. ECONNRESET, máy chủ bảng tắt): đóng cả hai phía, không làm sập tiến trình
    const destroy = () => {
      client.destroy();
      upstream.destroy();
      pipes.delete(pipe);
    };
    client.on("error", destroy);
    upstream.on("error", destroy);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  return {
    server,
    port: (server.address() as AddressInfo).port,
    connections: (line = "") => counts.get(line) ?? 0,
    hang: (line = "", { existingOnly = false } = {}) => {
      if (!existingOnly) return void hung.add(line);
      for (const pipe of pipes) if (pipe.line === line) pipe.hung = true;
    },
    restore: (line = "", { discard = false } = {}) => {
      hung.delete(line);
      for (const pipe of [...pipes]) {
        if (pipe.line !== line) continue;
        pipe.hung = false;
        if (!discard) {
          flush(pipe);
          continue;
        }
        pipe.client.destroy();
        pipe.upstream.destroy();
        pipes.delete(pipe);
      }
    },
    isHung: (line = "") => hung.has(line),
    close: () =>
      new Promise<void>((resolve) => {
        for (const pipe of pipes) {
          pipe.client.destroy();
          pipe.upstream.destroy();
        }
        pipes.clear();
        server.close(() => resolve());
      }),
  };
}

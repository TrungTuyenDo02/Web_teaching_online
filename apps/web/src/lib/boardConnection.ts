/**
 * Giao thức với máy chủ whiteboard-sync, tách khỏi React và Excalidraw để test được với máy chủ thật
 * (services/whiteboard-sync/test/client.test.ts). Không import gì ngoài API chuẩn của trình duyệt.
 */
import { IMAGE_CHUNK_SIZE, IMAGE_ID, IMAGE_MAX_BYTES, readBoardFile, type BoardFile } from "./boardFiles.ts";

export interface SyncElement {
  id: string;
  version: number;
  versionNonce: number;
  type?: string;
  fileId?: string | null;
}

/** Bảng ở máy này: đọc mọi phần tử (kể cả đã xóa) và gộp phần tử nhận từ máy chủ. */
export interface BoardScene {
  elements(): readonly SyncElement[];
  applyRemote(remote: SyncElement[]): void;
  files?(): Record<string, BoardFile>;
  applyFiles?(files: BoardFile[]): void;
}

// preview: không có máy chủ bảng (chế độ xem trước bằng dữ liệu minh họa, bản development)
// checking: đang hỏi lại máy chủ (vd. vừa quay lại tab), chưa coi là còn kết nối
export type BoardStatus = "connecting" | "online" | "checking" | "offline" | "expired" | "ended" | "preview";

/** Đã gửi lên máy chủ / đã nhận từ máy chủ (init khi vào hoặc nối lại, update từ máy khác). */
export type BoardActivity = { kind: "sent" | "init" | "update"; elements: SyncElement[] };

export interface BoardEvents {
  onStatus(status: BoardStatus): void;
  onPeers(count: number): void;
  /** Tùy chọn, chỉ để hiển thị/kiểm tra (trang thử /dev/whiteboard); không ảnh hưởng giao thức. */
  onActivity?(activity: BoardActivity): void;
  onImages?(supported: boolean): void;
  onFileError?(message: string): void;
}

// Máy chủ đóng kết nối khi một tin quá 2.000 phần tử hoặc 5 MB: chia lô nhỏ hơn hẳn
export const MAX_BATCH_ELEMENTS = 500;
export const MAX_BATCH_BYTES = 1024 * 1024;
// Còn nhiều dữ liệu chưa gửi đi (mạng chậm): chờ rồi gửi tiếp, không dồn thêm vào bộ đệm
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const BACKPRESSURE_RETRY_MS = 200;
const CLOSE_AUTH_FAILED = 4401;
const CLOSE_SESSION_ENDED = 4410;

// Heartbeat (giao thức ở services/whiteboard-sync/src/server.ts): đường truyền rớt mà không đóng TCP
// (mất sóng, đổi mạng, Offline của DevTools) thì không có sự kiện close nào; chỉ thiếu pong mới lộ ra.
// 5 s một ping (vài chục byte), chờ pong 10 s: đủ rộng cho 4G giật vài giây, báo mất kết nối chậm nhất
// khoảng 15 s sau khi đường truyền treo (thay vì vài phút chờ TCP tự hết hạn).
export const HEARTBEAT_INTERVAL_MS = 5000;
export const HEARTBEAT_TIMEOUT_MS = 10_000;
// Nối lại mà đường truyền vẫn treo: không có init trong hạn thì bỏ socket đó và thử lại theo backoff
export const HANDSHAKE_TIMEOUT_MS = 10_000;

// Phiên bản đầy đủ: cùng version mà khác versionNonce (hai máy sửa cùng lúc) vẫn là khác nhau
const versionKey = (el: SyncElement) => `${el.version}:${el.versionNonce}`;

/** Ảnh cần file id hợp lệ; flush còn kiểm file đã có trên máy chủ cùng phòng. */
export const isSyncable = (el: SyncElement) => el.type !== "image" || (typeof el.fileId === "string" && IMAGE_ID.test(el.fileId));

/** Chia phần tử thành các tin `update` vừa giới hạn; phần tử một mình đã quá giới hạn bị bỏ ra. */
export function toBatches(
  elements: readonly SyncElement[],
  maxCount = MAX_BATCH_ELEMENTS,
  maxBytes = MAX_BATCH_BYTES,
): { batches: SyncElement[][]; oversized: SyncElement[] } {
  const encoder = new TextEncoder();
  const batches: SyncElement[][] = [];
  const oversized: SyncElement[] = [];
  let current: SyncElement[] = [];
  let bytes = 0;
  for (const el of elements) {
    const size = encoder.encode(JSON.stringify(el)).length + 1;
    if (size > maxBytes) {
      oversized.push(el);
      continue;
    }
    if (current.length > 0 && (current.length >= maxCount || bytes + size > maxBytes)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(el);
    bytes += size;
  }
  if (current.length > 0) batches.push(current);
  return { batches, oversized };
}

export interface ConnectionOptions {
  retryBaseMs?: number;
  maxRetryMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  /** Đồng hồ (test giả lập thiết bị ngủ: thời gian trôi mà timer không chạy). */
  now?: () => number;
}

/**
 * Một kết nối bảng (tự nối lại khi rớt mạng).
 * - `flush()` gửi các phần tử có phiên bản khác bản máy chủ đã có, chia lô theo giới hạn. "Đã gửi" chỉ
 *   có giá trị trên kết nối hiện tại: mỗi lần (nối lại và) nhận `init`, nội dung máy chủ là mốc và
 *   phần máy này có mà máy chủ chưa có (sửa lúc mất mạng, gửi rồi mà đường truyền treo, máy chủ khởi
 *   động lại trước khi kịp lưu) được gửi bù.
 * - Sau khi xác thực (nhận `init`), ping định kỳ; không có pong trong hạn thì bỏ socket (gỡ mọi handler,
 *   phản hồi muộn của nó bị bỏ qua) và nối lại theo backoff.
 * - `verify()` khi tab hiện lại/thiết bị thức: không tin phản hồi cũ, hỏi lại máy chủ ngay.
 * - 4401 (token hết hạn/sai) và 4410 (buổi đã kết thúc) thì dừng, không thử lại.
 */
export class BoardConnection {
  private imageSupport = false;
  private serverFiles = new Set<string>();
  private waitingImages = new Map<string, SyncElement>();
  private incomingFiles = new Map<string, { data: string; total: number; mimeType: string; created: number }>();
  private restoring = false;
  private upload: { id: string; mimeType: string; dataURL: string; resolve(file: BoardFile): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout>; sendTimer?: ReturnType<typeof setTimeout> } | undefined;
  private socket: WebSocket | null = null;
  private authed = false; // socket hiện tại đã nhận init
  private status: BoardStatus | undefined;
  private sent = new Map<string, string>(); // id -> versionKey đã gửi/nhận trên kết nối hiện tại
  private stopped = false;
  private attempt = 0;
  private pingSeq = 0;
  private pingSentAt: number | undefined; // ping đang chờ pong
  private lastPongAt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly scene: BoardScene,
    private readonly events: BoardEvents,
    private readonly options: ConnectionOptions = {},
  ) {}

  start(): void {
    this.stopped = false;
    this.attempt = 0;
    this.status = undefined;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    clearTimeout(this.flushTimer);
    this.dropSocket();
  }

  /** Tab hiện lại, thiết bị thức, có mạng lại: xác nhận kết nối bằng pong mới thay vì tin phản hồi cũ. */
  verify(): void {
    if (this.stopped) return;
    if (!this.socket) {
      // Đang chờ tới lượt nối lại (timer có thể bị hoãn khi tab ẩn): nối ngay, vẫn chỉ một socket
      if (this.retryTimer !== undefined) {
        clearTimeout(this.retryTimer);
        this.connect();
      }
      return;
    }
    if (!this.authed) return; // đang nối: hạn bắt tay lo
    const { heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS, heartbeatTimeoutMs = HEARTBEAT_TIMEOUT_MS } = this.options;
    const now = this.now();
    if (this.pingSentAt !== undefined && now - this.pingSentAt >= heartbeatTimeoutMs) return this.lost(this.socket);
    // Bình thường pong mới nhất chưa quá một chu kỳ (+ thời gian đi về); quá hai chu kỳ nghĩa là timer
    // đã bị hoãn (tab ẩn, máy ngủ): không hiện "đã kết nối" dựa trên pong cũ, hỏi lại máy chủ
    if (now - this.lastPongAt < 2 * heartbeatIntervalMs) return;
    this.setStatus("checking");
    this.ping(); // không gửi thêm nếu đã có ping chờ pong
  }

  flush(): void {
    const socket = this.socket;
    // Chưa xác thực: không gửi (máy chủ chỉ nhận auth là tin đầu tiên); init sẽ gọi flush
    if (!socket || !this.authed || socket.readyState !== WebSocket.OPEN) return;
    const all = this.scene.elements();
    const missing = all.filter(el => el.type === "image" && el.fileId && !this.serverFiles.has(el.fileId));
    if (missing.length && this.imageSupport && !this.upload && !this.restoring) {
      this.restoring = true;
      const files = this.scene.files?.() ?? {};
      void (async () => {
        for (const id of new Set(missing.map(el => el.fileId!))) if (files[id]) await this.uploadFile(files[id]!);
      })().catch(() => this.events.onFileError?.("Chưa đồng bộ được ảnh. Hãy thử lại khi có mạng.")).finally(() => { this.restoring = false; });
    }
    const pending = this.scene
      .elements()
      .filter((el) => isSyncable(el) && (el.type !== "image" || this.serverFiles.has(el.fileId!)) && this.sent.get(el.id) !== versionKey(el));
    if (pending.length === 0) return;
    const { batches, oversized } = toBatches(pending);
    for (const el of oversized) {
      // Không gửi được (máy chủ sẽ ngắt kết nối): bỏ qua cho đến khi phần tử đổi. Không log nội dung.
      console.warn("Phần tử bảng quá lớn, không đồng bộ được", el.id);
      this.sent.set(el.id, versionKey(el));
    }
    for (const batch of batches) {
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
        clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => this.flush(), BACKPRESSURE_RETRY_MS);
        return;
      }
      socket.send(JSON.stringify({ type: "update", elements: batch }));
      for (const el of batch) this.sent.set(el.id, versionKey(el));
      this.events.onActivity?.({ kind: "sent", elements: batch });
    }
  }

  /** Không cần crypto.subtle (không có trên trang LAN HTTP): máy chủ tính hash và trả id bền. */
  uploadFile(file: Pick<BoardFile, "mimeType" | "dataURL">): Promise<BoardFile> {
    const socket = this.socket;
    if (!socket || !this.authed || this.status !== "online" || !this.imageSupport || this.upload) return Promise.reject(new Error("Chưa sẵn sàng tải ảnh. Hãy thử lại khi bảng đã kết nối."));
    const prefix = `data:${file.mimeType};base64,`;
    const data = file.dataURL.startsWith(prefix) ? file.dataURL.slice(prefix.length) : "";
    if (!data.length || data.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4) return Promise.reject(new Error("Ảnh quá lớn. Hãy chọn ảnh khác."));
    const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.rejectUpload("Tải ảnh quá lâu. Hãy thử lại."), 45_000);
      const upload = { id, mimeType: file.mimeType, dataURL: file.dataURL, resolve, reject, timeout, sendTimer: undefined as ReturnType<typeof setTimeout> | undefined };
      this.upload = upload;
      let offset = 0;
      const next = () => {
        if (this.upload !== upload || this.socket !== socket || !this.authed) return;
        if (socket.bufferedAmount > 512 * 1024) { upload.sendTimer = setTimeout(next, 50); return; }
        const chunk = data.slice(offset, offset + IMAGE_CHUNK_SIZE);
        socket.send(JSON.stringify({ type: "file_chunk", uploadId: id, mimeType: file.mimeType, offset, total: data.length, data: chunk }));
        offset += chunk.length;
        if (offset < data.length) upload.sendTimer = setTimeout(next, 0);
      };
      next();
    });
  }

  private rejectUpload(message: string): void {
    const upload = this.upload; this.upload = undefined;
    if (!upload) return;
    clearTimeout(upload.timeout); clearTimeout(upload.sendTimer); upload.reject(new Error(message));
  }

  private fileMessage(msg: Record<string, unknown>): void {
    if (msg.type === "file_ack") {
      const upload = this.upload;
      if (!upload || msg.uploadId !== upload.id) return;
      const file = readBoardFile({ id: msg.id, mimeType: upload.mimeType, dataURL: upload.dataURL, created: msg.created });
      clearTimeout(upload.timeout); clearTimeout(upload.sendTimer); this.upload = undefined;
      this.serverFiles.add(file.id); this.scene.applyFiles?.([file]); upload.resolve(file); this.flush();
    } else if (msg.type === "file_error") {
      if (msg.uploadId === this.upload?.id) this.rejectUpload(typeof msg.message === "string" ? msg.message : "Chưa lưu được ảnh. Hãy thử lại.");
    } else if (msg.type === "file_data") {
      const id = String(msg.id);
      if (!IMAGE_ID.test(id) || !Number.isInteger(msg.total) || Number(msg.total) > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 || Number(msg.total) <= 0 || typeof msg.data !== "string" || !msg.data.length || msg.data.length > IMAGE_CHUNK_SIZE) throw new Error("bad image chunk");
      let incoming = this.incomingFiles.get(id);
      if (!incoming) {
        if (this.incomingFiles.size >= 20 || msg.offset !== 0) throw new Error("bad image offset");
        incoming = { data: "", total: Number(msg.total), mimeType: String(msg.mimeType), created: Number(msg.created) }; this.incomingFiles.set(id, incoming);
      }
      if (msg.offset !== incoming.data.length || msg.total !== incoming.total || msg.mimeType !== incoming.mimeType || incoming.data.length + msg.data.length > incoming.total) throw new Error("bad image chunk");
      incoming.data += msg.data;
      if (incoming.data.length === incoming.total) {
        const file = readBoardFile({ id, mimeType: incoming.mimeType, created: incoming.created, dataURL: `data:${incoming.mimeType};base64,${incoming.data}` });
        this.incomingFiles.delete(id); this.scene.applyFiles?.([file]); this.serverFiles.add(id);
        const ready = [...this.waitingImages.values()].filter(el => this.scene.files?.()[el.fileId!] !== undefined);
        for (const el of ready) this.waitingImages.delete(el.id);
        if (ready.length) this.receive(ready, "update");
      }
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private setStatus(status: BoardStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.events.onStatus(status);
  }

  private connect(): void {
    this.retryTimer = undefined;
    // Đang nối lại sau khi mất kết nối: giữ "mất kết nối, đang thử lại" đến khi có init
    if (this.status !== "offline") this.setStatus("connecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;
    this.authed = false;
    const { handshakeTimeoutMs = HANDSHAKE_TIMEOUT_MS } = this.options;
    this.handshakeTimer = setTimeout(() => this.lost(socket), handshakeTimeoutMs);

    socket.onopen = () => {
      if (this.socket === socket) socket.send(JSON.stringify({ type: "auth", token: this.token }));
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return; // socket đã bị thay: bỏ qua phản hồi muộn
      const msg = JSON.parse(String(event.data)) as {
        [key: string]: unknown;
        type: string;
        elements?: SyncElement[];
        peers?: number;
        count?: number;
      };
      if (["file_ack", "file_error", "file_data"].includes(msg.type)) {
        try { this.fileMessage(msg); } catch { this.lost(socket); }
        return;
      }
      if (msg.type === "init") {
        clearTimeout(this.handshakeTimer);
        this.authed = true;
        this.attempt = 0; // máy chủ đã phản hồi thật (mở được socket chưa đủ)
        this.pingSentAt = undefined;
        this.lastPongAt = this.now();
        this.setStatus("online");
        this.events.onPeers(msg.peers ?? 1);
        // Quên "đã gửi" của lần kết nối trước: chỉ tin những gì máy chủ thật sự đang có
        this.sent = new Map();
        this.imageSupport = msg.images === true;
        this.events.onImages?.(this.imageSupport);
        this.serverFiles = new Set(Array.isArray(msg.fileIds) ? msg.fileIds.filter((id): id is string => typeof id === "string" && IMAGE_ID.test(id)) : []);
        this.receive(msg.elements ?? [], "init");
        this.flush();
        this.scheduleHeartbeat();
      } else if (msg.type === "pong") {
        this.pingSentAt = undefined;
        clearTimeout(this.pongTimer);
        this.lastPongAt = this.now();
        if (this.status === "checking") this.setStatus("online");
      } else if (msg.type === "update") {
        this.receive(msg.elements ?? [], "update");
      } else if (msg.type === "peers") {
        this.events.onPeers(msg.count ?? 1);
      } else if (msg.type === "ended") {
        this.finish("ended");
      }
    };
    socket.onclose = (event) => {
      if (this.stopped || this.socket !== socket) return;
      if (event.code === CLOSE_SESSION_ENDED) return this.finish("ended");
      // Token sai/hết hạn: không thử lại vô ích, báo vào lại phòng để lấy token mới
      if (event.code === CLOSE_AUTH_FAILED) return this.finish("expired");
      this.lost(socket);
    };
  }

  private scheduleHeartbeat(): void {
    const { heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS } = this.options;
    const socket = this.socket;
    clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.verify(); // nhịp này đến muộn (tab ẩn, máy ngủ) thì pong đã cũ: hiện "đang kiểm tra"
      if (this.socket !== socket || !this.authed) return; // verify đã bỏ socket này
      this.ping();
      this.scheduleHeartbeat();
    }, heartbeatIntervalMs);
  }

  /** Gửi ping nếu chưa có ping nào chờ pong; hết hạn mà không có pong thì coi socket này đã mất. */
  private ping(): void {
    const socket = this.socket;
    if (!socket || !this.authed || this.pingSentAt !== undefined) return;
    const { heartbeatTimeoutMs = HEARTBEAT_TIMEOUT_MS } = this.options;
    this.pingSentAt = this.now();
    socket.send(JSON.stringify({ type: "ping", n: ++this.pingSeq })); // gửi được không chứng minh gì
    this.pongTimer = setTimeout(() => this.lost(socket), heartbeatTimeoutMs);
  }

  /** Socket này không còn dùng được (đóng, hết hạn bắt tay hoặc pong): bỏ nó và nối lại theo backoff. */
  private lost(socket: WebSocket): void {
    if (this.stopped || this.socket !== socket) return;
    this.dropSocket();
    this.setStatus("offline");
    const { retryBaseMs = 1000, maxRetryMs = 10_000 } = this.options;
    const delay = Math.min(retryBaseMs * 2 ** this.attempt++, maxRetryMs);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  /** Hết phiên/kết thúc buổi: dừng hẳn, không nối lại. */
  private finish(status: "ended" | "expired"): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.dropSocket();
    this.setStatus(status);
  }

  /** Gỡ handler trước khi đóng: socket cũ không còn đổi trạng thái hay dữ liệu dù phản hồi tới muộn. */
  private dropSocket(): void {
    this.rejectUpload("Kết nối bảng đã ngắt. Hãy thử tải ảnh lại.");
    this.imageSupport = false; this.events.onImages?.(false);
    this.incomingFiles.clear(); this.waitingImages.clear(); this.serverFiles.clear();
    clearTimeout(this.handshakeTimer);
    clearTimeout(this.heartbeatTimer);
    clearTimeout(this.pongTimer);
    this.pingSentAt = undefined;
    this.authed = false;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    socket.close();
  }

  private receive(remote: SyncElement[], kind: "init" | "update"): void {
    const ready: SyncElement[] = [];
    for (const el of remote) {
      if (el.type === "image" && !this.scene.files?.()[el.fileId!]) this.waitingImages.set(el.id, el);
      else { this.waitingImages.delete(el.id); ready.push(el); }
    }
    this.scene.applyRemote(ready);
    for (const el of remote) this.sent.set(el.id, versionKey(el)); // máy chủ đã có, không gửi lại
    this.events.onActivity?.({ kind, elements: remote });
  }
}

import type { WebSocket } from "ws";
import type { BoardClaims } from "./auth.ts";
import { Scene, type BoardElement } from "./scene.ts";
import { errorCode, type SceneStore } from "./store.ts";

export interface Peer {
  socket: WebSocket;
  claims: BoardClaims;
}

export class Room {
  readonly scene = new Scene();
  readonly peers = new Set<Peer>();
  cleanupTimer: NodeJS.Timeout | undefined;
  saveTimer: NodeJS.Timeout | undefined;
}

// Trong RAM: nhớ buổi đã kết thúc lâu hơn hạn token bảng viết. Có store thì dấu đóng còn được
// ghi xuống đĩa (SceneStore.markEnded) nên khởi động lại máy chủ vẫn chặn token cũ.
const ENDED_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Quản lý các phòng bảng viết theo id buổi học. */
export class RoomHub {
  private readonly rooms = new Map<string, Room>();
  private readonly ended = new Map<string, number>(); // id buổi học -> mốc hết nhớ (ms)

  constructor(
    private readonly lingerMs: number,
    private readonly store?: SceneStore,
    private readonly saveDelayMs = 2000,
  ) {}

  join(sessionId: string, peer: Peer): Room {
    let room = this.rooms.get(sessionId);
    if (!room) {
      room = new Room();
      // Nạp bản đã lưu: máy chủ khởi động lại hoặc phòng đã được giải phóng khỏi bộ nhớ
      if (this.store) room.scene.apply(this.store.load(sessionId));
      this.rooms.set(sessionId, room);
    }
    if (room.cleanupTimer) {
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = undefined;
    }
    room.peers.add(peer);
    return room;
  }

  leave(sessionId: string, peer: Peer): void {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    room.peers.delete(peer);
    if (room.peers.size === 0) {
      // Giữ nội dung một lúc để nối lại khi rớt mạng; sau đó giải phóng bộ nhớ
      clearTimeout(room.cleanupTimer);
      room.cleanupTimer = setTimeout(() => {
        // Ghi lỗi thì giữ phòng trong RAM để không mất nét; lần ghi/đóng sau thử lại
        if (this.trySave(sessionId, room)) this.rooms.delete(sessionId);
      }, this.lingerMs);
      room.cleanupTimer.unref();
    }
  }

  /** Có nét mới được nhận: hẹn ghi xuống đĩa (gộp các nét gần nhau thành một lần ghi). */
  changed(sessionId: string): void {
    const room = this.rooms.get(sessionId);
    if (!this.store || !room || room.saveTimer) return;
    room.saveTimer = setTimeout(() => this.trySave(sessionId, room), this.saveDelayMs);
    room.saveTimer.unref();
  }

  private flush(sessionId: string, room: Room): void {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = undefined;
    this.store?.save(sessionId, room.scene.snapshot());
  }

  /** Ghi trong timer: lỗi đĩa chỉ ghi log (không có nội dung bảng), không làm sập tiến trình. */
  private trySave(sessionId: string, room: Room): boolean {
    try {
      this.flush(sessionId, room);
      return true;
    } catch (err) {
      console.error("Không ghi được bảng xuống đĩa", sessionId, errorCode(err));
      return false;
    }
  }

  /** Phòng mà peer đang ở; undefined nếu buổi đã đóng, để nét đến muộn không mở lại phòng. */
  roomOf(sessionId: string, peer: Peer): Room | undefined {
    const room = this.rooms.get(sessionId);
    return room?.peers.has(peer) ? room : undefined;
  }

  /**
   * Giáo viên kết thúc buổi: chặn ngay trong RAM, lưu bản cuối, ghi dấu đóng xuống đĩa.
   * Gọi lại được (kể cả sau khởi động lại); trả về nội dung bảng cuối cùng.
   * Lỗi đĩa thì ném lỗi; phòng chưa lưu được vẫn giữ trong RAM để lần gọi lại ghi tiếp.
   * Người gọi tự ngắt những người đang trong phòng (lấy bằng peersOf trước khi gọi).
   */
  end(sessionId: string, now = Date.now()): BoardElement[] {
    for (const [sid, until] of this.ended) if (until < now) this.ended.delete(sid);
    this.ended.set(sessionId, now + ENDED_RETENTION_MS);
    const room = this.rooms.get(sessionId);
    if (room) {
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      room.peers.clear(); // roomOf không còn trả phòng này: nét đến sau lúc đóng bị bỏ qua
    }
    this.store?.markEnded(sessionId); // ghi trước bản cuối: lưu bảng lỗi thì restart vẫn chặn token cũ
    if (room) {
      this.flush(sessionId, room);
      this.rooms.delete(sessionId);
    }
    return room ? room.scene.snapshot() : (this.store?.load(sessionId) ?? []);
  }

  /**
   * Xóa hẳn nội dung bảng của buổi (xóa học sinh): như end nhưng không lưu gì, xóa file trên đĩa.
   * Giữ dấu đóng để token cũ vẫn bị từ chối. Gọi lại được; lỗi đĩa thì ném lỗi.
   * Người gọi tự ngắt những người đang trong phòng (lấy bằng peersOf trước khi gọi).
   */
  purge(sessionId: string, now = Date.now()): void {
    this.ended.set(sessionId, now + ENDED_RETENTION_MS);
    const room = this.rooms.get(sessionId);
    if (room) {
      clearTimeout(room.cleanupTimer);
      clearTimeout(room.saveTimer); // nét đang chờ ghi không được tạo lại file sau khi xóa
      room.peers.clear();
      this.rooms.delete(sessionId);
    }
    this.store?.markEnded(sessionId);
    this.store?.remove(sessionId);
  }

  /** Có thể ném lỗi đọc đĩa: người gọi phải phân biệt với "chưa kết thúc". */
  isEnded(sessionId: string, now = Date.now()): boolean {
    return (this.ended.get(sessionId) ?? 0) > now || (this.store?.isEnded(sessionId) ?? false);
  }

  /** Danh sách người đang trong phòng (rỗng nếu phòng không tồn tại). */
  peersOf(sessionId: string): Set<Peer> {
    return this.rooms.get(sessionId)?.peers ?? new Set();
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  closeAll(): void {
    for (const [sessionId, room] of this.rooms) {
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      this.trySave(sessionId, room); // tắt máy chủ: ghi nốt phần chưa lưu (kể cả lần ghi trước bị lỗi)
    }
    this.rooms.clear();
  }
}

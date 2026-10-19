import type { WebSocket } from "ws";
import type { BoardClaims } from "./auth.ts";
import { Scene } from "./scene.ts";

export interface Peer {
  socket: WebSocket;
  claims: BoardClaims;
}

export class Room {
  readonly scene = new Scene();
  readonly peers = new Set<Peer>();
  cleanupTimer: NodeJS.Timeout | undefined;
}

/** Quản lý các phòng bảng viết theo id buổi học. */
export class RoomHub {
  private readonly rooms = new Map<string, Room>();

  constructor(private readonly lingerMs: number) {}

  join(sessionId: string, peer: Peer): Room {
    let room = this.rooms.get(sessionId);
    if (!room) {
      room = new Room();
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
      room.cleanupTimer = setTimeout(() => this.rooms.delete(sessionId), this.lingerMs);
      room.cleanupTimer.unref();
    }
  }

  /** Danh sách người đang trong phòng (rỗng nếu phòng không tồn tại). */
  peersOf(sessionId: string): Set<Peer> {
    return this.rooms.get(sessionId)?.peers ?? new Set();
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  closeAll(): void {
    for (const room of this.rooms.values()) {
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    }
    this.rooms.clear();
  }
}

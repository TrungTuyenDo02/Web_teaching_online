/** Một phần tử của bảng (Excalidraw). Chỉ cần các trường dùng để so sánh phiên bản. */
export interface BoardElement {
  id: string;
  version: number;
  versionNonce: number;
  isDeleted?: boolean;
  [key: string]: unknown;
}

/**
 * Quy tắc giải quyết xung đột giống Excalidraw: bản mới hơn (version lớn hơn) thắng;
 * nếu bằng nhau thì versionNonce nhỏ hơn thắng để mọi máy cùng chọn một kết quả.
 */
export function shouldAccept(local: BoardElement | undefined, remote: BoardElement): boolean {
  if (!local) return true;
  if (remote.version !== local.version) return remote.version > local.version;
  return remote.versionNonce < local.versionNonce;
}

export function isBoardElement(value: unknown): value is BoardElement {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    v.id.length > 0 &&
    v.id.length <= 64 &&
    Number.isFinite(v.version) &&
    Number.isFinite(v.versionNonce)
  );
}

/** Nội dung bảng của một buổi học, giữ trong bộ nhớ. */
export class Scene {
  private readonly elements = new Map<string, BoardElement>();

  /** Áp dụng các phần tử nhận được; trả về những phần tử thật sự được nhận (để phát lại cho người khác). */
  apply(incoming: BoardElement[]): BoardElement[] {
    const accepted: BoardElement[] = [];
    for (const el of incoming) {
      if (shouldAccept(this.elements.get(el.id), el)) {
        this.elements.set(el.id, el);
        accepted.push(el);
      }
    }
    return accepted;
  }

  snapshot(): BoardElement[] {
    return [...this.elements.values()];
  }

  get size(): number {
    return this.elements.size;
  }
}

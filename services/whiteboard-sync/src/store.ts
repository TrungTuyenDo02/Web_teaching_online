import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isBoardElement, type BoardElement } from "./scene.ts";

// id buổi học là UUID do API ký; vẫn kiểm tra để không ghi ra ngoài thư mục dữ liệu
const SAFE_ID = /^[A-Za-z0-9-]{1,64}$/;

/** Lưu nội dung bảng mỗi buổi học thành một file JSON. Đủ cho một tiến trình, chưa cần Redis. */
export class SceneStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private file(sessionId: string): string {
    if (!SAFE_ID.test(sessionId)) throw new Error("id buổi học không hợp lệ");
    return join(this.dir, `${sessionId}.json`);
  }

  load(sessionId: string): BoardElement[] {
    const path = this.file(sessionId);
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? data.filter(isBoardElement) : [];
  }

  save(sessionId: string, elements: BoardElement[]): void {
    const path = this.file(sessionId);
    // Ghi file tạm rồi đổi tên: máy chủ tắt giữa chừng cũng không để lại file hỏng
    writeFileSync(`${path}.tmp`, JSON.stringify(elements));
    renameSync(`${path}.tmp`, path);
  }

  /** Dấu "buổi đã kết thúc" nằm cạnh file bảng: khởi động lại máy chủ vẫn chặn token cũ. */
  markEnded(sessionId: string): void {
    writeFileSync(this.file(sessionId).replace(/\.json$/, ".ended"), new Date().toISOString());
  }

  /** Xóa nội dung bảng (xóa học sinh); không có file thì thôi. Dấu đóng được giữ lại. */
  remove(sessionId: string): void {
    const path = this.file(sessionId);
    rmSync(`${path}.tmp`, { force: true });
    rmSync(path, { force: true });
  }

  /** Lỗi đọc đĩa (không phải "không có file") được ném ra, không coi là chưa kết thúc. */
  isEnded(sessionId: string): boolean {
    return statSync(this.file(sessionId).replace(/\.json$/, ".ended"), { throwIfNoEntry: false }) !== undefined;
  }
}

/** Mã lỗi để ghi log: không ghi message vì lỗi JSON.parse có thể chứa một đoạn nội dung bảng. */
export const errorCode = (err: unknown): string =>
  (err as NodeJS.ErrnoException)?.code ?? (err as Error)?.name ?? "unknown";

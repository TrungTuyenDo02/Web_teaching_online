import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isBoardElement, type BoardElement } from "./scene.ts";
import { FILE_ID, makeBoardFile, type BoardFile } from "./images.ts";

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

  loadFiles(sessionId: string): Record<string, BoardFile> {
    const dir = this.file(sessionId).replace(/\.json$/, ".images");
    if (!statSync(dir, { throwIfNoEntry: false })) return {};
    const files: Record<string, BoardFile> = {};
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json") || !FILE_ID.test(name.slice(0, -5))) continue;
      const file = JSON.parse(readFileSync(join(dir, name), "utf8")) as BoardFile;
      const checked = makeBoardFile(file.dataURL.slice(file.dataURL.indexOf(",") + 1), file.mimeType);
      if (file.id !== checked.id || name !== `${checked.id}.json` || !Number.isFinite(file.created)) throw new Error("invalid stored image");
      files[file.id] = file;
    }
    return files;
  }

  saveFile(sessionId: string, file: BoardFile): void {
    if (!FILE_ID.test(file.id)) throw new Error("invalid image id");
    const dir = this.file(sessionId).replace(/\.json$/, ".images");
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${file.id}.json`);
    writeFileSync(`${path}.tmp`, JSON.stringify(file));
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
    // path xuất phát từ id đã kiểm SAFE_ID, luôn bên trong thư mục dữ liệu bảng.
    rmSync(path.replace(/\.json$/, ".images"), { recursive: true, force: true });
  }

  /** Lỗi đọc đĩa (không phải "không có file") được ném ra, không coi là chưa kết thúc. */
  isEnded(sessionId: string): boolean {
    return statSync(this.file(sessionId).replace(/\.json$/, ".ended"), { throwIfNoEntry: false }) !== undefined;
  }
}

/** Mã lỗi để ghi log: không ghi message vì lỗi JSON.parse có thể chứa một đoạn nội dung bảng. */
export const errorCode = (err: unknown): string =>
  (err as NodeJS.ErrnoException)?.code ?? (err as Error)?.name ?? "unknown";

/** Định dạng snapshot có ảnh, không phụ thuộc React hoặc API bảo mật (dùng trên LAN HTTP). */
import { imageHash } from "./boardHash.ts";
export interface BoardFile { id: string; mimeType: string; dataURL: string; created: number }
export interface BoardDocument { version: 2; elements: unknown[]; files: Record<string, BoardFile> }
export const IMAGE_CHUNK_SIZE = 192 * 1024;
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_ID = /^[a-f0-9]{64}$/;

export function readBoardFile(value: unknown): BoardFile {
  if (!value || typeof value !== "object") throw new Error("Ảnh bảng không hợp lệ.");
  const file = value as BoardFile;
  if (!IMAGE_ID.test(file.id) || !["image/png", "image/jpeg", "image/webp"].includes(file.mimeType) ||
    typeof file.dataURL !== "string" || !Number.isFinite(file.created)) throw new Error("Ảnh bảng không hợp lệ.");
  const prefix = `data:${file.mimeType};base64,`;
  const data = file.dataURL.slice(prefix.length);
  if (!file.dataURL.startsWith(prefix) || !data.length || data.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 ||
    data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new Error("Ảnh bảng không hợp lệ.");
  if (imageHash(data) !== file.id) throw new Error("Ảnh bảng không hợp lệ.");
  return { id: file.id, mimeType: file.mimeType, dataURL: file.dataURL, created: file.created };
}

export function readBoardDocument(raw: unknown): BoardDocument {
  const doc = Array.isArray(raw) ? { version: 2, elements: raw, files: {} } : raw as BoardDocument;
  if (!doc || doc.version !== 2 || !Array.isArray(doc.elements) || !doc.files || typeof doc.files !== "object" || Array.isArray(doc.files)) throw new Error("Bảng đã lưu không hợp lệ.");
  const files: Record<string, BoardFile> = {};
  let bytes = 0;
  const entries = Object.entries(doc.files);
  if (entries.length > 20) throw new Error("Bảng đã lưu không hợp lệ.");
  for (const [id, value] of entries) {
    const file = readBoardFile(value);
    if (id !== file.id) throw new Error("Ảnh bảng không hợp lệ.");
    files[id] = file;
    const base64 = file.dataURL.split(",")[1]!;
    bytes += base64.length * 3 / 4 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
  }
  if (bytes > 6 * 1024 * 1024) throw new Error("Bảng đã lưu không hợp lệ.");
  for (const el of doc.elements) {
    if (!el || typeof el !== "object") throw new Error("Bảng đã lưu không hợp lệ.");
    const e = el as { type?: string; fileId?: string };
    if (e.type === "image" && (!e.fileId || !files[e.fileId])) throw new Error("Bảng đã lưu thiếu ảnh.");
  }
  return { version: 2, elements: doc.elements, files };
}

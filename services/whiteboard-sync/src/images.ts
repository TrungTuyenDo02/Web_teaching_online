import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

export interface BoardFile { id: string; mimeType: string; dataURL: string; created: number }
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_ROOM_IMAGE_BYTES = 6 * 1024 * 1024;
export const MAX_IMAGE_CHUNK = 192 * 1024;
export const FILE_ID = /^[a-f0-9]{64}$/;
const MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const fail = (): never => { throw new Error("Ảnh không hợp lệ hoặc vượt giới hạn cho phép."); };
const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
const crc32 = (data: Buffer) => {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/** Kiểm cấu trúc raster/kích thước; từ chối metadata thay vì lưu EXIF/GPS từ client lạ. */
export function validateImage(data: Buffer, mimeType: string): void {
  if (!MIME.has(mimeType) || data.length === 0 || data.length > MAX_IMAGE_BYTES) fail();
  let width = 0, height = 0;
  if (mimeType === "image/png") {
    if (data.length < 45 || data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") fail();
    let at = 8, ended = false;
    const compressed: Buffer[] = [];
    while (at + 12 <= data.length) {
      const size = data.readUInt32BE(at), end = at + size + 12;
      if (end > data.length) fail();
      if (crc32(data.subarray(at + 4, end - 4)) !== data.readUInt32BE(end - 4)) fail();
      const type = data.toString("ascii", at + 4, at + 8);
      if (at === 8 && (type !== "IHDR" || size !== 13)) fail();
      if (type === "IHDR") { width = data.readUInt32BE(at + 8); height = data.readUInt32BE(at + 12); }
      if (["eXIf", "tEXt", "iTXt", "zTXt", "tIME"].includes(type)) fail();
      if (type === "IDAT") compressed.push(data.subarray(at + 8, end - 4));
      at = end;
      if (type === "IEND") { if (size !== 0 || at !== data.length) fail(); ended = true; break; }
    }
    if (!ended || !compressed.length || width > 2560 || height > 2560) fail();
    try { inflateSync(Buffer.concat(compressed), { maxOutputLength: 32 * 1024 * 1024 }); } catch { fail(); }
  } else if (mimeType === "image/jpeg") {
    if (data.readUInt16BE(0) !== 0xffd8 || data.readUInt16BE(data.length - 2) !== 0xffd9) fail();
    let at = 2, scanned = false;
    while (at + 4 <= data.length) {
      if (data[at] !== 0xff) fail();
      const marker = data[at + 1]!;
      if (marker === 0xff) { at++; continue; }
      if (marker === 0xda) {
        const header = data.readUInt16BE(at + 2);
        if (!width || !height || header < 6 || at + 2 + header >= data.length - 2) fail();
        scanned = true; break;
      }
      if (marker === 0xd9) break;
      const size = data.readUInt16BE(at + 2);
      if (size < 2 || at + size + 2 > data.length || [0xe1, 0xed, 0xfe].includes(marker)) fail();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (size < 8) fail();
        height = data.readUInt16BE(at + 5); width = data.readUInt16BE(at + 7);
      }
      at += size + 2;
    }
    if (!scanned) fail();
  } else {
    if (data.length < 25 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP" || data.readUInt32LE(4) + 8 !== data.length) fail();
    let at = 12, imageData = false;
    while (at + 8 <= data.length) {
      const kind = data.toString("ascii", at, at + 4), size = data.readUInt32LE(at + 4), start = at + 8;
      if (start + size > data.length || ["EXIF", "XMP ", "ANIM", "ANMF"].includes(kind)) fail();
      if (kind === "VP8X" && size >= 10) {
        if (data[start]! & (0x08 | 0x04 | 0x02)) fail();
        width = data.readUIntLE(start + 4, 3) + 1; height = data.readUIntLE(start + 7, 3) + 1;
      }
      if (kind === "VP8 " && size >= 10) {
        if (data.subarray(start + 3, start + 6).toString("hex") !== "9d012a") fail();
        imageData = true;
        if (!width) { width = data.readUInt16LE(start + 6) & 0x3fff; height = data.readUInt16LE(start + 8) & 0x3fff; }
      }
      if (kind === "VP8L" && size >= 5) {
        if (data[start] !== 0x2f) fail();
        imageData = true;
        if (!width) { const bits = data.readUInt32LE(start + 1); width = (bits & 0x3fff) + 1; height = ((bits >>> 14) & 0x3fff) + 1; }
      }
      at = start + size + (size & 1);
    }
    if (at !== data.length || !imageData) fail();
  }
  if (!width || !height || width > 2560 || height > 2560) fail();
}

export function makeBoardFile(base64: string, mimeType: string): BoardFile {
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) fail();
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64) fail();
  validateImage(bytes, mimeType);
  return { id: createHash("sha256").update(bytes).digest("hex"), mimeType, dataURL: `data:${mimeType};base64,${base64}`, created: Date.now() };
}

/** Một lượt mỗi phòng, timeout cố định để dữ liệu dở không tích lũy vô hạn. */
export class ImageUpload {
  private data = "";
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(readonly uploadId: string, readonly mimeType: string, readonly total: number, expired: () => void) {
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(uploadId) || !MIME.has(mimeType) || !Number.isInteger(total) || total <= 0 || total > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) fail();
    this.timer = setTimeout(expired, 60_000); this.timer.unref();
  }
  add(offset: unknown, chunk: unknown): BoardFile | undefined {
    if (offset !== this.data.length || typeof chunk !== "string" || !chunk.length || chunk.length > MAX_IMAGE_CHUNK || this.data.length + chunk.length > this.total) fail();
    this.data += chunk;
    if (this.data.length !== this.total) return;
    const completed = this.data;
    this.stop();
    return makeBoardFile(completed, this.mimeType);
  }
  stop(): void { clearTimeout(this.timer); this.data = ""; }
}

export function* fileMessages(file: BoardFile) {
  const data = file.dataURL.slice(file.dataURL.indexOf(",") + 1);
  for (let offset = 0; offset < data.length; offset += MAX_IMAGE_CHUNK) {
    yield { type: "file_data", id: file.id, mimeType: file.mimeType, created: file.created, offset, total: data.length, data: data.slice(offset, offset + MAX_IMAGE_CHUNK) };
  }
}

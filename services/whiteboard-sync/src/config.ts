import { config as loadEnv } from "dotenv";

// Đọc .env ở thư mục gốc dự án (nếu có); biến môi trường thật luôn được ưu tiên
loadEnv({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

export interface Config {
  port: number;
  jwtSecret: string;
  allowedOrigins: string[];
  /** Thời gian giữ nội dung bảng sau khi mọi người đã rời phòng (để nối lại khi rớt mạng) */
  roomLingerMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = env.WHITEBOARD_JWT_SECRET ?? "";
  if (!jwtSecret) {
    throw new Error("Thiếu WHITEBOARD_JWT_SECRET (xem .env.example)");
  }
  return {
    port: Number(env.WHITEBOARD_SYNC_PORT ?? 8787),
    jwtSecret,
    allowedOrigins: (env.CORS_ORIGINS ?? "http://localhost:5173")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    roomLingerMs: Number(env.WHITEBOARD_ROOM_LINGER_MS ?? 10 * 60 * 1000),
  };
}

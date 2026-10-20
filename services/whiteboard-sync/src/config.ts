import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

// fileURLToPath thay vì URL.pathname: pathname cho "/F:/..." trên Windows, sai đường dẫn
export const ROOT_ENV_PATH = fileURLToPath(new URL("../../../.env", import.meta.url));

/**
 * Đọc .env ở thư mục gốc dự án (nếu có) vào process.env; biến môi trường thật luôn được ưu tiên.
 * Chỉ điểm khởi động thật gọi hàm này (server.ts khi chạy trực tiếp): import module không đọc file,
 * nên test và máy chủ thử cục bộ (dev/local-board.ts) không chạm tới file bí mật.
 */
export function loadRootEnv(path = ROOT_ENV_PATH): void {
  loadEnv({ path, quiet: true });
}

export interface Config {
  port: number;
  jwtSecret: string;
  allowedOrigins: string[];
  /** Thời gian giữ nội dung bảng trong bộ nhớ sau khi mọi người đã rời phòng */
  roomLingerMs: number;
  /** Thư mục lưu nội dung bảng (bỏ trống: chỉ giữ trong bộ nhớ, dùng cho test) */
  dataDir?: string;
  /** Chờ bao lâu sau nét vẽ cuối rồi ghi xuống đĩa */
  saveDelayMs?: number;
  /** Chu kỳ máy chủ ping khung điều khiển; không phản hồi trong một chu kỳ thì gỡ kết nối (mặc định 15 s) */
  heartbeatMs?: number;
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
    dataDir: env.WHITEBOARD_DATA_DIR || fileURLToPath(new URL("../../../data/boards", import.meta.url)),
    saveDelayMs: Number(env.WHITEBOARD_SAVE_DELAY_MS ?? 2000),
  };
}

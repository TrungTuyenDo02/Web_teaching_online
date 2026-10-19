import { jwtVerify } from "jose";

export interface BoardClaims {
  /** id người dùng */
  sub: string;
  /** id buổi học */
  sid: string;
  role: "teacher" | "student";
  mode: "main" | "board";
}

/** Kiểm tra token do API cấp (HS256). Ném lỗi nếu sai chữ ký, hết hạn hoặc thiếu trường. */
export async function verifyBoardToken(token: string, secret: string): Promise<BoardClaims> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
  });
  const { sub, sid, role, mode } = payload as Record<string, unknown>;
  if (typeof sub !== "string" || typeof sid !== "string") {
    throw new Error("Token thiếu sub/sid");
  }
  if (role !== "teacher" && role !== "student") throw new Error("Token có role không hợp lệ");
  if (mode !== "main" && mode !== "board") throw new Error("Token có mode không hợp lệ");
  return { sub, sid, role, mode };
}

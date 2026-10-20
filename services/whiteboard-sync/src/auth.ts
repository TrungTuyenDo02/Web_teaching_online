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
  const { sub, sid, role, mode, act } = payload as Record<string, unknown>;
  if (act !== undefined) throw new Error("Token đóng phòng không dùng để vào phòng");
  if (typeof sub !== "string" || typeof sid !== "string") {
    throw new Error("Token thiếu sub/sid");
  }
  if (role !== "teacher" && role !== "student") throw new Error("Token có role không hợp lệ");
  if (mode !== "main" && mode !== "board") throw new Error("Token có mode không hợp lệ");
  return { sub, sid, role, mode };
}

/**
 * Token API ký để đóng phòng ({sid, act:"close"}, khi kết thúc buổi) hoặc xóa dữ liệu bảng
 * ({sid, act:"purge"}, khi xóa học sinh); trả về id buổi học.
 */
export async function verifyCloseToken(token: string, secret: string, expectedAct = "close"): Promise<string> {
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
    algorithms: ["HS256"],
  });
  const { sid, act } = payload as Record<string, unknown>;
  if (act !== expectedAct || typeof sid !== "string") throw new Error("Không phải token đóng phòng");
  return sid;
}

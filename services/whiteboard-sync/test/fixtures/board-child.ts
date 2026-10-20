// Máy chủ bảng thử chạy trong tiến trình con (crash.test.ts): cổng ngẫu nhiên, dữ liệu giả trong thư mục tạm.
// Báo cổng qua stdout; tự thoát khi tiến trình cha đóng stdin (cha chết giữa chừng cũng không bỏ sót).
import { createBoardServer } from "../../src/server.ts";

const board = createBoardServer({
  port: 0,
  jwtSecret: process.env.TEST_BOARD_SECRET ?? "",
  allowedOrigins: ["http://localhost:5173"],
  roomLingerMs: 60_000,
  dataDir: process.env.TEST_BOARD_DATA_DIR,
  saveDelayMs: 50,
});
const port = await board.listen(0);
process.stdout.write(`${JSON.stringify({ port })}\n`);
process.stdin.resume();
process.stdin.on("end", () => process.exit(0));

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { ROOT_ENV_PATH } from "../src/config.ts";
import { isMain } from "../src/server.ts";

// Lỗi cũ: so sánh `file://${argv[1]}` và dùng URL.pathname chỉ đúng trên Linux/macOS,
// nên trên Windows máy chủ không khởi động và không đọc được cấu hình ở thư mục gốc.
describe("khởi động trên mọi hệ điều hành", () => {
  it("nhận ra file đang được chạy trực tiếp", () => {
    const url = import.meta.url;
    assert.equal(isMain(url, fileURLToPath(url)), true);
    assert.equal(isMain(url, undefined), false);
  });

  it("đường dẫn file cấu hình trỏ đúng thư mục gốc dự án", () => {
    assert.ok(existsSync(join(dirname(ROOT_ENV_PATH), "Makefile")));
  });
});

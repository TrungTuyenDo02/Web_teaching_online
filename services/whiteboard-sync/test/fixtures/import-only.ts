// Chỉ import (không chạy) các module máy chủ bảng; env-loading.test.ts kiểm không có lần đọc file môi trường.
await import("../../src/config.ts");
await import("../../src/server.ts");
await import("../../dev/local-board.ts");
process.stdout.write("DA_IMPORT\n");

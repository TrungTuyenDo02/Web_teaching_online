// Nạp trước (--import) trong tiến trình con của env-loading.test.ts: chặn và báo MỌI lần đọc file
// có tên ".env", để kiểm chứng việc import module không đọc file môi trường mà không bao giờ đọc thật.
import fs from "node:fs";
import { basename } from "node:path";

const original = fs.readFileSync;
fs.readFileSync = function (path, ...rest) {
  if ((typeof path === "string" || path instanceof URL) && basename(String(path)) === ".env") {
    process.stdout.write("CO_DOC_FILE_MOI_TRUONG\n");
    throw Object.assign(new Error("bị chặn trong test"), { code: "ENOENT" });
  }
  return original.call(this, path, ...rest);
};

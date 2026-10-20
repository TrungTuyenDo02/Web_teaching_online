import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { loadRootEnv } from "../src/config.ts";

// Trước đây config.ts nạp file môi trường gốc ngay khi được import, nên mọi test và máy chủ thử
// đều đọc file bí mật. Giờ chỉ điểm khởi động thật (server.ts chạy trực tiếp) gọi loadRootEnv().
const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

describe("nạp file môi trường", () => {
  it("import config/server/local-board không đọc file môi trường", { timeout: 30_000 }, () => {
    const execArgv = process.execArgv.filter((arg) => !arg.startsWith("--test"));
    const out = execFileSync(
      process.execPath,
      [...execArgv, "--import", pathToFileURL(fixture("block-env-read.mjs")).href, fixture("import-only.ts")],
      { encoding: "utf8", timeout: 20_000 },
    );
    assert.match(out, /DA_IMPORT/);
    assert.doesNotMatch(out, /CO_DOC_FILE_MOI_TRUONG/);
  });

  it("loadRootEnv vẫn nạp file khi được gọi (cách chạy production giữ nguyên)", () => {
    const dir = mkdtempSync(join(tmpdir(), "board-env-"));
    try {
      const file = join(dir, "gia-tri-gia.txt");
      writeFileSync(file, "BOARD_ENV_LOADING_TEST=da-nap\n");
      delete process.env.BOARD_ENV_LOADING_TEST;
      loadRootEnv(file);
      assert.equal(process.env.BOARD_ENV_LOADING_TEST, "da-nap");
    } finally {
      delete process.env.BOARD_ENV_LOADING_TEST;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});


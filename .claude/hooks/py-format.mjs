// PostToolUse: sau khi sửa file .py trong apps/api thì chạy ruff check --fix rồi ruff format.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { tool_input: input = {} } = JSON.parse(readFileSync(0, "utf8"));
const file = input.file_path ?? "";
if (!/apps[\\/]api[\\/].*\.py$/.test(file)) process.exit(0);

const venv = join(process.env.CLAUDE_PROJECT_DIR ?? ".", "apps", "api", ".venv");
const ruff = [join(venv, "Scripts", "ruff.exe"), join(venv, "bin", "ruff")].find(existsSync);
if (!ruff) process.exit(0); // chưa chạy make install-api

const cwd = join(process.env.CLAUDE_PROJECT_DIR ?? ".", "apps", "api"); // để ruff đọc pyproject.toml
const check = spawnSync(ruff, ["check", "--fix", "--quiet", file], { cwd, encoding: "utf8" });
spawnSync(ruff, ["format", "--quiet", file], { cwd });
if (check.status !== 0) {
  process.stderr.write(`ruff còn lỗi trong ${file}:\n${check.stdout}${check.stderr}`);
  process.exit(2);
}

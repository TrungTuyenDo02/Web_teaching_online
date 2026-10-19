// PreToolUse: chặn các việc AGENTS.md cấm. Exit 2 = chặn, stderr gửi lại cho Claude.
import { existsSync, readFileSync } from "node:fs";

const { tool_name: tool, tool_input: input = {} } = JSON.parse(readFileSync(0, "utf8"));
const block = (msg) => {
  process.stderr.write(msg + "\n");
  process.exit(2);
};
const path = (input.file_path ?? input.notebook_path ?? "").replaceAll("\\", "/");

// 1. Không đọc/sửa file .env (cho phép .env.example)
const ENV_FILE = /(?:^|[\s/\\"'=:])\.env(\.[\w.-]+)?(?![\w])/g;
const touchesEnv = (s) => [...(s ?? "").matchAll(ENV_FILE)].some((m) => m[1] !== ".example");
const targets = {
  Read: [path],
  Edit: [path],
  MultiEdit: [path],
  Write: [path],
  NotebookEdit: [path],
  Bash: [input.command],
  PowerShell: [input.command],
  Grep: [input.path, input.glob],
  Glob: [input.path, input.pattern],
}[tool] ?? [];
if (targets.some(touchesEnv)) {
  block("Chặn: không đọc, in hay sửa file .env (AGENTS.md). Chỉ dùng .env.example.");
}

const isWrite = ["Edit", "MultiEdit", "Write"].includes(tool);

// 2. Không sửa migration đã có: tạo file mới đánh số tiếp
if (isWrite && /supabase\/migrations\/[^/]+\.sql$/.test(path) && existsSync(path)) {
  block("Chặn: không sửa migration đã có. Tạo file migration mới, đánh số tiếp (supabase/AGENTS.md).");
}

// 3. Khóa bí mật không được xuất hiện trong web
const text = [input.content, input.new_string, ...(input.edits ?? []).map((e) => e.new_string)].join("\n");
if (isWrite && /(^|\/)apps\/web\//.test(path) && /SERVICE_ROLE|LIVEKIT_API_SECRET|WHITEBOARD_JWT_SECRET/.test(text)) {
  block("Chặn: khóa bí mật chỉ dùng ở apps/api và services/whiteboard-sync, không đưa vào apps/web.");
}

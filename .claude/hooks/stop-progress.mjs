// Stop: nếu có file code mới hơn docs/progress.md thì yêu cầu Claude cập nhật sổ tiến độ (một lần).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const { stop_hook_active } = JSON.parse(readFileSync(0, "utf8"));
if (stop_hook_active) process.exit(0); // đã nhắc rồi, không lặp

const root = process.env.CLAUDE_PROJECT_DIR ?? ".";
const SKIP = new Set(["node_modules", "dist", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache", ".git", ".claude"]);
const DIRS = ["apps", "services", "supabase"];

let newest = 0;
let newestFile = "";
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (!e.name.startsWith(".env") && !e.name.endsWith(".md")) {
      const t = statSync(p).mtimeMs;
      if (t > newest) [newest, newestFile] = [t, p];
    }
  }
};
DIRS.forEach((d) => {
  try {
    walk(join(root, d));
  } catch {}
});

let progress = 0;
try {
  progress = statSync(join(root, "docs", "progress.md")).mtimeMs;
} catch {}

if (newest > progress) {
  console.log(
    JSON.stringify({
      decision: "block",
      reason: `Code đã đổi (${newestFile}) sau lần cập nhật docs/progress.md gần nhất. Cập nhật "Đang làm" và thêm một dòng "Nhật ký" (việc đã xong, test đã chạy và kết quả thật, việc chưa thử) theo docs/AGENTS.md, rồi kết thúc.`,
    }),
  );
}

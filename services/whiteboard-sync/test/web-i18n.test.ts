// Song ngữ của web (apps/web/src/lib/i18n.ts): mọi chuỗi tiếng Việt hiện ra phải có bản tiếng Anh.
// Đọc mã nguồn bằng TypeScript (không chạy trình duyệt); test trình duyệt kiểm phần hiển thị thật.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { en } from "../../../apps/web/src/lib/i18n-en.ts";
import { lang, setLang, t } from "../../../apps/web/src/lib/i18n.ts";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/web/src");
const VIETNAMESE = /[À-ỹđĐ]/u;

// Chuỗi không hiện cho người dùng hoặc là tên riêng
const ALLOW = new Set([
  "Gia sư online", // tên thương hiệu (brand.ts)
  "Tiếng Việt", // tên ngôn ngữ viết bằng chính nó (LangSwitch)
  "useAuth phải nằm trong AuthProvider", // lỗi lập trình
  "Phần tử bảng quá lớn, không đồng bộ được", // console.warn
  "Chưa xóa xong", // so khớp câu lỗi gốc của API (StudentsPage)
  "trùng giờ", "thời gian đã qua", "tối đa 4 giờ", "giờ kết thúc", "học sinh", // sessionErrorField so khớp câu API
]);
// Màn hình cấu hình cho người cài đặt (thiếu biến môi trường), không phải người học
const ALLOW_JSX_FILES = new Set(["App.tsx"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "dev" ? [] : sources(full); // src/dev chỉ có ở bản development
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") && entry.name !== "i18n-en.ts" ? [full] : [];
  });
}

interface Finding {
  file: string;
  line: number;
  text: string;
}

function scan() {
  const keys: Finding[] = [];
  const literals: Finding[] = [];
  const raw: Finding[] = [];
  for (const file of sources(SRC)) {
    const rel = path.relative(SRC, file).replaceAll("\\", "/");
    const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const at = (node: ts.Node, text: string): Finding => ({ file: rel, line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteralLike(arg)) keys.push(at(arg, arg.text));
      }
      if (ts.isStringLiteralLike(node) && VIETNAMESE.test(node.text)) literals.push(at(node, node.text));
      if (ts.isTemplateExpression(node)) {
        const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("…");
        if (VIETNAMESE.test(parts)) raw.push(at(node, `template: ${parts}`));
      }
      if (ts.isJsxText(node) && VIETNAMESE.test(node.text) && !ALLOW_JSX_FILES.has(rel)) raw.push(at(node, `JSX: ${node.text.trim()}`));
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return { keys, literals, raw };
}

const show = (items: Finding[]) => items.map((f) => `${f.file}:${f.line} ${f.text}`);

describe("song ngữ trên web", () => {
  const { keys, literals, raw } = scan();

  it("tìm thấy chuỗi cần dịch (đối chứng: bộ quét chạy thật)", () => {
    assert.ok(keys.length > 150, `chỉ thấy ${keys.length} lời gọi t()`);
    assert.ok(keys.some((k) => k.text === "Đăng nhập" && k.file === "pages/LoginPage.tsx"));
  });

  it("mọi khóa t() có bản tiếng Anh", () => {
    assert.deepEqual(show(keys.filter((k) => !(k.text in en))), []);
  });

  it("mọi chuỗi tiếng Việt trong code đều có bản tiếng Anh (hoặc được miễn có lý do)", () => {
    assert.deepEqual(show(literals.filter((l) => !(l.text in en) && !ALLOW.has(l.text))), []);
  });

  it("không có chữ tiếng Việt viết thẳng trong JSX hay template literal (phải qua t())", () => {
    assert.deepEqual(show(raw), []);
  });

  it("bản dịch giữ nguyên các biến {tên}", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const broken = Object.entries(en).filter(([vi, english]) => vars(vi).join() !== vars(english).join());
    assert.deepEqual(broken, []);
  });

  it("t() thay biến, đổi ngôn ngữ và quay về tiếng Việt", () => {
    assert.equal(lang(), "vi"); // Node không có localStorage: mặc định tiếng Việt
    assert.equal(t("Bắt đầu sau {n} phút", { n: 5 }), "Bắt đầu sau 5 phút");
    (globalThis as { document?: unknown }).document = { documentElement: {} };
    try {
      setLang("en");
      assert.equal(t("Bắt đầu sau {n} phút", { n: 5 }), en["Bắt đầu sau {n} phút"]!.replace("{n}", "5"));
      assert.equal(t("Câu chưa có bản dịch"), "Câu chưa có bản dịch");
    } finally {
      setLang("vi");
      delete (globalThis as { document?: unknown }).document;
    }
    assert.equal(t("Đăng nhập"), "Đăng nhập");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { teachingNotesExport } from "../../../apps/web/src/lib/teachingNotesExport.ts";

describe("xuất ghi chú riêng", () => {
  const records = [{
    scheduled_start: "2026-09-30T17:00:00Z", summary_md: '=HYPERLINK("x")',
    understanding_level: "Cần luyện", improve_points: 'Dòng 1\n"Dòng 2"',
    homework_text: "```\n<script>x</script>\n```", topic_ids: ["t1"],
  }];
  const topics = [{ id: "t1", name: "Số hữu tỉ", grade: "7" }];
  it("CSV giữ tiếng Việt, giờ VN, quote xuống dòng và vô hiệu công thức", () => {
    const text = teachingNotesExport("@Em Thử", "2026-10", records, topics, "csv");
    assert.ok(text.startsWith("\uFEFF"));
    assert.ok(text.includes('"\'@Em Thử"'));
    assert.ok(text.includes('"\'=HYPERLINK(""x"")"'));
    assert.ok(text.includes('"Dòng 1\n""Dòng 2"""'));
    assert.ok(text.includes("01/10/2026") && text.includes("00:00"));
    assert.ok(text.includes("Số hữu tỉ (lớp 7)"));
    assert.ok(!text.includes("topic_ids"));
  });
  it("Markdown bao nội dung nhập trong fence đủ dài, không tạo HTML ngoài fence", () => {
    const text = teachingNotesExport("<img src=x>", "2026-10", records, topics, "md");
    assert.ok(text.includes("```text\n<img src=x>"));
    assert.ok(text.includes("````text\n```\n<script>x</script>\n```\n````"));
    assert.ok(text.includes("Số hữu tỉ (lớp 7)"));
  });
});

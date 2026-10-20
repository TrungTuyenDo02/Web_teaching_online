import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { monthlyReportCsv } from "../../../apps/web/src/lib/reportCsv.ts";

describe("CSV báo cáo tháng", () => {
  it("giữ tiếng Việt, quote dấu phẩy/xuống dòng và vô hiệu công thức", () => {
    const text = monthlyReportCsv({
      month: "2026-10",
      students: [
        { full_name: '=HYPERLINK("x")', grade: "9", completed_sessions: 1 },
        { full_name: 'Em, Thử\n"A"', grade: "  +2", completed_sessions: 1 },
      ],
    });
    assert.ok(text.startsWith("\uFEFF"));
    assert.ok(text.includes('"\'=HYPERLINK(""x"")"'));
    assert.ok(text.includes('"Em, Thử\n""A"""'));
    assert.ok(text.includes('"\'  +2"'));
  });
});

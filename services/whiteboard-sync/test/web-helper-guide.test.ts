// Hướng dẫn cục bộ của linh vật (apps/web/src/lib/helperGuide.ts): câu hỏi tới đúng mục, đúng vai trò.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { answerGuide, guideSuggestions } from "../../../apps/web/src/lib/helperGuide.ts";

const links = (question: string, role: "teacher" | "student") => answerGuide(question, role).links.map((l) => l.to);
const text = (question: string, role: "teacher" | "student") => answerGuide(question, role).text;

describe("hướng dẫn của linh vật", () => {
  it("nộp, giao và chấm bài có mục riêng theo vai trò", () => {
    assert.match(text("Nộp bài thế nào?", "student"), /Chụp ảnh/);
    assert.match(text("em muốn nộp lại bài tập", "student"), /Nộp lại/);
    assert.deepEqual(links("Chấm bài ở đâu", "teacher"), ["/assignments"]);
    assert.deepEqual(links("giao bài về nhà cho học sinh", "teacher"), ["/assignments"]);
  });

  it("giáo viên hỏi chấm nhanh thì được chỉ mục Chờ chấm và nhận xét có sẵn", () => {
    assert.match(text("Làm sao chấm bài nhanh?", "teacher"), /Chờ chấm/);
    assert.match(text("nhận xét mẫu ở đâu", "teacher"), /nhận xét có sẵn/);
    assert.doesNotMatch(text("chấm bài nhanh", "student"), /Chờ chấm/); // học sinh không chấm bài
  });

  it("so khớp trọn từ và cụm cụ thể trước từ chung", () => {
    assert.deepEqual(links("Xem lịch sử buổi học", "student"), ["/history"]); // không phải lịch học
    assert.match(text("Tiếng tới chậm quá", "teacher"), /tai nghe/); // chậm ≠ chấm bài
    assert.match(text("bị vọng tiếng", "student"), /tai nghe/);
    assert.match(text("Về trang chính", "student"), /Mình chưa hiểu/); // "về" không phải "vẽ"
  });

  it("vẫn từ chối giải bài và không mở trang quản lý cho học sinh", () => {
    assert.match(text("Giải bài toán giúp em", "student"), /chưa giải đáp kiến thức/);
    assert.deepEqual(links("Xem báo cáo tháng", "student"), ["/history"]);
    assert.deepEqual(links("Xem báo cáo tháng", "teacher"), ["/reports"]);
  });

  it("mỗi câu gợi ý trả lời đúng mục, không rơi vào câu mặc định", () => {
    for (const role of ["teacher", "student"] as const) {
      for (const question of ["/", "/assignments", "/students"].flatMap((path) => guideSuggestions(role, path))) {
        assert.doesNotMatch(text(question, role), /Mình chưa hiểu/, question);
      }
    }
  });
});

// Hàm lịch học của web (apps/web/src/lib/schedule.ts), chạy trong Node như client.test.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  groupByDay,
  nextSession,
  relativeStart,
  sessionErrorField,
} from "../../../apps/web/src/lib/schedule.ts";

const now = new Date(2026, 9, 20, 9, 0); // 20/10/2026 09:00 giờ địa phương
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const s = (id: string, status: string, start: string, end: string) => ({ id, status, scheduled_start: start, scheduled_end: end });

describe("lịch học trên web", () => {
  it("buổi nổi bật: đang diễn ra trước, rồi buổi sắp học sớm nhất chưa hết giờ", () => {
    const past = s("qua", "scheduled", at(20, 7), at(20, 8)); // chưa vào, đã hết giờ
    const later = s("chieu", "scheduled", at(20, 14), at(20, 15));
    const soon = s("sang", "scheduled", at(20, 9, 20), at(20, 10));
    assert.equal(nextSession([later, past, soon], now)?.id, "sang");
    const live = s("dang", "live", at(20, 8, 30), at(20, 9, 30));
    assert.equal(nextSession([soon, live], now)?.id, "dang");
    assert.equal(nextSession([past], now), undefined);
  });

  it("chia hôm nay / ngày sau theo giờ địa phương, bỏ buổi nổi bật", () => {
    const a = s("a", "scheduled", at(20, 10), at(20, 11));
    const b = s("b", "scheduled", at(20, 16), at(20, 17));
    const c = s("c", "scheduled", at(21, 8), at(21, 9));
    const { today, later } = groupByDay([c, b, a], now, a);
    assert.deepEqual(today.map((x) => x.id), ["b"]);
    assert.deepEqual(later.map((x) => x.id), ["c"]);
  });

  it("câu thời gian ngắn", () => {
    assert.equal(relativeStart(s("x", "live", at(20, 8), at(20, 10)), now), "Đang diễn ra");
    assert.equal(relativeStart(s("x", "scheduled", at(20, 9, 25), at(20, 10)), now), "Bắt đầu sau 25 phút");
    assert.equal(relativeStart(s("x", "scheduled", at(20, 8, 50), at(20, 10)), now), "Đã đến giờ học");
    assert.match(relativeStart(s("x", "scheduled", at(21, 14), at(21, 15)), now), /^Ngày mai · 14:00$/);
  });

  it("lỗi của API gắn vào đúng trường", () => {
    assert.equal(sessionErrorField("Trùng giờ với một buổi học khác"), "start");
    assert.equal(sessionErrorField("Không xếp được buổi học vào thời gian đã qua"), "start");
    assert.equal(sessionErrorField("Một buổi học dài tối đa 4 giờ"), "duration");
    assert.equal(sessionErrorField("Học sinh đã ngừng dạy"), "student");
    assert.equal(sessionErrorField("Lỗi 500"), "form");
  });
});

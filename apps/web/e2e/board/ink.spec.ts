/**
 * INK-01: đo một nét bút tự do (freedraw) đi từ máy giáo viên sang máy học sinh qua máy chủ bảng THẬT chạy cục bộ.
 * Bút giả lập qua DevTools (pointerType "pen", có lực nhấn) nên Excalidraw ghi cả mảng lực như bút thật.
 * Số đo in ra console và đính kèm báo cáo. Chỉ là đường phần mềm trên một máy (không Wi-Fi, không bút thật):
 * đo trên tablet thật theo docs/tablet-wifi.md.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures/test";
import { openBoard, uniqueRoom } from "../fixtures/board";

const POINTS = 240; // một nét dài liên tục (~2 giây ở nhịp bút thật 120 Hz)
const MOVE_GAP_MS = 8; // nghỉ giữa hai sự kiện bút (cộng thời gian trang xử lý)

type Api = { getSceneElements(): { type: string; points?: unknown[] }[] };
const freedraw = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __devBoardApi: Api }).__devBoardApi.getSceneElements().find((e) => e.type === "freedraw"),
  );

/** Máy học sinh: ghi [số điểm của nét, giờ] mỗi khi nét nhận được dài thêm. Không cài bên giáo viên: thăm dò
 *  liên tục chiếm luồng chính và làm chậm chính sự kiện bút đang đo. */
function startSampler(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __devBoardApi: Api; __inkLog: [number, number][] };
    w.__inkLog = [];
    let last = 0;
    setInterval(() => {
      const n = w.__devBoardApi.getSceneElements().find((e) => e.type === "freedraw")?.points?.length ?? 0;
      if (n > last) w.__inkLog.push([(last = n), Date.now()]);
    }, 4);
  });
}

const avg = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) / values.length);
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
  return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1)! };
};

test("INK-01 đo nét bút: thời gian xử lý, độ trễ sang máy học sinh, dung lượng gửi đi @perf", async ({ newContext }, info) => {
  test.setTimeout(90_000);
  const room = uniqueRoom(info);
  const teacher = await (await newContext("giáo viên")).newPage();
  const student = await (await newContext("học sinh")).newPage();
  let bytes = 0;
  let frames = 0;
  teacher.on("websocket", (ws) =>
    ws.on("framesent", (f) => {
      const text = String(f.payload);
      if (!text.includes('"type":"update"')) return;
      bytes += Buffer.byteLength(text);
      frames++;
    }),
  );
  await openBoard(teacher, "teacher", room);
  await openBoard(student, "student", room);
  await startSampler(student);

  const box = (await teacher.locator(".excalidraw__canvas.interactive").boundingBox())!;
  await teacher.mouse.click(box.x + box.width - 40, box.y + box.height / 2);
  await teacher.keyboard.press("p");
  const cdp = await teacher.context().newCDPSession(teacher);
  // Lệnh trả về khi trang đã xử lý xong sự kiện, nên thời gian lệnh ≈ thời gian luồng chính xử lý một sự kiện bút
  const pen = (type: "mousePressed" | "mouseMoved" | "mouseReleased", i: number) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x: box.x + 380 + i * 2.5,
      y: box.y + 260 + 40 * Math.sin(i / 6),
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
      pointerType: "pen",
      force: 0.4 + 0.3 * Math.abs(Math.sin(i / 10)),
    });

  const handled: number[] = []; // handled[k]: lúc nét bên giáo viên đã có k + 1 điểm
  const eventMs: number[] = [];
  await pen("mousePressed", 0);
  handled.push(Date.now());
  for (let i = 1; i <= POINTS; i++) {
    const t0 = Date.now();
    await pen("mouseMoved", i);
    handled.push(Date.now());
    eventMs.push(handled.at(-1)! - t0);
    await teacher.waitForTimeout(MOVE_GAP_MS);
  }
  await pen("mouseReleased", POINTS);

  const final = await freedraw(teacher);
  const finalPoints = final?.points?.length ?? 0;
  expect(finalPoints).toBeGreaterThan(POINTS);
  const studentLog = () => student.evaluate(() => (window as unknown as { __inkLog: [number, number][] }).__inkLog);
  await expect.poll(async () => (await studentLog()).at(-1)?.[0]).toBe(finalPoints);
  const log = await studentLog();

  // Mốc n điểm: lúc giáo viên xử lý xong → lúc học sinh có ít nhất n điểm (cùng đồng hồ máy)
  const latencies = handled.map((t, k) => log.find(([m]) => m >= k + 1)![1] - t);
  const finalSize = JSON.stringify(final).length;
  const metrics = {
    points: finalPoints,
    teacherEventMs: { ...stats(eventMs), first20Avg: avg(eventMs.slice(0, 20)), last20Avg: avg(eventMs.slice(-20)) },
    latencyToStudentMs: stats(latencies),
    updateFrames: frames,
    sentKB: Math.round(bytes / 1024),
    finalElementKB: Math.round(finalSize / 1024),
    resendFactor: Math.round((bytes / finalSize) * 10) / 10,
  };
  console.log(`INK-01 ${JSON.stringify(metrics)}`);
  await info.attach("ink-metrics.json", { body: JSON.stringify(metrics, null, 2), contentType: "application/json" });

  // Ngưỡng hiện có trong checklist tablet (nét hiện bên kia trong ~1 giây); con số thật xem metrics
  expect(metrics.latencyToStudentMs.p95).toBeLessThan(1000);
});

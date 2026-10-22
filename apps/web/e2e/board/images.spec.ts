import { expect, test } from "../fixtures/test";
import { drawRect, openBoard, scene, uniqueRoom } from "../fixtures/board";
import { signIn } from "../fixtures/session";
import { TEACHER } from "../fixtures/fake-backend";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAUAAAAC0CAIAAABqhmJGAAACJUlEQVR4nO3TQQkAMAzAwPpXWwebh31G4OAE5JPZPUDUfC8AnhkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhBoYwA0OYgSHMwBBmYAgzMIQZGMIMDGEGhjADQ5iBIczAEGZgCDMwhBkYwgwMYQaGMANDmIEhzMAQZmAIMzCEGRjCDAxhF6leJNve8iOTAAAAAElFTkSuQmCC", "base64");

test("BOARD-IMG chọn ảnh, học sinh nhận, viết lên và tải lại vẫn đủ ảnh @smoke", async ({ newContext }, info) => {
  const teacher = await (await newContext("giáo viên")).newPage();
  const student = await (await newContext("học sinh")).newPage();
  const room = uniqueRoom(info);
  await openBoard(teacher, "teacher", room); await openBoard(student, "student", room);
  await expect(teacher.getByRole("button", { name: "Chèn ảnh đề bài" })).toBeEnabled();
  await expect(student.getByRole("button", { name: "Chèn ảnh đề bài" })).toHaveCount(0);
  const chooser = teacher.waitForEvent("filechooser");
  await teacher.getByRole("button", { name: "Chèn ảnh đề bài" }).click();
  await (await chooser).setFiles({ name: "de-bai.png", mimeType: "image/png", buffer: png });
  await expect.poll(async () => (await scene(student)).filter(e => e.type === "image").length).toBe(1);
  const image = await student.evaluate(() => {
    const api = (window as any).__devBoardApi;
    const [el] = api.getSceneElements().filter((e: any) => e.type === "image");
    return { id: el.fileId, dataURL: api.getFiles()[el.fileId]?.dataURL };
  });
  expect(image.dataURL).toMatch(/^data:image\/(png|jpeg);base64,/);
  await drawRect(teacher, [120, 120], [250, 200]);
  await expect.poll(async () => (await scene(student)).filter(e => e.type === "rectangle").length).toBe(1);
  await student.reload();
  await student.waitForFunction(() => Boolean((window as any).__devBoardApi));
  await expect.poll(async () => (await scene(student)).length).toBe(2);
  await expect.poll(() => student.evaluate(id => (window as any).__devBoardApi.getFiles()[id]?.dataURL, image.id)).toBe(image.dataURL);
});

test("BOARD-IMG xem lại snapshot có ảnh qua Storage", async ({ page, fake }, info) => {
  await openBoard(page, "teacher", uniqueRoom(info));
  await page.locator('input[type="file"]').setInputFiles({ name: "problem.png", mimeType: "image/png", buffer: png });
  await expect.poll(async () => (await scene(page)).filter(e => e.type === "image").length).toBe(1);
  const document = await page.evaluate(() => {
    const api = (window as any).__devBoardApi;
    return { version: 2, elements: api.getSceneElementsIncludingDeleted(), files: api.getFiles() };
  });
  await signIn(page, TEACHER);
  fake.on("GET", /^\/rest\/v1\/sessions$/, () => ({ status: 200, body: { board_snapshot_path: "stu-a/test.json" } }));
  fake.on("GET", /^\/storage\/v1\/object\/(?:authenticated\/)?boards\/stu-a\/test.json$/, () => ({ status: 200, body: document }));
  await page.goto("/history/saved-image/board");
  await expect(page.getByRole("heading", { name: "Bảng cuối buổi (chỉ xem)" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".excalidraw__canvas.static");
    const ctx = canvas?.getContext("2d");
    if (!ctx || !canvas) return 0;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i]! >= 235 && pixels[i]! <= 245 && pixels[i] === pixels[i + 1] && pixels[i + 2] === 255 && pixels[i + 3] === 255) colored++;
    return colored;
  })).toBeGreaterThan(1000);
});

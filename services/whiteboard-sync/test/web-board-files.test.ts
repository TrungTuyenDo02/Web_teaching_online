import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { readBoardDocument, readBoardFile } from "../../../apps/web/src/lib/boardFiles.ts";
import { imageHash } from "../../../apps/web/src/lib/boardHash.ts";

const DATA = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";
const file = () => ({ id: createHash("sha256").update(Buffer.from(DATA, "base64")).digest("hex"), mimeType: "image/png", dataURL: `data:image/png;base64,${DATA}`, created: 1 });

test("hash chạy trên LAN khớp SHA-256 ở biên khối và ảnh 2 MiB", () => {
  assert.equal(imageHash(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(imageHash("YWJj"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  for (const length of [1, 55, 56, 63, 64, 65, 1024, 2 * 1024 * 1024]) {
    const bytes = Buffer.alloc(length, 0xa7);
    assert.equal(imageHash(bytes.toString("base64")), createHash("sha256").update(bytes).digest("hex"));
  }
});

test("reader không cho dữ liệu ảnh khác nội dung hash vào bảng", () => {
  const original = file();
  assert.equal(readBoardFile(original).id, original.id);
  assert.throws(() => readBoardFile({ ...original, id: "0".repeat(64) }));
});

test("reader giữ bảng cũ, nhận ảnh mới và từ chối ảnh thiếu hoặc URL ngoài", () => {
  const original = file();
  assert.deepEqual(readBoardDocument([{ id: "old", type: "line" }]).elements, [{ id: "old", type: "line" }]);
  const elements = [{ id: "picture", type: "image", fileId: original.id }];
  assert.equal(readBoardDocument({ version: 2, elements, files: { [original.id]: original } }).files[original.id]?.dataURL, original.dataURL);
  assert.throws(() => readBoardDocument({ version: 2, elements, files: {} }));
  assert.throws(() => readBoardFile({ ...original, dataURL: "https://example.com/track.png" }));
});

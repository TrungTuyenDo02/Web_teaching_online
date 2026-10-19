import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Scene, shouldAccept, isBoardElement, type BoardElement } from "../src/scene.ts";

const el = (id: string, version: number, versionNonce = 1): BoardElement => ({
  id,
  version,
  versionNonce,
});

describe("shouldAccept", () => {
  it("nhận phần tử mới", () => {
    assert.equal(shouldAccept(undefined, el("a", 1)), true);
  });
  it("nhận bản có version cao hơn, bỏ bản cũ hơn", () => {
    assert.equal(shouldAccept(el("a", 1), el("a", 2)), true);
    assert.equal(shouldAccept(el("a", 3), el("a", 2)), false);
  });
  it("bằng version thì versionNonce nhỏ hơn thắng", () => {
    assert.equal(shouldAccept(el("a", 2, 10), el("a", 2, 5)), true);
    assert.equal(shouldAccept(el("a", 2, 5), el("a", 2, 10)), false);
    assert.equal(shouldAccept(el("a", 2, 5), el("a", 2, 5)), false);
  });
});

describe("Scene", () => {
  it("chỉ trả về các phần tử thật sự được nhận", () => {
    const scene = new Scene();
    assert.equal(scene.apply([el("a", 1), el("b", 1)]).length, 2);
    const accepted = scene.apply([el("a", 1), el("b", 2)]);
    assert.deepEqual(accepted.map((e) => e.id), ["b"]);
    assert.equal(scene.size, 2);
  });
  it("giữ phần tử đã xóa (isDeleted) để đồng bộ việc xóa", () => {
    const scene = new Scene();
    scene.apply([el("a", 1)]);
    scene.apply([{ ...el("a", 2), isDeleted: true }]);
    assert.equal(scene.snapshot()[0]?.isDeleted, true);
  });
});

describe("isBoardElement", () => {
  it("từ chối dữ liệu sai dạng", () => {
    assert.equal(isBoardElement(null), false);
    assert.equal(isBoardElement({ id: "", version: 1, versionNonce: 1 }), false);
    assert.equal(isBoardElement({ id: "a", version: "1", versionNonce: 1 }), false);
    assert.equal(isBoardElement({ id: "a", version: 1, versionNonce: 1 }), true);
  });
});

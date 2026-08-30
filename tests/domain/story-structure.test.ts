import { describe, expect, it } from "vitest";
import { moveItem } from "../../src/domain/story-structure";
describe("story structure", () => {
  it("moves by stable id without mutating source", () => {
    const source = [{ id: "a" }, { id: "b" }, { id: "c" }],
      next = moveItem(source, "b", -1);
    expect(next.map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(source.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("keeps boundary items in place", () => {
    const source = [{ id: "a" }, { id: "b" }];
    expect(moveItem(source, "a", -1)).toBe(source);
    expect(moveItem(source, "b", 1)).toBe(source);
  });
});

import { describe, expect, it } from "vitest";
import {
  canMoveForeshadow,
  normalizeStateList,
} from "../../src/domain/continuity";

describe("continuity rules", () => {
  it("prevents resolved foreshadowing from silently regressing", () => {
    expect(canMoveForeshadow("planted", "developing")).toBe(true);
    expect(canMoveForeshadow("resolved", "developing")).toBe(false);
  });
  it("normalizes character state facts", () =>
    expect(normalizeStateList(["钥匙", " 钥匙 ", "地图", ""])).toEqual([
      "钥匙",
      "地图",
    ]));
});

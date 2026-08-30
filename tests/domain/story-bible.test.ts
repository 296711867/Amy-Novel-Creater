import { describe, expect, it } from "vitest";
import { normalizeAliases } from "../../src/domain/story-bible";

describe("story bible", () => {
  it("normalizes and deduplicates entity aliases", () => {
    expect(normalizeAliases([" 小林 ", "林舟", "", "林舟"])).toEqual([
      "小林",
      "林舟",
    ]);
  });
});

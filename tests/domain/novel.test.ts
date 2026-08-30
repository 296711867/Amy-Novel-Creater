import { describe, expect, it } from "vitest";
import {
  buildInitialChapters,
  calculateTargetWords,
  countCjkWords,
} from "../../src/domain/novel";

describe("novel planning", () => {
  it("builds stable chapter slots for a planned novel", () => {
    const chapters = buildInitialChapters("novel-1", 3, 2800);
    expect(chapters).toHaveLength(3);
    expect(chapters[2]).toMatchObject({
      id: "novel-1:chapter:3",
      position: 3,
      targetWords: 2800,
    });
  });

  it("calculates the target manuscript size", () => {
    expect(
      calculateTargetWords({ targetChapters: 120, chapterWords: 3000 }),
    ).toBe(360000);
  });

  it("counts Chinese manuscript characters without whitespace", () => {
    expect(countCjkWords("第一段。\n\n第二段。")).toBe(8);
  });
});

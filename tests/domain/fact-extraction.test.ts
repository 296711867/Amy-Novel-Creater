import { describe, expect, it } from "vitest";
import { parseFactExtraction } from "../../src/domain/fact-extraction";
describe("fact extraction boundary", () => {
  it("accepts fenced valid JSON", () => {
    expect(
      parseFactExtraction(
        '```json\n{"proposals":[{"kind":"timeline","title":"抵达月港","payload":{"storyTime":"第三日"}}]}\n```',
      )[0],
    ).toMatchObject({ kind: "timeline", title: "抵达月港" });
  });
  it("rejects unknown proposal kinds", () => {
    expect(() =>
      parseFactExtraction(
        '{"proposals":[{"kind":"guess","title":"猜测","payload":{}}]}',
      ),
    ).toThrow();
  });
});

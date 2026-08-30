import { describe, expect, it } from "vitest";
import {
  PROMPT_TEMPLATES,
  getTemplate,
  renderTemplate,
} from "@domain/prompt-templates";
import { trimAtBoundary } from "@domain/context-pack";
import {
  chapterReviewPrompt,
  parseChapterReview,
} from "@domain/chapter-review";

describe("prompt templates", () => {
  it("renders variables and flags missing placeholders", () => {
    const result = renderTemplate("A {{x}} B {{y}}", { x: 1 });
    expect(result.text).toBe("A 1 B {{y}}");
    expect(result.missingPlaceholders).toEqual(["y"]);
  });
  it("supports overrides per key", () => {
    expect(getTemplate("chapter_instruction")).toBe(
      PROMPT_TEMPLATES.chapter_instruction.template,
    );
    expect(
      getTemplate("chapter_instruction", {
        chapter_instruction: "自定义 {{novelTitle}}",
      }),
    ).toBe("自定义 {{novelTitle}}");
  });
});

describe("trimAtBoundary", () => {
  it("returns short text unchanged", () => {
    expect(trimAtBoundary("短文本", 10)).toBe("短文本");
  });
  it("cuts at a sentence boundary instead of mid-sentence", () => {
    const text = "第一句。第二句。第三句。第四句。";
    const trimmed = trimAtBoundary(text, 8);
    expect(trimmed.endsWith("。")).toBe(true);
    expect(text.startsWith(trimmed)).toBe(true);
    expect(trimmed.length).toBeGreaterThan(0);
  });
  it("falls back to hard cut when no boundary exists", () => {
    const text = "无边界文本连续不断连续不断连续不断";
    expect(trimAtBoundary(text, 5)).toBe(text.slice(0, 5));
  });
});

describe("chapter review", () => {
  it("builds prompt with outline and content", () => {
    const prompt = chapterReviewPrompt("大纲", "正文");
    expect(prompt).toContain("大纲");
    expect(prompt).toContain("正文");
  });
  it("parses fenced JSON review into findings", () => {
    const findings = parseChapterReview(
      '```json\n{"issues":[{"severity":"error","message":"矛盾","evidence":"引文"}]}\n```',
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: "error",
      category: "consistency",
      message: "矛盾",
    });
  });
  it("returns empty list for no issues", () => {
    expect(parseChapterReview('{"issues":[]}')).toEqual([]);
  });
});

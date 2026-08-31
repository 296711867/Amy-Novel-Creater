import { describe, expect, it } from "vitest";
import {
  applyStyleTemplate,
  parseStyleAnalysis,
  styleAnalysisPrompt,
} from "../../src/domain/style-template";

describe("style template", () => {
  it("parses a fenced analysis and injects only the abstract guide", () => {
    const analysis = parseStyleAnalysis(`结果如下：\n\`\`\`json
{"name":"冷雾短句","authorAlias":"北港客","contentSummary":"旅人夜渡。","styleSummary":"短句、克制、近距离感官描写。","styleGuide":"多用短句；对白留白；避免复用来源专名。"}
\`\`\``);
    const prompt = applyStyleTemplate("写第一章", {
      name: analysis.name,
      authorAlias: analysis.authorAlias,
      styleGuide: analysis.styleGuide,
    });
    expect(prompt).toContain("冷雾短句 / 北港客");
    expect(prompt).toContain("多用短句");
    expect(prompt).not.toContain("旅人夜渡");
  });

  it("keeps sample content separate from generation instructions", () => {
    const prompt = styleAnalysisPrompt({
      profileId: "p1",
      sampleText: "林舟穿过旧港。".repeat(20),
    });
    expect(prompt).toContain("不要把样章的人名、地名、事件或情节");
    expect(applyStyleTemplate("正文上下文", null)).toBe("正文上下文");
    expect(() => parseStyleAnalysis('{"wrong":true}')).toThrow(
      "模型没有返回有效的文风分析",
    );
  });
});

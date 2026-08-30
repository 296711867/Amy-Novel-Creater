import { describe, expect, it } from "vitest";
import {
  parseScopeAdvice,
  scopeAdvisoryPrompt,
} from "@domain/scope-advisor";

const advice = {
  recommendation: {
    tierLabel: "试水档（20 万字级）",
    totalChapters: 80,
    chapterWords: 2500,
    dailyChapters: 1,
    estimatedDays: 80,
    reason: "先跑通流程再决定续写。",
  },
  milestones: [
    { position: 3, label: "黄金三章", goal: "亮出规则代价" },
    { position: 30, label: "追读考核点", goal: "主线矛盾升级" },
  ],
  volumeSkeleton: [
    {
      title: "卷一",
      startChapter: 1,
      endChapter: 40,
      goal: "建立规则",
      climax: "塔前对峙",
    },
  ],
  notes: ["单章 2500 字，章末留钩子"],
};

describe("scope advisor", () => {
  it("embeds platform rules and author input into the prompt", () => {
    const prompt = scopeAdvisoryPrompt({
      title: "雾灯航路",
      genre: "玄幻",
      premise: "灯油烧的是记忆",
      notes: "日更一章",
    });
    expect(prompt).toContain("番茄小说");
    expect(prompt).toContain("2000–3000");
    expect(prompt).toContain("黄金三章");
    expect(prompt).toContain("雾灯航路");
    expect(prompt).toContain("灯油烧的是记忆");
    expect(prompt).toContain("日更一章");
  });
  it("parses fenced advice JSON", () => {
    const parsed = parseScopeAdvice(
      "```json\n" + JSON.stringify(advice) + "\n```",
    );
    expect(parsed.recommendation.totalChapters).toBe(80);
    expect(parsed.volumeSkeleton).toHaveLength(1);
  });
  it("rejects out-of-band recommendations", () => {
    expect(() =>
      parseScopeAdvice(
        JSON.stringify({
          ...advice,
          recommendation: {
            ...advice.recommendation,
            chapterWords: 50000,
          },
        }),
      ),
    ).toThrow();
    expect(() => parseScopeAdvice('{"a":1}\n{"b":2}')).toThrow();
  });
});

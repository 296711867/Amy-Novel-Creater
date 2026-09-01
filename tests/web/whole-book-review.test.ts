/**
 * AN-032 全书审稿编排（Application runner）测试。
 *
 * 用假数据源 + 可编程模型响应驱动真实的 runWholeBookReview：
 * 覆盖窗口顺序调用、滚动摘要续读、逐窗口事件与用量留痕、
 * book:* 发现整体替换与忽略状态延续、author/rule 发现保留。
 */
import { describe, expect, it } from "vitest";
import {
  runWholeBookReview,
  type WholeBookReviewDeps,
} from "@application/whole-book-review-runner";
import type { Chapter } from "@domain/novel";
import type { GlobalFinding } from "@domain/global-consistency";

const now = "2026-09-02T00:00:00.000Z";
const WINDOW1 = { summary: "第一窗摘要", notes: [{ message: "第1窗问题" }] };
const WINDOW2 = {
  summary: "第二窗摘要",
  notes: [{ message: "第2窗问题", chapterPosition: 7 }],
};

function buildDeps(overrides: Partial<WholeBookReviewDeps> = {}) {
  const chapters: Chapter[] = Array.from({ length: 7 }, (_, index) => ({
    id: `c${index + 1}`,
    novelId: "n1",
    position: index + 1,
    volumeId: null,
    title: `第${index + 1}章`,
    outline: "o",
    status: "accepted",
    targetWords: 2500,
    content: `第${index + 1}章正文。`,
    wordCount: 6,
    updatedAt: now,
  }));
  const prompts: string[] = [];
  const events: string[] = [];
  const usages: number[] = [];
  let findingsStore: GlobalFinding[] = [
    {
      id: "book:old",
      novelId: "n1",
      source: "ai",
      severity: "warning",
      category: "consistency",
      message: "上一轮通读发现",
      evidence: "",
      status: "open",
      createdAt: now,
    },
    {
      id: "book:dismissed-old",
      novelId: "n1",
      source: "ai",
      severity: "warning",
      category: "consistency",
      message: "被忽略的旧发现",
      evidence: "",
      status: "dismissed",
      createdAt: now,
    },
    {
      id: "author:1",
      novelId: "n1",
      source: "author",
      severity: "warning",
      category: "consistency",
      message: "作者连读标记",
      evidence: "第 3 章连读标记",
      status: "open",
      createdAt: now,
    },
    {
      id: "rule:probe",
      novelId: "n1",
      source: "rule",
      severity: "warning",
      category: "consistency",
      message: "规则发现",
      evidence: "",
      status: "open",
      createdAt: now,
    },
  ];
  const responses = [WINDOW1, WINDOW2];
  const deps: WholeBookReviewDeps = {
    novel: { title: "雾灯航路", genre: "悬疑" },
    profile: { provider: "openai-compatible", modelId: "test-model", contextWindow: 128000 },
    listChapters: async () => chapters,
    listStoryEntities: async () => [],
    listCharacterStates: async () => [],
    listTimelineEvents: async () => [],
    listForeshadowThreads: async () => [],
    listGlobalFindings: async () => findingsStore,
    saveGlobalFindings: async (_id, items) => {
      findingsStore = items;
    },
    saveUsage: async (input) => {
      usages.push(input.inputTokens);
    },
    saveGenerationEvent: async (event) => {
      events.push(event.message);
    },
    callModel: async (prompt) => {
      prompts.push(prompt);
      const response = responses[Math.min(prompts.length - 1, responses.length - 1)];
      return {
        content: JSON.stringify(response),
        inputTokens: 900 + prompts.length,
        outputTokens: 100,
        cachedTokens: 0,
      };
    },
    ...overrides,
  };
  return { deps, prompts, events, usages, getFindings: () => findingsStore };
}

describe("runWholeBookReview", () => {
  it("顺序窗口调用、滚动摘要续读、逐窗口留痕事件与用量", async () => {
    const harness = buildDeps();
    const result = await runWholeBookReview("n1", { windowSize: 4 }, harness.deps);
    // 7 章 / 4 章一窗 → 2 个窗口。
    expect(result.windows).toBe(2);
    expect(harness.prompts).toHaveLength(2);
    // 第 2 窗携带第 1 窗的滚动摘要。
    expect(harness.prompts[1]).toContain("第一窗摘要");
    // 事件：开始 + 每窗完成 + 总结。
    expect(harness.events[0]).toContain("全书通读审稿开始：2 个窗口");
    expect(harness.events[1]).toContain("第 1–4 章完成：1 项发现");
    expect(harness.events[2]).toContain("第 5–7 章完成：1 项发现");
    expect(harness.events.at(-1)).toContain("共 2 项发现");
    expect(harness.usages).toHaveLength(2);
    // book:* 发现替换上一轮（含被忽略的旧 book 发现清出 open 列表），
    // author/rule/其余 ai 发现原样保留。
    const ids = harness.getFindings().map((item) => item.id);
    expect(ids).not.toContain("book:old");
    expect(ids).toContain("author:1");
    expect(ids).toContain("rule:probe");
    expect(result.findings.every((item) => item.id.startsWith("book:"))).toBe(
      true,
    );
  });

  it("重复发现跨窗口去重由稳定 id 承担：两窗报同一消息只留一条", async () => {
    const harness = buildDeps({
      callModel: async () => ({
        content: JSON.stringify({
          summary: "s",
          notes: [{ message: "全书文风漂移", chapterPosition: 3 }],
        }),
        inputTokens: 500,
        outputTokens: 50,
        cachedTokens: 0,
      }),
    });
    const result = await runWholeBookReview("n1", { windowSize: 3 }, harness.deps);
    // 7 章 / 3 章一窗 → 3 个窗口，同一消息三窗重复上报只保留一条。
    expect(result.windows).toBe(3);
    expect(result.findings).toHaveLength(1);
  });

  it("没有已入正史章节时给出可读错误", async () => {
    const harness = buildDeps({
      listChapters: async () => [],
    });
    await expect(
      runWholeBookReview("n1", undefined, harness.deps),
    ).rejects.toThrow("还没有已入正史的章节");
  });
});

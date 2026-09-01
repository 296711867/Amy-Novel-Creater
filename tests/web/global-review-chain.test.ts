// @vitest-environment jsdom
/**
 * AN-027 ②：Web 端全局一致性 AI 审查链路（真实 webPlatform + stub fetch）。
 *
 * 从 IndexedDB 装配正史数据（圣经/实体/章节/状态/时间线/伏笔）、经
 * sessionStorage 密钥发起模型请求、解析 issues/proposals、AI 发现替换
 * 上一轮且忽略状态延续、修复提案进入 planning_proposals——完整走通除
 * 网络外的整条链路。Electron 端同一链路镜像在 novel-ipc 处理器中，
 * 装配与解析由共享 Domain 承担（global-consistency 域测试覆盖）。
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webPlatform } from "../../src/renderer/src/platform/web-platform";

afterEach(() => vi.unstubAllGlobals());

describe("web reviewGlobalConsistency 链路", () => {
  it("装配正史 → 调模型 → 解析发现与修复提案 → 入库去重", async () => {
    await webPlatform.ready();
    const created = await webPlatform.createNovel({
      title: "全局审查链路",
      genre: "悬疑",
      premise: "守灯人世界",
      targetChapters: 2,
      chapterWords: 2000,
    });
    const novelId = created.novel.id;
    await webPlatform.saveModelProfile({
      name: "测试模型",
      provider: "openai-compatible",
      modelId: "test-model",
      baseUrl: "https://model.test/v1",
      contextWindow: 128000,
      inputPricePerMillion: null,
      outputPricePerMillion: null,
      isDefault: true,
      apiKey: "session-only-key",
    });
    await webPlatform.saveStoryEntity({
      novelId,
      type: "character",
      name: "沈灯",
      summary: "守灯少年",
      aliases: [],
      profile: { tier: "protagonist" },
    });
    const chapters = await webPlatform.listChapters(novelId);
    await webPlatform.saveChapter({
      chapterId: chapters[0].id,
      title: chapters[0].title,
      outline: chapters[0].outline,
      content: "沈灯在雾灯港点起灯，看见了不该看见的账本数字。",
    });
    // 一条规则发现 + 一条作者疑点标记（AN-031）预先存在：
    // AI 审查不得清除规则来源或作者标记的记录。
    await webPlatform.saveGlobalFindings(novelId, [
      {
        id: "rule:probe",
        novelId,
        source: "rule",
        severity: "warning",
        category: "foreshadow",
        message: "规则探针发现",
        evidence: "",
        status: "open",
        createdAt: new Date().toISOString(),
      },
      {
        id: "author:probe",
        novelId,
        source: "author",
        severity: "warning",
        category: "consistency",
        message: "作者连读标记的疑点",
        evidence: "第 1 章连读标记",
        chapterPosition: 1,
        status: "open",
        createdAt: new Date().toISOString(),
      },
    ]);

    const reviewPayload = {
      summary: "有一处知识泄露矛盾。",
      issues: [
        {
          severity: "error",
          category: "timeline",
          message: "沈灯在第1章不可能知道账本数字",
          evidence: "账本在第2章才打开",
          suggestion: "重写第1章或提前埋偷看情节",
          targetKind: "chapter",
          targetName: "1",
          chapterPosition: 1,
        },
      ],
      proposals: [
        {
          action: "update",
          targetType: "character",
          targetName: "沈灯",
          patch: { summary: "守灯少年，对账本有执念" },
          reason: "动机补强",
        },
      ],
    };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "```json\n" + JSON.stringify(reviewPayload) + "\n```",
              },
            },
          ],
          usage: {
            prompt_tokens: 8000,
            completion_tokens: 400,
            prompt_tokens_details: { cached_tokens: 100 },
          },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await webPlatform.reviewGlobalConsistency(novelId);

    // 请求载荷包含全局审查指令与正史数据摘要。
    const body = JSON.parse((fetchMock.mock.calls[0][1]!.body as string));
    const prompt = body.messages?.[0]?.content ?? "";
    expect(prompt).toContain("全局矛盾");
    expect(prompt).toContain("沈灯");
    // 解析结果：1 项 chapter 目标发现 + 1 项设定修复提案。
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]).toMatchObject({
      source: "ai",
      severity: "error",
      targetKind: "chapter",
      chapterPosition: 1,
    });
    expect(outcome.proposals).toHaveLength(1);
    expect(outcome.proposals[0]).toMatchObject({
      action: "update",
      targetType: "character",
    });
    // 规则发现与作者疑点标记保留，AI 发现入库。
    const stored = await webPlatform.listGlobalFindings(novelId);
    expect(stored.some((item) => item.id === "rule:probe")).toBe(true);
    expect(stored.some((item) => item.id === "author:probe")).toBe(true);
    expect(stored.some((item) => item.source === "ai")).toBe(true);
    // 修复提案进入 planning_proposals，接受状态为 pending。
    const proposals = await webPlatform.listPlanningProposals(novelId);
    expect(proposals.some((item) => item.targetName === "沈灯")).toBe(true);
    // 用量按 global_review 记录（provider 实测）。
    const usage = await webPlatform.listUsage(novelId);
    expect(
      usage.some((item) => item.operation === "global_review"),
    ).toBe(true);

    // 同一响应再次审查：发现 id 稳定、提案按 identity 去重。
    await webPlatform.reviewGlobalConsistency(novelId);
    const againProposals = await webPlatform.listPlanningProposals(novelId);
    expect(
      againProposals.filter((item) => item.targetName === "沈灯"),
    ).toHaveLength(1);
    const againFindings = await webPlatform.listGlobalFindings(novelId);
    expect(
      againFindings.filter((item) => item.source === "ai"),
    ).toHaveLength(1);
  });
});

// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webPlatform } from "@renderer/platform/web-platform";

afterEach(() => vi.unstubAllGlobals());

async function setup() {
  await webPlatform.ready();
  const created = await webPlatform.createNovel({
    title: "章节审查链路",
    genre: "悬疑",
    premise: "测试 Web 无人值守安全门",
    targetChapters: 1,
    chapterWords: 1000,
  });
  const profile = await webPlatform.saveModelProfile({
    name: "测试模型",
    provider: "openai-compatible",
    modelId: "test-model",
    baseUrl: "https://model.test/v1",
    contextWindow: 128000,
    inputPricePerMillion: null,
    outputPricePerMillion: null,
    isDefault: true,
    apiKey: "session-key",
  });
  const chapter = (await webPlatform.listChapters(created.novel.id))[0];
  return { novelId: created.novel.id, chapter, profile };
}

describe("Web 章节安全分析链", () => {
  it("持久化 AI findings、事实提案与两类用量", async () => {
    const { novelId, chapter, profile } = await setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify({ issues: [{ severity: "error", message: "动机断裂", evidence: "章纲要求救人" }] }) } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify({ proposals: [{ kind: "timeline", title: "进入灯塔", payload: { storyTime: "午夜", detail: "主角进入灯塔", participants: [] } }] }) } }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const content = "灯".repeat(950);
    const findings = await webPlatform.analyzeChapterCandidate!({
      novelId,
      chapterId: chapter.id,
      candidateId: "candidate-analysis",
      profileId: profile.id,
      content,
      chapterReview: true,
      continuityCheck: true,
      failClosed: true,
      minimumWordRatio: 0.9,
    });
    expect(findings.map((item) => item.message)).toContain("动机断裂");
    expect(await webPlatform.listFindings("candidate-analysis")).toHaveLength(1);
    expect(await webPlatform.listFactProposals("candidate-analysis")).toMatchObject([
      { kind: "timeline", title: "进入灯塔", status: "proposed" },
    ]);
    expect((await webPlatform.listUsage(novelId)).map((item) => item.operation)).toEqual(
      expect.arrayContaining(["chapter_review", "continuity_check"]),
    );
  });

  it("无人值守时非法审查结果 fail-closed", async () => {
    const { novelId, chapter, profile } = await setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(
      webPlatform.analyzeChapterCandidate!({
        novelId,
        chapterId: chapter.id,
        candidateId: "candidate-invalid",
        profileId: profile.id,
        content: "灯".repeat(950),
        chapterReview: true,
        continuityCheck: true,
        failClosed: true,
        minimumWordRatio: 0.9,
      }),
    ).rejects.toThrow("AI 章节审查失败");
  });
});

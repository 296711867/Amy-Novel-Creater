// @vitest-environment jsdom
/**
 * AN-024：Web 端人物阵容建议链路（真实 webPlatform + stub fetch）。
 *
 * 从 IndexedDB 读取作品/人物、经 sessionStorage 密钥发起模型请求、
 * 按实体名与人物分层过滤解析结果——完整走通除网络外的整条链路；
 * Electron 端同一链路经 IPC 镜像 novel-ipc 处理器，解析与过滤规则
 * 由共享 Domain 承担（persona-recommendation 域测试覆盖）。
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { webPlatform } from "../../src/renderer/src/platform/web-platform";

afterEach(() => vi.unstubAllGlobals());

describe("web suggestPersonaLineup 链路", () => {
  it("按实体匹配与人物分层解析模型返回，未知人物被过滤", async () => {
    await webPlatform.ready();
    const created = await webPlatform.createNovel({
      title: "人格链路测试",
      genre: "玄幻",
      premise: "灯约世界",
      targetChapters: 2,
      chapterWords: 2000,
    });
    await webPlatform.saveStoryEntity({
      novelId: created.novel.id,
      type: "character",
      name: "沈灯",
      summary: "守灯少年",
      aliases: ["小灯"],
      profile: { tier: "protagonist" },
    });
    await webPlatform.saveStoryEntity({
      novelId: created.novel.id,
      type: "character",
      name: "路人甲",
      summary: "龙套",
      aliases: [],
      profile: { tier: "extra" },
    });
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

    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  "```json\n" +
                  JSON.stringify({
                    recommendations: [
                      {
                        name: "小灯",
                        personaType: "守灯的偏执理想主义者",
                        reason: "主角弧线需要",
                        writingConstraints: "短句，不解释动机",
                        speechHabit: "灯还亮着",
                      },
                      {
                        name: "路人甲",
                        personaType: "不该出现的推荐",
                      },
                      {
                        name: "不存在的角色",
                        personaType: "未知人物",
                      },
                    ],
                  }) +
                  "\n```",
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const suggestions = await webPlatform.suggestPersonaLineup(created.novel.id);
    // 别名“小灯”命中主角卡；extra 与未知人物不进入阵容。
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      entityName: "沈灯",
      tier: "protagonist",
      personaType: "守灯的偏执理想主义者",
      speechHabit: "灯还亮着",
    });
    // 请求携带会话密钥与标准 chat completions 载荷。
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit | undefined,
    ];
    expect(url).toBe("https://model.test/v1/chat/completions");
    expect((init?.headers as Record<string, string>).authorization).toBe(
      "Bearer session-only-key",
    );
    expect(String(init?.body)).toContain("test-model");
  });

  it("模型返回非 200 时错误可读且不静默", async () => {
    await webPlatform.ready();
    const novels = await webPlatform.listNovels();
    const novel = novels.find((item) => item.title === "人格链路测试")!;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("rate limited", { status: 429 })),
    );
    await expect(webPlatform.suggestPersonaLineup(novel.id)).rejects.toThrow(
      "HTTP 429",
    );
  });
});

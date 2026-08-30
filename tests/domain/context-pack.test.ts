import { describe, expect, it } from "vitest";
import {
  buildContextPack,
  estimateTokens,
  selectRecentChapters,
} from "../../src/domain/context-pack";

describe("context pack", () => {
  it("prefers the current batch candidate chain over older canon text", () => {
    const chapter = (id: string, position: number, content: string) => ({
      id,
      novelId: "n",
      volumeId: null,
      position,
      title: `第 ${position} 章`,
      outline: "",
      status: "draft" as const,
      targetWords: 3000,
      content,
      wordCount: content.length,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    const recent = selectRecentChapters(
      [chapter("c1", 1, "旧正史"), chapter("c2", 2, "第二章")],
      3,
      [chapter("c1", 1, "本批次候选稿")],
    );
    expect(recent.map((item) => item.content)).toEqual([
      "本批次候选稿",
      "第二章",
    ]);
  });
  it("estimates Chinese and latin content with different ratios", () => {
    expect(estimateTokens("这是中文")).toBeGreaterThan(estimateTokens("test"));
  });
  it("keeps required sources first and reports trimming", () => {
    const now = new Date().toISOString(),
      pack = buildContextPack({
        novel: {
          id: "n",
          title: "长夜",
          genre: "科幻",
          premise: "",
          targetWords: 3000,
          targetChapters: 1,
          chapterWords: 3000,
          status: "planning",
          createdAt: now,
          updatedAt: now,
        },
        chapter: {
          id: "c",
          novelId: "n",
          volumeId: null,
          position: 1,
          title: "第一章",
          outline: "进入城市".repeat(20),
          status: "planned",
          targetWords: 3000,
          content: "",
          wordCount: 0,
          updatedAt: now,
        },
        scenes: [],
        bible: [
          {
            id: "b",
            novelId: "n",
            kind: "style",
            content: "冷峻克制".repeat(100),
            versionNo: 1,
            updatedAt: now,
          },
        ],
        entities: [],
        timeline: [],
        foreshadow: [],
        characterStates: [],
        recentChapters: [],
        inputBudget: 80,
        outputTokensReserved: 100,
      });
    expect(pack.inputTokens).toBe(80);
    expect(pack.sources[0].required).toBe(true);
    expect(
      pack.sources.some(
        (item) => item.status === "trimmed" || item.status === "omitted",
      ),
    ).toBe(true);
    expect(pack.contentHash).toHaveLength(8);
  });
});

import { describe, expect, it } from "vitest";
import {
  buildContextPack,
  estimateTokens,
} from "../../src/domain/context-pack";

describe("context pack", () => {
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

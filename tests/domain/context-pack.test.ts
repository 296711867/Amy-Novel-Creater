import { describe, expect, it } from "vitest";
import {
  buildContextPack,
  estimateTokens,
  selectForeshadowThreads,
  selectRecentChapters,
  selectTimelineEvents,
} from "../../src/domain/context-pack";
import type {
  ContextPackInput,
} from "../../src/domain/context-pack";
import type {
  ForeshadowThread,
  TimelineEvent,
} from "../../src/domain/continuity";

function mkForeshadow(
  id: string,
  setupChapterId: string | null,
  status: ForeshadowThread["status"] = "planted",
  title = id,
): ForeshadowThread {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    novelId: "n",
    title,
    detail: `${id} 的细节`,
    setupChapterId,
    payoffChapterId: null,
    status,
    source: "ai_candidate",
    createdAt: now,
    updatedAt: now,
  };
}

function mkTimeline(id: string, chapterId: string | null): TimelineEvent {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    novelId: "n",
    chapterId,
    storyTime: "第一天",
    title: id,
    detail: `${id} 事件`,
    participantIds: [],
    source: "ai_candidate",
    createdAt: now,
    updatedAt: now,
  };
}

describe("AN-038 伏笔/时间线上下文瘦身", () => {
  const positions = new Map([
    ["c1", 1],
    ["c10", 10],
    ["c20", 20],
    ["c30", 30],
  ]);

  it("伏笔：已回收/废弃不注入，未来埋设的不注入", () => {
    const picked = selectForeshadowThreads(
      [
        mkForeshadow("resolved", "c1", "resolved"),
        mkForeshadow("abandoned", "c1", "abandoned"),
        mkForeshadow("future", "c30"),
        mkForeshadow("past", "c10"),
      ],
      positions,
      20,
      "",
    );
    expect(picked.map((item) => item.id)).toEqual(["past"]);
  });

  it("伏笔：本章计划提及优先，其余按埋设账龄降序（久埋在前）", () => {
    const picked = selectForeshadowThreads(
      [
        mkForeshadow("mid", "c20"),
        mkForeshadow("oldest", "c1"),
        mkForeshadow("mentioned", "c10", "planted", "还魂灯之谜"),
      ],
      positions,
      25,
      "本章大纲：主角打开还魂灯之谜的机关",
    );
    expect(picked.map((item) => item.id)).toEqual([
      "mentioned",
      "oldest",
      "mid",
    ]);
  });

  it("伏笔：超过上限时截断为常量上限", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      mkForeshadow(`f${i}`, "c1"),
    );
    expect(
      selectForeshadowThreads(many, positions, 30, "").length,
    ).toBeLessThanOrEqual(16);
  });

  it("时间线：只保留截至本章的事件并取最近 N 条，手动事件优先保留", () => {
    const events = [
      mkTimeline("manual", null),
      mkTimeline("e1", "c1"),
      mkTimeline("e10", "c10"),
      mkTimeline("e20", "c20"),
      mkTimeline("future", "c30"),
    ];
    const picked = selectTimelineEvents(events, positions, 20, 2);
    expect(picked.map((item) => item.id)).toEqual(["manual", "e20"]);
  });

  it("时间线：无手动事件时取尾部（最旧先被裁掉）", () => {
    const picked = selectTimelineEvents(
      [mkTimeline("e1", "c1"), mkTimeline("e10", "c10"), mkTimeline("e20", "c20")],
      positions,
      20,
      2,
    );
    expect(picked.map((item) => item.id)).toEqual(["e10", "e20"]);
  });

  it("注入治理提示源：有开放伏笔时出现，无伏笔时不出现", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const base: Omit<ContextPackInput, "foreshadow"> = {
      novel: {
        id: "n",
        title: "长夜",
        genre: "科幻",
        premise: "",
        targetWords: 3000,
        targetChapters: 1,
        chapterWords: 3000,
        cycleSize: 10,
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
        outline: "",
        status: "planned",
        targetWords: 3000,
        content: "",
        wordCount: 0,
        updatedAt: now,
      },
      scenes: [],
      bible: [],
      entities: [],
      timeline: [],
      characterStates: [],
      recentChapters: [],
      inputBudget: 1000,
      outputTokensReserved: 100,
    };
    const withForeshadow = buildContextPack({
      ...base,
      foreshadow: [mkForeshadow("f1", null)],
    });
    expect(
      withForeshadow.sources.some(
        (item) => item.id === "foreshadow-guidance",
      ),
    ).toBe(true);
    const without = buildContextPack({ ...base, foreshadow: [] });
    expect(
      without.sources.some((item) => item.id === "foreshadow-guidance"),
    ).toBe(false);
  });

  it("AN-021 待复核标注：正文改写后的记忆注入时带过期前缀", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const mkState = (id: string, updatedAt: string) => ({
      id,
      novelId: "n",
      characterId: "e1",
      chapterId: "c1",
      summary: `${id} 状态`,
      location: "",
      appearance: "",
      outfit: "",
      identity: "",
      physical: "",
      emotional: "",
      knowledge: [],
      goals: [],
      inventory: [],
      skills: [],
      source: "accepted_chapter" as const,
      createdAt: updatedAt,
      updatedAt,
    });
    const pack = buildContextPack({
      novel: {
        id: "n",
        title: "长夜",
        genre: "科幻",
        premise: "",
        targetWords: 3000,
        targetChapters: 1,
        chapterWords: 3000,
        cycleSize: 10,
        status: "planning",
        createdAt: now,
        updatedAt: now,
      },
      chapter: {
        id: "c",
        novelId: "n",
        volumeId: null,
        position: 2,
        title: "第二章",
        outline: "",
        status: "planned",
        targetWords: 3000,
        content: "",
        wordCount: 0,
        updatedAt: now,
      },
      scenes: [],
      bible: [],
      entities: [],
      timeline: [],
      foreshadow: [],
      characterStates: [
        mkState("stale", "2026-01-01T00:00:00.000Z"),
        mkState("fresh", "2026-06-01T00:00:00.000Z"),
      ],
      recentChapters: [],
      inputBudget: 4000,
      outputTokensReserved: 100,
      // 第 1 章正文在 3 月被改写：stale（1 月回写）过期，fresh（6 月回写）有效。
      chapterUpdatedAtById: new Map([["c1", "2026-03-01T00:00:00.000Z"]]),
    });
    const staleSource = pack.sources.find((item) => item.id === "stale"),
      freshSource = pack.sources.find((item) => item.id === "fresh");
    expect(staleSource?.status).not.toBe("omitted");
    expect(staleSource?.text).toContain("待复核");
    expect(freshSource?.text).not.toContain("待复核");
  });
});

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
          cycleSize: 10,
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

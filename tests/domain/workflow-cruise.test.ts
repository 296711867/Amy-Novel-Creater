/**
 * AN-035 巡航域测试：封存起草、下一周期范围与策略复用。
 */
import { describe, expect, it } from "vitest";
import {
  cruisePolicy,
  draftClosingState,
  nextCycleRange,
} from "@domain/workflow-cruise";
import type { Chapter } from "@domain/novel";
import type { PlanningCycle } from "@domain/planning-cycle";
import type {
  CharacterState,
  ForeshadowThread,
} from "@domain/continuity";
import type { StoryEntity } from "@domain/story-bible";

const now = "2026-09-02T00:00:00.000Z";

function chapter(position: number, id = `c${position}`): Chapter {
  return {
    id,
    novelId: "n1",
    position,
    volumeId: null,
    title: `第${position}章`,
    outline: "o",
    status: "accepted",
    targetWords: 2500,
    content: "x",
    wordCount: 1,
    updatedAt: now,
  };
}
function entity(id: string, name: string): StoryEntity {
  return {
    id,
    novelId: "n1",
    type: "character",
    name,
    summary: "",
    aliases: [],
    profile: {},
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}
function state(
  id: string,
  characterId: string,
  summary: string,
): CharacterState {
  return {
    id,
    novelId: "n1",
    characterId,
    chapterId: null,
    summary,
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
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}
function thread(id: string, title: string, status: string): ForeshadowThread {
  return {
    id,
    novelId: "n1",
    title,
    detail: "d",
    setupChapterId: null,
    payoffChapterId: null,
    status: status as ForeshadowThread["status"],
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}
const cycle: PlanningCycle = {
  id: "cy1",
  novelId: "n1",
  startChapter: 11,
  endChapter: 20,
  status: "generating",
  goal: "g",
  openingState: "o",
  climax: "c",
  expectedClosingState: "e",
  actualClosingState: "",
  createdAt: now,
  updatedAt: now,
};

describe("封存实际结束状态起草", () => {
  it("汇总时间线尾部、核心人物收尾与未回收伏笔", () => {
    const draft = draftClosingState({
      cycle,
      chapters: [chapter(11), chapter(20)],
      entities: [entity("e1", "顾行舟"), entity("e2", "慕沉璧")],
      timeline: [
        {
          id: "t1",
          novelId: "n1",
          chapterId: "c20",
          storyTime: "",
          title: "血月了结",
          detail: "主角击碎祭主本源",
          participantIds: [],
          source: "manual",
          createdAt: now,
          updatedAt: now,
        },
      ],
      characterStates: [
        state("s1", "e1", "第 11 章的旧状态"),
        state("s2", "e1", "通过卷末检验，掌握母亲笔迹线索"),
        state("s3", "e2", "留在现实照看病危的顾董"),
      ],
      foreshadow: [
        thread("f1", "聚义厅匾额刻痕", "planted"),
        thread("f2", "已回收的旧灯", "resolved"),
      ],
    });
    expect(draft).toContain("截至第 20 章");
    expect(draft).toContain("血月了结");
    expect(draft).toContain("顾行舟：通过卷末检验");
    expect(draft).toContain("未回收伏笔 1 条");
    expect(draft).toContain("聚义厅匾额刻痕");
    expect(draft).not.toContain("已回收的旧灯");
    // 只保留人物最新状态，不带旧状态。
    expect(draft).not.toContain("第 11 章的旧状态");
  });

  it("总长受控（≤480 字符），空记忆不崩溃", () => {
    const long = draftClosingState({
      cycle,
      chapters: [],
      entities: [],
      timeline: [],
      characterStates: [],
      foreshadow: [],
    });
    expect(long.length).toBeLessThanOrEqual(480);
    expect(long).toContain("伏笔已全部回收或废弃");
  });
});

describe("下一周期范围", () => {
  it("封存后取下一段，末段对齐目标/目录上限", () => {
    expect(
      nextCycleRange({
        sealedEndChapter: 20,
        targetChapter: 45,
        cycleSize: 10,
        totalChapters: 50,
      }),
    ).toEqual({ startChapter: 21, endChapter: 30 });
    // 目标 45：末段 41–45（不是 41–50）。
    expect(
      nextCycleRange({
        sealedEndChapter: 40,
        targetChapter: 45,
        cycleSize: 10,
        totalChapters: 50,
      }),
    ).toEqual({ startChapter: 41, endChapter: 45 });
    // 目录不足时按目录截断。
    expect(
      nextCycleRange({
        sealedEndChapter: 40,
        targetChapter: 60,
        cycleSize: 10,
        totalChapters: 45,
      }),
    ).toEqual({ startChapter: 41, endChapter: 45 });
  });

  it("到达目标后返回 null（巡航收工）", () => {
    expect(
      nextCycleRange({
        sealedEndChapter: 45,
        targetChapter: 45,
        cycleSize: 10,
        totalChapters: 50,
      }),
    ).toBeNull();
  });
});

describe("巡航策略", () => {
  it("沿用上一周期策略，仅替换章节范围", () => {
    const policy = cruisePolicy(
      {
        startChapter: 11,
        endChapter: 20,
        chapterWords: 2500,
        continuityCheck: true,
        maxRetries: 2,
        approvalMode: "candidate",
        outputTokenBudget: 120000,
        concurrency: 1,
        deepThinking: false,
      },
      { startChapter: 21, endChapter: 30 },
    );
    expect(policy).toMatchObject({
      startChapter: 21,
      endChapter: 30,
      chapterWords: 2500,
      outputTokenBudget: 120000,
    });
  });
});

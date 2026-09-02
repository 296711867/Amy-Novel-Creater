/**
 * AN-030/AN-033：故事总览聚合与记忆体检域测试。
 *
 * 聚合规则一正一反：真实数据形态必须被正确汇总，空数据零崩溃。
 * 记忆体检针对线上真实事故形态：同章重复状态、同章矛盾状态、
 * 伏笔超期与悬空引用。
 */
import { describe, expect, it } from "vitest";
import { buildStoryOverview } from "@domain/story-overview";
import type { Chapter } from "@domain/novel";
import type { StoryEntity } from "@domain/story-bible";
import type {
  CharacterState,
  ForeshadowThread,
  TimelineEvent,
} from "@domain/continuity";

const now = "2026-09-02T00:00:00.000Z";

function chapter(position: number): Chapter {
  return {
    id: `c${position}`,
    novelId: "n1",
    position,
    volumeId: null,
    title: `第${position}章`,
    outline: "o",
    status: "accepted",
    targetWords: 2500,
    content: "正文",
    wordCount: 2500,
    updatedAt: now,
  };
}
function character(id: string, name: string): StoryEntity {
  return {
    id,
    novelId: "n1",
    type: "character",
    name,
    summary: "s",
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
  chapterId: string,
  summary: string,
  inventory: string[] = [],
): CharacterState {
  return {
    id,
    novelId: "n1",
    characterId,
    chapterId,
    summary,
    location: "雾灯港",
    appearance: "",
    outfit: "",
    identity: "",
    physical: "",
    emotional: "",
    knowledge: [],
    goals: [],
    inventory,
    skills: [],
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}
function thread(
  id: string,
  title: string,
  setup: string | null,
  status: ForeshadowThread["status"] = "planted",
  payoff: string | null = null,
): ForeshadowThread {
  return {
    id,
    novelId: "n1",
    title,
    detail: "d",
    setupChapterId: setup,
    payoffChapterId: payoff,
    status,
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}
function event(
  id: string,
  chapterId: string,
  participantIds: string[],
): TimelineEvent {
  return {
    id,
    novelId: "n1",
    chapterId,
    storyTime: "第一夜",
    title: "事件",
    detail: "d",
    participantIds,
    source: "manual",
    createdAt: now,
    updatedAt: now,
  };
}

function baseInput() {
  const chapters = [chapter(1), chapter(2), chapter(3), chapter(4)];
  return {
    chapters,
    entities: [character("e1", "沈灯"), character("e2", "崔衡"), character("e3", "阿雾")],
    timeline: [] as TimelineEvent[],
    foreshadow: [] as ForeshadowThread[],
    characterStates: [] as CharacterState[],
  };
}

describe("故事总览聚合", () => {
  it("人物出场：状态与时间线合并，首末章节与状态数正确", () => {
    const overview = buildStoryOverview({
      ...baseInput(),
      timeline: [event("t1", "c2", ["e1", "e2"])],
      characterStates: [state("s1", "e1", "c1", "初见"), state("s2", "e1", "c3", "再遇")],
    });
    const shen = overview.characters.find((item) => item.characterId === "e1")!;
    expect(shen.firstPosition).toBe(1);
    expect(shen.lastPosition).toBe(3);
    expect(shen.activePositions).toEqual([1, 2, 3]);
    expect(shen.latestSummary).toBe("再遇");
    const cui = overview.characters.find((item) => item.characterId === "e2")!;
    expect(cui.activePositions).toEqual([2]);
    // 无任何记录的人物也列出，方便发现“建档了但没出场”。
    expect(overview.characters.find((item) => item.characterId === "e3")?.stateCount).toBe(0);
  });

  it("道具流转：跨人物/跨章的持有链按序合并，单章单人持有不上榜", () => {
    const overview = buildStoryOverview({
      ...baseInput(),
      characterStates: [
        state("s1", "e1", "c1", "a", ["青铜钥匙"]),
        state("s2", "e1", "c2", "b", []),
        state("s3", "e2", "c3", "c", ["青铜钥匙"]),
      ],
    });
    const key = overview.items.find((item) => item.item === "青铜钥匙")!;
    expect(key.chain).toEqual([
      { position: 1, holder: "沈灯" },
      { position: 3, holder: "崔衡" },
    ]);
  });

  it("伏笔进度：超期标记与回收章定位；resolved 不算超期", () => {
    const chapters = Array.from({ length: 36 }, (_, index) => chapter(index + 1));
    const overview = buildStoryOverview({
      ...baseInput(),
      chapters,
      overdueThreshold: 30,
      foreshadow: [
        thread("f1", "账本之谜", "c2"), // 35 章未回收 → 超期
        thread("f2", "旧灯", "c36"), // 刚埋 → 未超期
        thread("f3", "已回收", "c3", "resolved", "c30"),
      ],
    });
    const overdue = overview.foreshadow.filter((item) => item.overdue);
    expect(overdue.map((item) => item.id)).toEqual(["f1"]);
    expect(overview.stats.foreshadowOpen).toBe(2);
    expect(overview.stats.foreshadowOverdue).toBe(1);
    const resolved = overview.foreshadow.find((item) => item.id === "f3")!;
    expect(resolved.payoffPosition).toBe(30);
  });

  it("各章摘要行统计时间线/状态/埋设数量", () => {
    const overview = buildStoryOverview({
      ...baseInput(),
      timeline: [event("t1", "c1", ["e1"]), event("t2", "c1", ["e2"])],
      characterStates: [state("s1", "e1", "c1", "a")],
      foreshadow: [thread("f1", "灯", "c1")],
    });
    expect(overview.chapters[0]).toMatchObject({
      position: 1,
      timelineCount: 2,
      stateCount: 1,
      foreshadowPlantedCount: 1,
    });
    expect(overview.stats).toMatchObject({ acceptedChapters: 4, totalWords: 10000 });
  });
});

describe("记忆体检（AN-033）", () => {
  it("同章完全相同的状态 → duplicate-state 且给出一键保留/删除清单", () => {
    const overview = buildStoryOverview({
      ...baseInput(),
      characterStates: [
        state("s1", "e1", "c1", "入住公寓度过第一夜"),
        state("s2", "e1", "c1", "入住公寓度过第一夜"),
      ],
    });
    const issue = overview.issues.find((item) => item.kind === "duplicate-state")!;
    expect(issue.fix).toEqual({ keepId: "s1", dropIds: ["s2"] });
    expect(issue.severity).toBe("warning");
  });

  it("同章内容不同的状态 → multi-state-chapter 提示人工核对（线上 28 岁 vs 24 岁形态）", () => {
    const overview = buildStoryOverview({
      ...baseInput(),
      characterStates: [
        state("s1", "e1", "c1", "顾氏独子，28 岁，厌倦生活"),
        state("s2", "e1", "c1", "顾氏少爷，24 岁，基地苏醒"),
      ],
    });
    const issue = overview.issues.find(
      (item) => item.kind === "multi-state-chapter",
    )!;
    expect(issue.message).toContain("沈灯");
    expect(issue.message).toContain("矛盾");
    expect(issue.targetIds).toEqual(["s1", "s2"]);
  });

  it("悬空状态引用 → error；伏笔超期 → warning", () => {
    const chapters = Array.from({ length: 36 }, (_, index) => chapter(index + 1));
    const overview = buildStoryOverview({
      ...baseInput(),
      chapters,
      characterStates: [state("s1", "ghost", "c1", "孤儿状态")],
      foreshadow: [thread("f1", "旧账", "c1")],
    });
    expect(
      overview.issues.some(
        (item) => item.kind === "dangling-ref" && item.severity === "error",
      ),
    ).toBe(true);
    expect(overview.issues.some((item) => item.kind === "overdue-foreshadow")).toBe(true);
  });

  it("干净记忆零问题", () => {
    const overview = buildStoryOverview({
      ...baseInput(),
      characterStates: [state("s1", "e1", "c1", "唯一")],
    });
    expect(overview.issues).toEqual([]);
  });
});

describe("AN-021 版本化记忆：改写章节后的派生记忆过期标记", () => {
  const later = "2026-09-02T12:00:00.000Z";

  it("正文改写晚于记忆回写 → stale-memory（按章聚合三类记录）", () => {
    const input = baseInput();
    // 第 2 章在记忆回写后被修改（全局修订/审查重写/手动改稿形态）。
    input.chapters[1] = { ...input.chapters[1], updatedAt: later };
    const overview = buildStoryOverview({
      ...input,
      characterStates: [
        state("s1", "e1", "c2", "改写前的状态"),
        state("s2", "e1", "c1", "未受影响"),
      ],
      timeline: [event("t1", "c2", ["e1"])],
      foreshadow: [thread("f1", "改写前埋的线", "c2")],
    });
    const stale = overview.issues.filter((item) => item.kind === "stale-memory");
    expect(stale).toHaveLength(1);
    expect(stale[0].severity).toBe("warning");
    expect(stale[0].message).toContain("第 2 章");
    expect(stale[0].message).toContain("1 条人物状态");
    expect(stale[0].message).toContain("1 条时间线");
    expect(stale[0].message).toContain("1 条伏笔");
    expect(stale[0].targetIds).toEqual(["s1", "t1", "f1"]);
  });

  it("记忆回写晚于正文修改（或时间相同）不算过期；未入正史的章节编辑不标记", () => {
    const input = baseInput();
    input.chapters[1] = { ...input.chapters[1], updatedAt: later };
    input.chapters[2] = {
      ...input.chapters[2],
      status: "draft",
      updatedAt: later,
    };
    const overview = buildStoryOverview({
      ...input,
      characterStates: [
        // 回写发生在修改之后 → 有效。
        { ...state("s1", "e1", "c2", "新鲜记忆"), updatedAt: later },
        // 所属章是草稿（编辑未入正史）→ 不标记。
        state("s2", "e1", "c3", "草稿章记忆"),
      ],
    });
    expect(
      overview.issues.some((item) => item.kind === "stale-memory"),
    ).toBe(false);
  });
});

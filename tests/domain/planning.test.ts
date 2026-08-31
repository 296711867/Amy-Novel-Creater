import { describe, expect, it } from "vitest";
import {
  assertCompleteStructurePlan,
  biblePlanningPrompt,
  extractPlanningJson,
  parseBiblePlan,
  parseStructurePlan,
  rollingPlanningMemoryText,
  rollingStructurePlanningPrompt,
  structurePlanningPrompt,
} from "@domain/planning";
import type { Novel } from "@domain/novel";

const novel: Novel = {
  id: "n1",
  title: "每天必须前进五步",
  genre: "都市脑洞",
  premise: "富二代被系统传送到有限空间",
  targetWords: 300000,
  targetChapters: 100,
  chapterWords: 3000,
  cycleSize: 10,
  status: "planning",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("planning prompts", () => {
  it("embeds novel facts into bible prompt", () => {
    const prompt = biblePlanningPrompt(
      novel,
      [],
      {
        audience: "系统流读者",
        style: "节奏明快",
        boundaries: "不后宫，不洗白反派",
        sellingPoint: "每日选择改变命运",
        conflict: "主角与系统控制者",
        protagonistGoal: "摆脱系统并保护家人",
        ending: "主角夺回选择权",
      },
    );
    expect(prompt).toContain("每天必须前进五步");
    expect(prompt).toContain("富二代被系统传送");
    expect(prompt).toContain("100");
    expect(prompt).toContain("不后宫，不洗白反派");
    expect(prompt).toContain("系统流读者");
  });
  it("embeds bible digest into structure prompt", () => {
    const prompt = structurePlanningPrompt(novel, [
      {
        id: "s1",
        novelId: "n1",
        kind: "world",
        content: "每天必须前进五步，否则受罚",
        versionNo: 1,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(prompt).toContain("每天必须前进五步，否则受罚");
  });
  it("feeds chapter 1-10 canon memory into chapter 11-20 planning", () => {
    const chapters = Array.from({ length: 20 }, (_, index) => ({
        id: `c${index + 1}`,
        novelId: novel.id,
        position: index + 1,
        title: `第${index + 1}章`,
        outline: "",
        volumeId: null,
        status: "planned" as const,
        targetWords: 3000,
        content: "",
        wordCount: 0,
        updatedAt: "2026-01-01T00:00:00.000Z",
      })),
      prompt = rollingStructurePlanningPrompt(
        novel,
        [],
        [{
          id: "hero",
          novelId: novel.id,
          type: "character",
          name: "洛沉璧",
          summary: "守塔人",
          aliases: [],
          profile: {},
          status: "active",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }],
        chapters,
        { startChapter: 11, endChapter: 20 },
        {
          cycles: [{
            id: "cycle-1",
            novelId: novel.id,
            startChapter: 1,
            endChapter: 10,
            status: "completed",
            goal: "守住归萤塔",
            openingState: "洛沉璧仍在塔中",
            climax: "塔战",
            expectedClosingState: "洛沉璧继续引路",
            actualClosingState: "洛沉璧残念已经消散，银帆正在拆塔",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }],
          characterStates: [{
            id: "state-1",
            novelId: novel.id,
            characterId: "hero",
            chapterId: "c10",
            summary: "残念消散，不能再次现身",
            location: "归萤塔",
            appearance: "",
            outfit: "",
            identity: "已退场",
            physical: "消散",
            emotional: "平静",
            knowledge: [],
            goals: [],
            inventory: [],
            skills: [],
            source: "accepted_chapter",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }],
          timeline: [{
            id: "timeline-1",
            novelId: novel.id,
            chapterId: "c10",
            storyTime: "第十章结尾",
            title: "拆塔危机",
            detail: "银帆在西南三十里拆塔",
            participantIds: ["hero"],
            source: "accepted_chapter",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }],
          foreshadow: [{
            id: "thread-1",
            novelId: novel.id,
            title: "银帆拆塔",
            detail: "必须在下一批承接",
            setupChapterId: "c10",
            payoffChapterId: null,
            status: "developing",
            source: "accepted_chapter",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          }],
        },
      );
    expect(prompt).toContain("实际结束（优先作为下一批起点）：洛沉璧残念已经消散");
    expect(prompt).toContain("残念消散，不能再次现身");
    expect(prompt).toContain("银帆拆塔（developing）");
    expect(prompt).toContain("银帆在西南三十里拆塔");
    expect(prompt).toContain("E-HERO [character] 洛沉璧");
    expect(prompt).toContain("更新既有实体必须填写 targetRef");
  });
  it("caps rolling canon memory before it enters the planning prompt", () => {
    const text = rollingPlanningMemoryText(
      {
        cycles: [],
        characterStates: [],
        foreshadow: [],
        timeline: Array.from({ length: 40 }, (_, index) => ({
          id: `t${index}`,
          novelId: novel.id,
          chapterId: "c10",
          storyTime: `第${index}日`,
          title: `事件${index}`,
          detail: "重要正史".repeat(100),
          participantIds: [],
          source: "accepted_chapter" as const,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        })),
      },
      [],
      [{
        id: "c10",
        novelId: novel.id,
        position: 10,
        title: "第10章",
        outline: "",
        volumeId: null,
        status: "accepted",
        targetWords: 3000,
        content: "",
        wordCount: 0,
        updatedAt: "2026-01-01T00:00:00.000Z",
      }],
      { startChapter: 11, endChapter: 20 },
    );
    expect(text.length).toBeLessThanOrEqual(4000);
  });
});

describe("plan parsing", () => {
  it("parses fenced bible plan with defaults", () => {
    const plan = parseBiblePlan(
      '```json\n{"sections":[{"kind":"world","content":"规则"}],"characters":[{"type":"character","name":"林一","summary":"主角"}]}\n```',
    );
    expect(plan.sections).toHaveLength(1);
    expect(plan.characters[0].aliases).toEqual([]);
    expect(plan.characters[0].profile).toEqual({});
    expect(plan.entities).toEqual([]);
  });
  it("parses structure plan chapters with volume fallback", () => {
    const plan = parseStructurePlan(
      '{"volumes":[{"title":"第一卷","outline":"觉醒"}],"chapters":[{"volumeTitle":"第一卷","title":"第1章 五步","outline":"开局"},{"title":"第2章 惩罚","outline":"危机","volumeTitle":""}]}',
    );
    expect(plan.volumes).toHaveLength(1);
    expect(plan.chapters).toHaveLength(2);
    expect(plan.chapters[1].volumeTitle).toBe("");
    expect(() => assertCompleteStructurePlan(plan, 2)).not.toThrow();
    expect(() => assertCompleteStructurePlan(plan, 3)).toThrow(
      "章节规划不完整",
    );
  });
  it("rejects malformed JSON", () => {
    expect(() => parseBiblePlan("not json")).toThrow();
  });
  it("coerces array or number profile values into strings", () => {
    const plan = parseBiblePlan(
      JSON.stringify({
        sections: [{ kind: "world", content: "规则" }],
        characters: [
          {
            type: "character",
            name: "林一",
            summary: "主角",
            profile: { 核心手段: ["点灯", "守约"], 灯阶: 3 },
          },
        ],
      }),
    );
    expect(plan.characters[0].profile).toEqual({
      核心手段: "点灯、守约",
      灯阶: "3",
    });
  });
  it("matches chapter volumes when the model decorates volume titles with ranges", () => {
    const plan = parseStructurePlan(
      JSON.stringify({
        volumes: [
          { title: "卷一·灯油是记忆（1-3章）", outline: "开局" },
          { title: "卷二：三塔开路（4-8章）", outline: "推进" },
        ],
        chapters: [
          { volumeTitle: "卷一·灯油是记忆", title: "第1章 雾爬上船舷", outline: "开局" },
          { volumeTitle: "卷一·灯油是记忆", title: "第2章 灯油是记忆", outline: "代价" },
          { volumeTitle: "卷二 三塔开路", title: "第3章 三日之雾", outline: "推进" },
        ],
      }),
    );
    expect(() => assertCompleteStructurePlan(plan, 3)).not.toThrow();
    const bogus = parseStructurePlan(
      JSON.stringify({
        volumes: [{ title: "第一卷", outline: "" }],
        chapters: [
          { volumeTitle: "不存在的卷", title: "第1章", outline: "x" },
        ],
      }),
    );
    expect(() => assertCompleteStructurePlan(bogus, 1)).toThrow(
      "引用了不存在的卷",
    );
  });
  it("extracts one complete JSON object before trailing model commentary", () => {
    expect(
      extractPlanningJson('{"volumes":[],"chapters":[]}\n以上是规划说明。'),
    ).toBe('{"volumes":[],"chapters":[]}');
  });
  it("does not silently accept a second JSON object", () => {
    expect(() => extractPlanningJson('{"a":1}\n{"b":2}')).toThrow(
      "多个 JSON 对象",
    );
  });
  it("validates one contiguous rolling ten-chapter packet", () => {
    const plan = parseStructurePlan(
      JSON.stringify({
        volumes: [{ title: "第一卷", outline: "开局" }],
        chapters: Array.from({ length: 10 }, (_, index) => ({
          position: index + 11,
          volumeTitle: "第一卷",
          title: `第${index + 11}章 新局`,
          outline: "推进主线",
        })),
        proposals: [{
          action: "add",
          targetType: "location",
          targetName: "灰塔",
          patch: { summary: "新场景" },
          reason: "第十二章需要固定场景",
        }],
      }),
    );
    expect(() =>
      assertCompleteStructurePlan(plan, 100, {
        startChapter: 11,
        endChapter: 20,
      }),
    ).not.toThrow();
    expect(plan.proposals[0].targetName).toBe("灰塔");
  });
});

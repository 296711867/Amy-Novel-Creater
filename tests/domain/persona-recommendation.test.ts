import { describe, expect, it } from "vitest";
import { selectCharacterStates } from "../../src/domain/context-pack";
import type { CharacterState } from "../../src/domain/continuity";
import {
  generationEventToJsonl,
  approvalGateEnabled,
  staleEarlierChapterTitle,
} from "../../src/domain/generation";
import {
  continuationPrompt,
  mergeContinuation,
} from "../../src/domain/chapter-generation";
import { parsePersonaRecommendation } from "../../src/domain/persona-recommendation";
import type { StoryEntity } from "../../src/domain/story-bible";

function character(name: string, tier: string): StoryEntity {
  return {
    id: `id-${name}`,
    novelId: "n1",
    type: "character",
    name,
    summary: "",
    aliases: [],
    profile: { tier },
    status: "active",
    createdAt: "",
    updatedAt: "",
  };
}

describe("selectCharacterStates", () => {
  const states = (overrides: Partial<CharacterState>): CharacterState => ({
    id: "s",
    novelId: "n1",
    characterId: "hero",
    chapterId: null,
    summary: "",
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
    createdAt: "",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });
  it("keeps only the latest state per character before the current chapter", () => {
    const picked = selectCharacterStates(
      [
        states({ id: "a", chapterId: "ch1", updatedAt: "t1" }),
        states({ id: "b", chapterId: "ch5", updatedAt: "t2", physical: "右臂受伤" }),
        states({ id: "c", chapterId: "ch9", updatedAt: "t3" }),
      ],
      new Map([
        ["ch1", 1],
        ["ch5", 5],
        ["ch9", 9],
      ]),
      8,
    );
    expect(picked.map((item) => item.id)).toEqual(["b"]);
    expect(picked[0].physical).toBe("右臂受伤");
  });
  it("treats manual chapter-less states as the author-given latest", () => {
    const picked = selectCharacterStates(
      [
        states({ id: "manual", chapterId: null }),
        states({ id: "ch2", chapterId: "ch2" }),
      ],
      new Map([["ch2", 2]]),
      5,
    );
    expect(picked.map((item) => item.id)).toEqual(["manual"]);
  });
});

describe("persona recommendation parsing", () => {
  it("keeps tiered characters and drops extras / unknown names", () => {
    const suggestions = parsePersonaRecommendation(
      JSON.stringify({
        recommendations: [
          { name: "顾行舟", personaType: "INTJ · 冷眼观察者", reason: "匹配主线", writingConstraints: "对话短促、反讽", speechHabit: "句末带刺" },
          { name: "客栈老板", personaType: "市侩圆滑", reason: "", writingConstraints: "见人三分笑", speechHabit: "" },
          { name: "路人甲", personaType: "ESFP", reason: "", writingConstraints: "", speechHabit: "" },
          { name: "查无此人", personaType: "INFJ", reason: "", writingConstraints: "", speechHabit: "" },
        ],
      }),
      [
        character("顾行舟", "protagonist"),
        character("客栈老板", "recurring"),
        character("路人甲", "extra"),
      ],
    );
    expect(suggestions.map((item) => item.entityName)).toEqual([
      "顾行舟",
      "客栈老板",
    ]);
    expect(suggestions[0]).toMatchObject({ tier: "protagonist" });
    expect(suggestions[1]).toMatchObject({ tier: "recurring" });
  });
});

describe("generation run log", () => {
  it("exports events as JSONL with harness fields and no secrets", () => {
    const jsonl = generationEventToJsonl([
      {
        id: "e1",
        batchId: "run1",
        novelId: "n1",
        chapterId: "ch1",
        stage: "candidate_saved",
        level: "success",
        message: "第 3 章候选稿已保存",
        data: { outputTokens: 1645, durationMs: 42000, model: "glm-4.7" },
        createdAt: "2026-08-31T00:00:00.000Z",
      },
    ]);
    const line = JSON.parse(jsonl.split("\n")[0]);
    expect(line).toMatchObject({
      runId: "run1",
      stage: "candidate_saved",
      outputTokens: 1645,
      model: "glm-4.7",
    });
    expect(jsonl).not.toContain("apiKey");
  });
  it("enables the approval gate by default for legacy policies", () => {
    expect(approvalGateEnabled({ approvalGate: undefined } as never)).toBe(true);
    expect(approvalGateEnabled({ approvalGate: false } as never)).toBe(false);
  });
});

describe("continuation", () => {
  it("builds a no-repeat continuation prompt around the partial draft", () => {
    const prompt = continuationPrompt("上下文", "前文一半", 2600);
    expect(prompt).toContain("上下文");
    expect(prompt).toContain("前文一半");
    expect(prompt).toContain("2600");
    expect(prompt).toContain("不要重复");
  });
  it("drops the overlap when the model restates the tail", () => {
    const merged = mergeContinuation("他推门而入，屋里一片漆黑。", "屋里一片漆黑。他摸索着找到开关。");
    expect(merged.startsWith("他推门而入，屋里一片漆黑。")).toBe(true);
    expect(merged).not.toContain("漆黑。屋里一片漆黑");
    expect(merged.endsWith("他摸索着找到开关。")).toBe(true);
  });
});

describe("stale chapter cascade", () => {
  const chapters = [
    { id: "c1", position: 1, title: "第一章", content: "旧内容", updatedAt: "2026-01-01T00:00:00Z" },
    { id: "c2", position: 2, title: "第二章", content: "正文", updatedAt: "2026-01-01T00:00:00Z" },
  ];
  it("flags candidates generated before an earlier chapter was edited", () => {
    const edited = chapters.map((item) =>
      item.id === "c1"
        ? { ...item, content: "作者改过的内容", updatedAt: "2026-02-01T00:00:00Z" }
        : item,
    );
    expect(
      staleEarlierChapterTitle(
        { chapterId: "c2", createdAt: "2026-01-15T00:00:00Z" },
        edited,
        [],
      ),
    ).toBe("第一章");
  });
  it("does not flag when the update was an as-is candidate acceptance", () => {
    const edited = chapters.map((item) =>
      item.id === "c1"
        ? { ...item, content: "接受回写的内容", updatedAt: "2026-02-01T00:00:00Z" }
        : item,
    );
    expect(
      staleEarlierChapterTitle(
        { chapterId: "c2", createdAt: "2026-01-15T00:00:00Z" },
        edited,
        [{ chapterId: "c1", createdAt: "2026-01-10T00:00:00Z", content: "接受回写的内容" }],
      ),
    ).toBeNull();
  });
  it("does not flag later or untouched chapters", () => {
    expect(
      staleEarlierChapterTitle(
        { chapterId: "c2", createdAt: "2026-03-01T00:00:00Z" },
        chapters.map((item) =>
          item.id === "c1"
            ? { ...item, content: "新内容", updatedAt: "2026-02-01T00:00:00Z" }
            : item,
        ),
        [],
      ),
    ).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  defaultNamePool,
  drawNames,
  findNameCollisions,
  genreKeyOf,
} from "@domain/name-pool";
import { characterTierOf, isCharacterRelevant } from "@domain/story-bible";
import { parseSceneCard, sceneCardText } from "@domain/scene-card";
import {
  castPlanningPrompt,
  parseCastPlan,
  parseScenePlan,
  scenePlanningPrompt,
} from "@domain/planning";
import type { StoryEntity } from "@domain/story-bible";
import type { Novel } from "@domain/novel";

const novel: Novel = {
  id: "n1",
  title: "每天必须前进五步",
  genre: "都市脑洞",
  premise: "富二代被系统拉入行路空间",
  targetWords: 300000,
  targetChapters: 100,
  chapterWords: 3000,
  status: "planning",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
function character(
  name: string,
  tier: string | undefined,
  aliases: string[] = [],
): StoryEntity {
  return {
    id: name,
    novelId: "n1",
    type: "character",
    name,
    summary: "测试角色",
    aliases,
    profile: tier ? { tier } : {},
    status: "active",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("name pool", () => {
  it("maps genre strings to pool keys", () => {
    expect(genreKeyOf("玄幻")).toBe("fantasy");
    expect(genreKeyOf("都市脑洞")).toBe("urban");
    expect(genreKeyOf("科幻末世")).toBe("scifi");
    expect(genreKeyOf("随便")).toBe("general");
  });
  it("draws unique names avoiding existing entities", () => {
    const pool = defaultNamePool("n1", "玄幻");
    const names = drawNames(pool, 20, [character("林无咎", "protagonist")]);
    expect(new Set(names).size).toBe(20);
    expect(names).not.toContain("林无咎");
  });
  it("detects collisions between pool and entities", () => {
    const pool = { ...defaultNamePool("n1", "都市"), usedNames: ["陈一鸣"] };
    expect(findNameCollisions(pool, [character("陈一鸣", "support")])).toEqual([
      "陈一鸣",
    ]);
  });
});

describe("character tiers", () => {
  it("reads tier from profile", () => {
    expect(characterTierOf(character("甲", "protagonist"))).toBe("protagonist");
    expect(characterTierOf(character("乙", "invalid"))).toBeNull();
    expect(characterTierOf(character("丙", undefined))).toBeNull();
  });
  it("filters relevance by tier and chapter text", () => {
    const outline = "本章出现酱油角色 王小虎";
    expect(isCharacterRelevant(character("林一", "protagonist"), "")).toBe(
      true,
    );
    expect(isCharacterRelevant(character("王小虎", "recurring"), outline)).toBe(
      true,
    );
    expect(isCharacterRelevant(character("赵大", "recurring"), outline)).toBe(
      false,
    );
    expect(isCharacterRelevant(character("路人甲", "extra"), outline)).toBe(
      false,
    );
    expect(isCharacterRelevant(character("老角色", undefined), outline)).toBe(
      true,
    );
  });
});

describe("scene cards", () => {
  it("parses anchors from array or delimited string", () => {
    const base = {
      novelId: "n1",
      name: "选择题大殿",
      summary: "系统空间核心",
      aliases: [] as string[],
      status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const fromArray = parseSceneCard({
      ...base,
      id: "s1",
      type: "location",
      profile: {
        purpose: "抛出选择题",
        visualAnchors: ["青铜门", "五步石板"],
      },
    });
    expect(fromArray?.visualAnchors).toEqual(["青铜门", "五步石板"]);
    expect(
      sceneCardText({
        ...base,
        id: "s2",
        type: "location",
        profile: { purpose: "休整", visualAnchors: "篝火、木椅" },
      }),
    ).toContain("篝火、木椅");
    expect(
      parseSceneCard({ ...base, id: "s3", type: "item", profile: {} }),
    ).toBeNull();
  });
});

describe("cast & scene planning", () => {
  it("parses cast plan with tiers and extras", () => {
    const plan = parseCastPlan(
      '{"characters":[{"name":"林一","summary":"主角","tier":"protagonist","profile":{"身份":"富二代"}}],"extras":["路人甲","路人乙"]}',
    );
    expect(plan.characters[0].tier).toBe("protagonist");
    expect(plan.extras).toEqual(["路人甲", "路人乙"]);
  });
  it("parses scene plan with defaults", () => {
    const plan = parseScenePlan(
      '{"scenes":[{"name":"行路空间","summary":"基地","visualAnchors":["石板路"]}]}',
    );
    expect(plan.scenes[0].purpose).toBe("");
    expect(plan.scenes[0].visualAnchors).toEqual(["石板路"]);
  });
  it("embeds characters and pool in cast prompt", () => {
    const prompt = castPlanningPrompt(
      novel,
      [],
      [character("林一", "protagonist")],
      "可用姓名示例：楚听澜",
    );
    expect(prompt).toContain("林一");
    expect(prompt).toContain("楚听澜");
  });
  it("embeds locations in scene prompt", () => {
    const prompt = scenePlanningPrompt(novel, [], []);
    expect(prompt).toContain("每天必须前进五步");
  });
});

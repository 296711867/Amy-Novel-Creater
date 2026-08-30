import { describe, expect, it } from "vitest";
import {
  biblePlanningPrompt,
  parseBiblePlan,
  parseStructurePlan,
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
  status: "planning",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("planning prompts", () => {
  it("embeds novel facts into bible prompt", () => {
    const prompt = biblePlanningPrompt(novel);
    expect(prompt).toContain("每天必须前进五步");
    expect(prompt).toContain("富二代被系统传送");
    expect(prompt).toContain("100");
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
  });
  it("rejects malformed JSON", () => {
    expect(() => parseBiblePlan("not json")).toThrow();
  });
});

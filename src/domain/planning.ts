import { z } from "zod";
import type { Novel } from "./novel";
import type { BibleSection, StoryEntity } from "./story-bible";
import { getTemplate, renderTemplate } from "./prompt-templates";
import type { PromptTemplateOverrides } from "./prompt-templates";

const entity = z.object({
  type: z.enum(["character", "location", "organization", "item", "term"]),
  name: z.string().min(1),
  summary: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  profile: z.record(z.string(), z.string()).default({}),
});
const biblePlan = z.object({
  sections: z
    .array(
      z.object({
        kind: z.enum(["intent", "world", "style", "boundaries"]),
        content: z.string().min(1),
      }),
    )
    .max(4),
  characters: z.array(entity).max(20),
  entities: z.array(entity).max(30).default([]),
});
const structurePlan = z.object({
  volumes: z
    .array(z.object({ title: z.string().min(1), outline: z.string() }))
    .max(12),
  chapters: z
    .array(
      z.object({
        volumeTitle: z.string().default(""),
        title: z.string().min(1),
        outline: z.string().min(1),
      }),
    )
    .max(600),
});
const castPlan = z.object({
  characters: z
    .array(
      z.object({
        name: z.string().min(1),
        summary: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        tier: z.enum(["protagonist", "support", "recurring"]),
        profile: z.record(z.string(), z.string()).default({}),
      }),
    )
    .max(30),
  extras: z.array(z.string().min(1)).max(80).default([]),
});
const scenePlan = z.object({
  scenes: z
    .array(
      z.object({
        name: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        summary: z.string().min(1),
        purpose: z.string().default(""),
        mood: z.string().default(""),
        visualAnchors: z.array(z.string()).default([]),
        residents: z.string().default(""),
        dangerLevel: z.string().default(""),
      }),
    )
    .max(30),
});
export type PlannedEntity = z.infer<typeof entity>;
export type BiblePlan = z.infer<typeof biblePlan>;
export type StructurePlan = z.infer<typeof structurePlan>;
export type CastPlan = z.infer<typeof castPlan>;
export type ScenePlan = z.infer<typeof scenePlan>;
export type PlanPhase = "bible" | "structure" | "cast" | "scenes";
export interface NovelPlanSummary {
  phase: PlanPhase;
  sections: number;
  entities: number;
  volumes: number;
  chapters: number;
  extras: number;
}

function stripFence(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}
export function parseBiblePlan(raw: string): BiblePlan {
  return biblePlan.parse(JSON.parse(stripFence(raw)));
}
export function parseStructurePlan(raw: string): StructurePlan {
  return structurePlan.parse(JSON.parse(stripFence(raw)));
}
export function parseCastPlan(raw: string): CastPlan {
  return castPlan.parse(JSON.parse(stripFence(raw)));
}
export function parseScenePlan(raw: string): ScenePlan {
  return scenePlan.parse(JSON.parse(stripFence(raw)));
}

export function biblePlanningPrompt(
  novel: Novel,
  overrides?: PromptTemplateOverrides,
): string {
  return renderTemplate(getTemplate("bible_planning", overrides), {
    title: novel.title,
    genre: novel.genre,
    premise: novel.premise || "（未填写，请基于标题与题材合理构思）",
    targetChapters: novel.targetChapters,
    chapterWords: novel.chapterWords,
  }).text;
}
export function structurePlanningPrompt(
  novel: Novel,
  bible: BibleSection[],
  overrides?: PromptTemplateOverrides,
): string {
  const digest = bible
    .map((item) => `【${item.kind}】\n${item.content}`)
    .join("\n\n")
    .slice(0, 6000);
  return renderTemplate(getTemplate("structure_planning", overrides), {
    title: novel.title,
    genre: novel.genre,
    premise: novel.premise || "",
    targetChapters: novel.targetChapters,
    chapterWords: novel.chapterWords,
    bible: digest || "（尚未生成故事圣经，建议先生成）",
  }).text;
}
export function castPlanningPrompt(
  novel: Novel,
  bible: BibleSection[],
  characters: StoryEntity[],
  poolText: string,
  overrides?: PromptTemplateOverrides,
): string {
  const digest = bible
    .map((item) => `【${item.kind}】\n${item.content}`)
    .join("\n\n")
    .slice(0, 6000);
  const existing = characters
    .map(
      (item) =>
        `- ${item.name}${item.aliases.length ? `（别名：${item.aliases.join("、")}）` : ""}：${item.summary}`,
    )
    .join("\n");
  return renderTemplate(getTemplate("cast_planning", overrides), {
    title: novel.title,
    genre: novel.genre,
    bible: digest || "（尚未生成故事圣经，建议先生成）",
    characters: existing || "（暂无）",
    namePool: poolText,
  }).text;
}
export function scenePlanningPrompt(
  novel: Novel,
  bible: BibleSection[],
  locations: StoryEntity[],
  overrides?: PromptTemplateOverrides,
): string {
  const digest = bible
    .map((item) => `【${item.kind}】\n${item.content}`)
    .join("\n\n")
    .slice(0, 6000);
  const existing = locations
    .map(
      (item) =>
        `- ${item.name}${item.aliases.length ? `（别名：${item.aliases.join("、")}）` : ""}：${item.summary}`,
    )
    .join("\n");
  return renderTemplate(getTemplate("scene_planning", overrides), {
    title: novel.title,
    genre: novel.genre,
    bible: digest || "（尚未生成故事圣经，建议先生成）",
    locations: existing || "（暂无）",
  }).text;
}

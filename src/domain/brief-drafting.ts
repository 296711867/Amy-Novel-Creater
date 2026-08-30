import { z } from "zod";
import { extractPlanningJson } from "./planning";
import { getTemplate, renderTemplate } from "./prompt-templates";
import type { PromptTemplateOverrides } from "./prompt-templates";
import type { PlanningBrief } from "./planning-workflow";

/**
 * 开书简报代笔：AI 按作品信息起草第 1–2 步的七项简报，作者审阅修改后才保存。
 * 禁忌（boundaries）属于作者死设定，代笔只提供占位，页面提示作者亲自过目。
 */

export interface BriefAdvisorInput {
  title: string;
  genre: string;
  premise: string;
  notes?: string;
}

const briefSchema = z.object({
  audience: z.string().min(1),
  style: z.string().min(1),
  boundaries: z.string().min(1),
  sellingPoint: z.string().min(1),
  conflict: z.string().min(1),
  protagonistGoal: z.string().min(1),
  ending: z.string().min(1),
});

export function briefDraftingPrompt(
  input: BriefAdvisorInput,
  overrides?: PromptTemplateOverrides,
): string {
  return renderTemplate(getTemplate("brief_drafting", overrides), {
    title: input.title.trim() || "（未定名）",
    genre: input.genre,
    premise: input.premise.trim() || "（作者尚未填写核心设定，请基于题材给出通用建议并说明假设）",
    notes: input.notes?.trim() || "（无补充）",
  }).text;
}

export function parseBriefDraft(raw: string): PlanningBrief {
  return briefSchema.parse(JSON.parse(extractPlanningJson(raw)));
}

export function briefDraftingMaxOutputTokens(): number {
  return 1800;
}

export const BRIEF_DRAFT_FIELDS = [
  "audience",
  "style",
  "boundaries",
  "sellingPoint",
  "conflict",
  "protagonistGoal",
  "ending",
] as const;

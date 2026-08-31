import { z } from "zod";
import { extractPlanningJson } from "./planning";
import { getTemplate, renderTemplate } from "./prompt-templates";
import type { PromptTemplateOverrides } from "./prompt-templates";

/**
 * 开书前的篇幅与节奏顾问。平台规则（单章字数带、黄金三章、考核节点）内置在
 * 提示词里，模型只负责按作者想法实例化总章数、分卷骨架与里程碑，不临场发明
 * 平台标准。输出只是建议：作者确认回填创建表单后才进入任何正史。
 */

export interface ScopeAdvisorInput {
  title: string;
  genre: string;
  premise: string;
  /** 作者的补充想法：期望强度、可投入时间、想写多长等。 */
  notes?: string;
}

export const scopeAdviceSchema = z.object({
  recommendation: z.object({
    tierLabel: z.string().min(1),
    totalChapters: z.number().int().min(10).max(3000),
    chapterWords: z.number().int().min(800).max(8000),
    dailyChapters: z.number().int().min(1).max(6),
    estimatedDays: z.number().int().min(7).max(2000),
    reason: z.string().min(1),
  }),
  milestones: z
    .array(
      z.object({
        position: z.number().int().min(1),
        label: z.string().min(1),
        goal: z.string().min(1),
      }),
    )
    .max(12),
  volumeSkeleton: z
    .array(
      z.object({
        title: z.string().min(1),
        startChapter: z.number().int().min(1),
        endChapter: z.number().int().min(1),
        goal: z.string().min(1),
        climax: z.string().min(1),
      }),
    )
    .max(12),
  notes: z.array(z.string().min(1)).max(6),
});

export type ScopeAdvice = z.infer<typeof scopeAdviceSchema>;

export function scopeAdvisoryPrompt(
  input: ScopeAdvisorInput,
  overrides?: PromptTemplateOverrides,
): string {
  return renderTemplate(getTemplate("scope_advisory", overrides), {
    title: input.title.trim() || "（未定名）",
    genre: input.genre,
    premise: input.premise.trim() || "（作者尚未填写核心设定，请基于题材与补充想法给出建议并说明假设）",
    notes: input.notes?.trim() || "（无补充）",
  }).text;
}

export function parseScopeAdvice(raw: string): ScopeAdvice {
  return scopeAdviceSchema.parse(JSON.parse(extractPlanningJson(raw)));
}

export function scopeAdvisoryMaxOutputTokens(): number {
  return 3000;
}

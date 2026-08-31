import { z } from "zod";
import { extractPlanningJson } from "./planning";

export interface StyleTemplate {
  id: string;
  name: string;
  authorAlias: string;
  sourceTitle: string;
  sampleText: string;
  contentSummary: string;
  styleSummary: string;
  styleGuide: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyzeStyleTemplateInput {
  profileId: string;
  name?: string;
  authorAlias?: string;
  sourceTitle?: string;
  sampleText: string;
}

export interface SaveStyleTemplateInput
  extends Omit<StyleTemplate, "id" | "createdAt" | "updatedAt"> {
  id?: string;
}

const analysisSchema = z.object({
  name: z.string().min(1),
  authorAlias: z.string().min(1),
  contentSummary: z.string().min(1),
  styleSummary: z.string().min(1),
  styleGuide: z.string().min(1),
});

export type StyleTemplateAnalysis = z.infer<typeof analysisSchema>;

export function styleAnalysisPrompt(input: AnalyzeStyleTemplateInput): string {
  return `你是小说文风分析师。请分析样章并提炼可复用的抽象写作风格，不要识别真实作者，不要复述原文长句，也不要把样章的人名、地名、事件或情节当作以后创作的要求。

用户指定风格名：${input.name?.trim() || "请起一个简短、有画面感的名字"}
用户指定作者别名：${input.authorAlias?.trim() || "请起一个虚构别名"}
来源标题：${input.sourceTitle?.trim() || "未填写"}

只返回一个 JSON 对象：
{
  "name": "风格名",
  "authorAlias": "虚构作者别名",
  "contentSummary": "仅概括样章讲了什么，用于帮助用户辨认来源，不参与仿写",
  "styleSummary": "用一段话总结叙事视角、节奏、句式、用词、对白、描写、情绪和意象特点",
  "styleGuide": "给写作模型的可执行指令；分点描述应该怎么写，并明确禁止复用样章专名、情节和连续原句"
}

样章：
---
${input.sampleText.trim()}
---`;
}

export function parseStyleAnalysis(raw: string): StyleTemplateAnalysis {
  try {
    return analysisSchema.parse(JSON.parse(extractPlanningJson(raw)));
  } catch {
    throw new Error("模型没有返回有效的文风分析，请重试或更换模型");
  }
}

export function applyStyleTemplate(
  prompt: string,
  template?: Pick<StyleTemplate, "name" | "authorAlias" | "styleGuide"> | null,
): string {
  if (!template) return prompt;
  return `${prompt}\n\n【本章文风约束：${template.name} / ${template.authorAlias}】\n${template.styleGuide}\n只借鉴以上抽象特征。不得复用来源样章的专名、情节、独特比喻或连续原句；故事事实仍以本章 Context Pack 为准。`;
}

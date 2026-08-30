export type PromptTemplateKey =
  "chapter_instruction" | "fact_extraction" | "chapter_review";
export interface PromptTemplate {
  key: PromptTemplateKey;
  name: string;
  description: string;
  template: string;
}
export type PromptTemplateOverrides = Partial<
  Record<PromptTemplateKey, string>
>;
export const PROMPT_TEMPLATES: Record<PromptTemplateKey, PromptTemplate> = {
  chapter_instruction: {
    key: "chapter_instruction",
    name: "章节写作指令",
    description: "Context Pack 顶部的写作任务指令，约束目标字数与输出格式。",
    template:
      "为《{{novelTitle}}》续写{{chapterTitle}}。目标约 {{targetWords}} 字。严格遵循章节计划与正史，不要输出解释。",
  },
  fact_extraction: {
    key: "fact_extraction",
    name: "事实提取",
    description: "候选稿生成后提取正史事实提案的指令，输出严格 JSON。",
    template:
      '你是小说正史记录员。仅提取正文明确发生或明确改变的事实，不推测。返回严格 JSON：{"proposals":[{"kind":"timeline|character_state|foreshadow","title":"简短标题","payload":{}}]}。character_state 的 payload 可含 characterName、summary、location、physical、emotional、knowledge、goals、inventory；timeline 可含 storyTime、detail、participants；foreshadow 可含 detail、status。正文：\n{{content}}',
  },
  chapter_review: {
    key: "chapter_review",
    name: "章节 AI 审查",
    description: "对候选稿做一致性/质量审查，输出严格 JSON 的问题清单。",
    template:
      '你是小说编辑审稿人。对照章节计划审查以下候选稿，只报告明确的问题：设定矛盾、人物言行不一致、情节与大纲偏离、视角或地点错误、明显烂尾或字数不足。不要报告风格偏好。返回严格 JSON：{"issues":[{"severity":"error|warning|info","message":"问题描述","evidence":"正文中的证据引文"}]}，没有问题返回 {"issues":[]}。章节计划：\n{{outline}}\n\n候选稿：\n{{content}}',
  },
};
export interface RenderedPrompt {
  text: string;
  missingPlaceholders: string[];
}
export function renderTemplate(
  template: string,
  vars: Record<string, string | number>,
): RenderedPrompt {
  const missingPlaceholders: string[] = [];
  const text = template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : (missingPlaceholders.push(name), match),
  );
  return { text, missingPlaceholders };
}
export function getTemplate(
  key: PromptTemplateKey,
  overrides?: PromptTemplateOverrides,
): string {
  return overrides?.[key] ?? PROMPT_TEMPLATES[key].template;
}

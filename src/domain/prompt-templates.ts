export type PromptTemplateKey =
  | "chapter_instruction"
  | "fact_extraction"
  | "chapter_review"
  | "bible_planning"
  | "structure_planning";
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
  bible_planning: {
    key: "bible_planning",
    name: "故事圣经规划",
    description:
      "从核心设定生成创作意图、世界观、文风与边界，以及角色/实体卡。",
    template:
      '你是资深网文主编兼世界观架构师。基于以下作品信息生成故事圣经与核心设定卡。\n书名：{{title}}\n题材：{{genre}}\n核心设定：\n{{premise}}\n规划篇幅：约 {{targetChapters}} 章，单章约 {{chapterWords}} 字。\n要求：世界观规则要可执行（明确约束、代价与例外），文风圣经要给出具体可操作的文字规范，创作边界写清禁止事项；角色卡覆盖主角、对手与关键配角。\n返回严格 JSON：{"sections":[{"kind":"intent|world|style|boundaries","content":"该节完整内容，纯文本可多段"}],"characters":[{"type":"character","name":"姓名","summary":"一句话定位","aliases":["别名"],"profile":{"身份":"","性格":"","目标":"","秘密":""}}],"entities":[{"type":"location|organization|item|term","name":"名称","summary":"一句话说明","aliases":[],"profile":{"":" "}}]}。sections 四种 kind 各一条。',
  },
  structure_planning: {
    key: "structure_planning",
    name: "分卷与章节规划",
    description: "基于故事圣经生成卷级阶段目标与逐章标题大纲。",
    template:
      '你是长篇网文结构策划。基于以下信息规划分卷与章节目录。\n书名：{{title}}（{{genre}}）\n核心设定：{{premise}}\n规划篇幅：{{targetChapters}} 章，单章 {{chapterWords}} 字。\n故事圣经：\n{{bible}}\n要求：每卷有明确的阶段目标与转折点；章节大纲两到四句，写清该章事件、钩子与推进；节奏遵循网文断章钩子习惯；总章数不超过 {{targetChapters}}。\n返回严格 JSON：{"volumes":[{"title":"卷名","outline":"卷级目标与转折"}],"chapters":[{"volumeTitle":"所属卷名","title":"第X章 章节名","outline":"本章大纲"}]}。chapters 按顺序完整覆盖全部卷。',
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

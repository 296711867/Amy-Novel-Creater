export type PromptTemplateKey =
  | "chapter_instruction"
  | "fact_extraction"
  | "chapter_review"
  | "bible_planning"
  | "structure_planning"
  | "rolling_structure_planning"
  | "cast_planning"
  | "scene_planning"
  | "scope_advisory"
  | "brief_drafting"
  | "persona_recommendation";
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
      '你是小说正史记录员。仅提取正文明确发生或明确改变的事实，不推测。特别要记录人物的外貌变化（发型、伤痕、残疾）、衣着变化、新增身份或头衔——后续章节必须延续这些状态。返回严格 JSON：{"proposals":[{"kind":"timeline|character_state|foreshadow","title":"简短标题","payload":{}}]}。格式硬性要求：数组字段必须是字符串数组，不要写成一句话；foreshadow 的 status 只能取 planned|planted|developing|resolved|abandoned，不要写 open 等其他值。character_state 的 payload：characterName、summary、location、appearance（外貌变化）、outfit（衣着）、identity（新增身份）、physical、emotional、knowledge[]、goals[]、inventory[]、skills[]；timeline：storyTime、detail、participants[]；foreshadow：detail、status。正文：\n{{content}}',
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
      '你是资深网文主编兼世界观架构师。基于以下作品信息生成故事圣经与核心设定卡。\n书名：{{title}}\n题材：{{genre}}\n核心设定：\n{{premise}}\n作者已经确认的创作简报（必须保留其意图，不得擅自改写禁忌）：\n{{brief}}\n规划篇幅：约 {{targetChapters}} 章，单章约 {{chapterWords}} 字。\n要求：世界观规则要可执行（明确约束、代价与例外），文风圣经要给出具体可操作的文字规范，创作边界写清禁止事项；角色卡覆盖主角、对手与关键配角。\n返回严格 JSON：{"sections":[{"kind":"intent|world|style|boundaries","content":"该节完整内容，纯文本可多段"}],"characters":[{"type":"character","name":"姓名","summary":"一句话定位","aliases":["别名"],"profile":{"身份":"","性格":"","目标":"","秘密":""}}],"entities":[{"type":"location|organization|item|term","name":"名称","summary":"一句话说明","aliases":[],"profile":{"":" "}}]}。sections 四种 kind 各一条。',
  },
  structure_planning: {
    key: "structure_planning",
    name: "分卷与章节规划",
    description: "基于故事圣经生成卷级阶段目标与逐章标题大纲。",
    template:
      '你是长篇网文结构策划。基于以下信息规划分卷与章节目录。\n书名：{{title}}（{{genre}}）\n核心设定：{{premise}}\n规划篇幅：{{targetChapters}} 章，单章 {{chapterWords}} 字。\n故事圣经：\n{{bible}}\n要求：每卷有明确的阶段目标与转折点；必须恰好生成 {{targetChapters}} 个章节；每章都要有符合本章事件的独立标题；章节大纲两到四句，写清事件、出场人物、使用场景、冲突、结果、伏笔与章末钩子；节奏遵循网文断章钩子习惯。\n返回严格 JSON：{"volumes":[{"title":"卷名","outline":"卷级目标与转折"}],"chapters":[{"volumeTitle":"所属卷名","title":"第X章 章节名","outline":"本章大纲"}]}。chapters 按顺序完整覆盖全部卷，不得省略标题或章纲。',
  },
  rolling_structure_planning: {
    key: "rolling_structure_planning",
    name: "滚动批次策划",
    description: "生成全书宏观路线和当前章节范围的详细策划包。",
    template:
      '你是长篇网文总策划。不要一次生成全书所有章节，只规划第 {{startChapter}}–{{endChapter}} 章，并给出可调整的全书宏观阶段。\n书名：{{title}}（{{genre}}）\n核心设定：{{premise}}\n全书目标：约 {{targetChapters}} 章，单章 {{chapterWords}} 字。\n故事圣经：\n{{bible}}\n\n既有人物、地点、势力、物品和术语目录（每行开头 E-XXXXXXXX 是稳定引用；引用既有实体时必须原样使用，禁止擅自改名）：\n{{entities}}\n\n截至当前范围之前的已确认动态正史：\n{{canonMemory}}\n\n当前范围已有内容：\n{{existingPlans}}\n\n要求：roadmap 只给阶段/分卷范围、目标、转折和收束；cycle 写清本批次开场状态、目标、高潮和预期结束状态；chapters 必须恰好覆盖第 {{startChapter}}–{{endChapter}} 章，每章写独立标题、两到四句章纲、视角人物、涉及人物、场景、道具、技能、冲突结果、伏笔动作和章末钩子。characters/scenes/items 中引用既有实体时写稳定引用；实际结束状态和动态正史优先于旧的预期及静态实体卡。不得让已退场人物无解释复活，不得忽略开放伏笔。发现前置设定不足时写入 proposals，不得直接覆盖既有设定；更新既有实体必须填写 targetRef；疑似同一实体但称呼不同则提交 merge 提案，不得新建双卡。\n返回严格 JSON：{"volumes":[{"title":"卷名","outline":"阶段范围、目标、关键转折与收束"}],"cycle":{"goal":"","openingState":"","climax":"","expectedClosingState":""},"chapters":[{"position":1,"volumeTitle":"所属卷名","title":"第1章 标题","outline":"事件、人物、场景、冲突、结果、伏笔与钩子","viewpoint":"","characters":["E-XXXXXXXX"],"scenes":["E-XXXXXXXX"],"items":["E-XXXXXXXX"],"skills":[]}],"proposals":[{"action":"add|update|merge","targetType":"character|location|organization|item|term","targetRef":"更新或合并时填 E-XXXXXXXX","targetName":"","patch":{},"reason":""}]}。除这个 JSON 外不要输出其他文字。',
  },
  cast_planning: {
    key: "cast_planning",
    name: "人物分层规划",
    description: "把人物划分为主角/核心配角/酱油/龙套四级并补充名称库。",
    template:
      '你是长篇网文角色策划。基于故事圣经为本书设计完整人物体系。\n书名：{{title}}（{{genre}}）\n故事圣经：\n{{bible}}\n既有角色（E-XXXXXXXX 是稳定引用；保持名字不变并原样回填 entityRef）：\n{{characters}}\n名称库（新角色起名须参照此风格，禁止重名）：\n{{namePool}}\n分层规则：protagonist 主角 1 名；support 核心配角 3-6 名（对手/伙伴/导师）；recurring 酱油人物 6-15 名（会在多章反复出现）；extra 跑龙套仅给名字（不出卡片）。\n人物卡“两者都有”：profile 是给 AI 用的结构化设定，另写一段给作者读的详细小传。既有角色必须填写 entityRef；新角色省略 entityRef。疑似同一人物但称呼不同，不得自行合并或新建双卡。\n返回严格 JSON：{"characters":[{"entityRef":"既有角色填 E-XXXXXXXX，新角色省略","name":"姓名","summary":"一句话定位","aliases":[],"tier":"protagonist|support|recurring","profile":{},"detailedBio":"150-300字详细人物小传（作者阅读用：经历、关系、当前处境、说话味道）"}],"extras":["龙套姓名","…"]}。\nprotagonist 与 support 的 profile 必须完整：身份、人格（MBTI 或原型标签）、价值观、欲望、恐惧、性格缺陷、秘密、语言习惯、压力反应、成长弧线、外貌、衣着、目标。recurring 的 profile 只需 出现条件 与 性格标签（一句话）两项。',
  },
  persona_recommendation: {
    key: "persona_recommendation",
    name: "人格阵容推荐",
    description: "为整个人物阵容推荐人格与写作行为约束，作者批量确认后生效。",
    template:
      "你是长篇网文人格策划。为以下整本书的人物阵容一次性推荐人格设定，供作者逐个调整后批量确认。\n书名：{{title}}（{{genre}}）\n核心设定：{{premise}}\n故事圣经：\n{{bible}}\n\n人物阵容：\n{{characters}}\n\n推荐规则：\n1. 只为主角和核心配角推荐完整人格模型：personaType 用 MBTI（如 INTJ）或角色原型（如“智者”“影子”）+ 一句话定位；价值观、恐惧、缺陷要能直接约束写作用词与决策。\n2. 常驻次要人物（酱油）只给简化性格标签：一句可以复用的性格短语，不使用 MBTI。\n3. 跑龙套不推荐（不要出现在结果里）。\n4. 每个人给出写作行为约束 writingConstraints：对话风格、决策倾向、压力下的反应，让正文生成时人物言行不串线。\n5. 全阵容人格要互补且服务主线矛盾，避免两个同质人格。\n\n返回严格 JSON：{\"recommendations\":[{\"name\":\"人物名（必须与阵容一致）\",\"personaType\":\"人格标签\",\"reason\":\"推荐理由（一两句）\",\"writingConstraints\":\"写作行为约束\",\"speechHabit\":\"语言习惯\"}]}。除这个 JSON 外不要输出其他文字。",
  },
  scene_planning: {
    key: "scene_planning",
    name: "场景库规划",
    description: "生成可复用的功能场景卡（含视觉锚点，保证重复场景一致）。",
    template:
      '你是长篇网文场景与实体设计师。基于故事圣经设计本书的场景库、势力、关键物品和术语。\n书名：{{title}}（{{genre}}）\n故事圣经：\n{{bible}}\n既有地点（E-XXXXXXXX 是稳定引用；沿用名字并原样回填 entityRef）：\n{{locations}}\n要求：场景覆盖主基地、规则空间、常去现实场景和前中期副本；每个场景给 3-5 个固定视觉锚点。势力和关键物品必须服务主线冲突，禁止只起名字不说明用途。既有实体必须填写 entityRef；新实体省略。疑似同一实体但称呼不同，不得自行合并或新建双卡。\n返回严格 JSON：{"scenes":[{"entityRef":"既有地点填 E-XXXXXXXX","name":"场景名","aliases":[],"summary":"一句话说明","purpose":"叙事功能","mood":"感官氛围","visualAnchors":["锚点1","锚点2"],"residents":"常驻人物","dangerLevel":"低|中|高"}],"entities":[{"entityRef":"既有实体填写，新实体省略","type":"organization|item|term","name":"名称","summary":"用途和与主线关系","aliases":[],"profile":{}}]}。共 8-20 个场景，并至少包含 1 个 organization 和 1 个 item。',
  },
  scope_advisory: {
    key: "scope_advisory",
    name: "篇幅与节奏顾问",
    description: "开书前按平台规则建议总章数、单章字数、分卷骨架与里程碑。",
    template:
      "你是网文开书顾问，服务目标是番茄小说（免费阅读平台）的新人作者。以下平台规则是既定事实，不得修改或另发明标准：\n" +
      "1. 单章主流 2000–3000 字（建议 2500 上下），章末必须留钩子；长章在免费平台吃亏。\n" +
      "2. 免费平台按章末广告分成，章节短而多优于长而少；常规完本体量 100–300 万字。\n" +
      "3. 前三章定生死（黄金三章），30 章内看追读与完读率，开书头几天是算法给量窗口。\n" +
      "4. 新人第一本书建议先以 20–60 万字为目标跑通流程、摸清数据，再决定续写或切书。\n\n" +
      "作者信息：\n书名：{{title}}\n题材：{{genre}}\n核心设定：{{premise}}\n作者补充：{{notes}}\n\n" +
      "请基于以上信息给出一套开书建议：推荐体量档位（试水 20 万左右 / 标准 40–60 万 / 长线 100 万+，只选一档）、总章数、单章字数（在平台规则带内）、日更章数与预计完本天数；分卷骨架（卷名、起止章、每卷目标与高潮）；关键里程碑（至少覆盖黄金三章、首个小高潮、30 章考核点、第一个大高潮）；给新人的注意事项。\n" +
      '返回严格 JSON：{"recommendation":{"tierLabel":"档位名","totalChapters":120,"chapterWords":2500,"dailyChapters":2,"estimatedDays":60,"reason":"一段话理由"},"milestones":[{"position":3,"label":"黄金三章完成","goal":"该节点前要完成什么"}],"volumeSkeleton":[{"title":"卷名","startChapter":1,"endChapter":40,"goal":"本卷目标","climax":"本卷高潮"}],"notes":["给新人的提醒"]}。milestones 5-10 条、volumeSkeleton 3-8 卷、notes 2-5 条。除这个 JSON 外不要输出其他文字。',
  },
  brief_drafting: {
    key: "brief_drafting",
    name: "开书简报代笔",
    description: "为十步向导第 1–2 步起草七项创作简报，作者审阅后保存。",
    template:
      "你是网文开书简报代笔。基于作品信息一次性起草七项创作简报，供作者逐项审阅修改。各字段写法规范（既定要求，不得偏离）：\n" +
      "audience 目标读者：具体人群画像（阅读偏好、追更场景），不要只写年龄段。\n" +
      "style 文风：可操作规范——叙事视角、句子节奏、对话密度、章末钩子习惯；禁止形容词堆砌。\n" +
      "boundaries 禁忌与不可改动项：可执行的红线（禁止的情节类型、不可改的核心设定、主角底线）。这是作者死设定，你只提供该题材常见且稳妥的占位，默认保守。\n" +
      "sellingPoint 核心卖点：一句话说清读者为什么追。\n" +
      "conflict 主线矛盾：谁与谁因为什么不可回避地对抗。\n" +
      "protagonistGoal 主角目标与失败代价：想要什么、得不到会失去什么。\n" +
      "ending 结局方向：成败与主角最终变化，细节可留白。\n" +
      "作品信息：书名：{{title}}；题材：{{genre}}；核心设定：{{premise}}；作者补充：{{notes}}\n" +
      '返回严格 JSON：{"audience":"","style":"","boundaries":"","sellingPoint":"","conflict":"","protagonistGoal":"","ending":""}，每项一到三句中文。除这个 JSON 外不要输出其他文字。',
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

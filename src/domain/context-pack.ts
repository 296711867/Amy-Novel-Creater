import type { BibleSection, StoryEntity } from "./story-bible";
import type {
  CharacterState,
  ForeshadowThread,
  TimelineEvent,
} from "./continuity";
import type { Chapter, Novel } from "./novel";
import type { StoryScene, StoryVolume } from "./story-structure";
import { getTemplate, renderTemplate } from "./prompt-templates";
import type { PromptTemplateOverrides } from "./prompt-templates";
import { characterTierOf, isCharacterRelevant, mentions } from "./story-bible";
import { sceneCardText } from "./scene-card";

export type ContextSourceKind =
  | "instruction"
  | "bible"
  | "structure"
  | "entity"
  | "continuity"
  | "recent_chapter";
export interface ContextSource {
  id: string;
  kind: ContextSourceKind;
  label: string;
  text: string;
  priority: number;
  required: boolean;
}
export interface PackedContextSource extends ContextSource {
  estimatedTokens: number;
  includedTokens: number;
  status: "included" | "trimmed" | "omitted";
}
export interface ContextPack {
  chapterId: string;
  renderedText: string;
  contentHash: string;
  inputTokens: number;
  outputTokensReserved: number;
  totalBudget: number;
  sources: PackedContextSource[];
  createdAt: string;
}
export interface ContextPackInput {
  novel: Novel;
  chapter: Chapter;
  volume?: StoryVolume;
  scenes: StoryScene[];
  bible: BibleSection[];
  entities: StoryEntity[];
  timeline: TimelineEvent[];
  foreshadow: ForeshadowThread[];
  characterStates: CharacterState[];
  recentChapters: Chapter[];
  inputBudget: number;
  outputTokensReserved: number;
  promptOverrides?: PromptTemplateOverrides;
  /** 名称库提示（题材风格+示例名），约束模型给新人物起名的风格。 */
  namePoolHint?: string;
}

export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const rest = text.replace(/[\u3400-\u9fff\uf900-\ufaff\s]/g, "").length;
  return Math.max(text.trim() ? 1 : 0, Math.ceil(cjk * 1.05 + rest / 4));
}
function fingerprint(text: string): string {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
function entityText(item: StoryEntity): string {
  return `${item.name}${item.aliases.length ? `（别名：${item.aliases.join("、")}）` : ""}：${item.summary}\n${Object.entries(
    item.profile,
  )
    .map(([key, value]) => `${key}：${value}`)
    .join("\n")}`;
}
// Trim to at most maxChars, preferring paragraph boundaries, then sentence
// boundaries (CJK-aware), so the model never receives a sentence cut in half.
export function trimAtBoundary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars);
  const paragraph = Math.max(
    window.lastIndexOf("\n\n"),
    window.lastIndexOf("\n"),
  );
  if (paragraph >= maxChars * 0.5) return window.slice(0, paragraph);
  const sentence = Math.max(
    window.lastIndexOf("。"),
    window.lastIndexOf("！"),
    window.lastIndexOf("？"),
    window.lastIndexOf("."),
    window.lastIndexOf("!"),
    window.lastIndexOf("?"),
  );
  if (sentence >= maxChars * 0.5) return window.slice(0, sentence + 1);
  return window;
}
export function buildContextPack(input: ContextPackInput): ContextPack {
  const sources: ContextSource[] = [
    {
      id: "instruction",
      kind: "instruction" as const,
      label: "写作任务",
      priority: 100,
      required: true,
      text: renderTemplate(
        getTemplate("chapter_instruction", input.promptOverrides),
        {
          novelTitle: input.novel.title,
          chapterTitle: input.chapter.title,
          targetWords: input.chapter.targetWords,
        },
      ).text,
    },
    {
      id: `chapter:${input.chapter.id}`,
      kind: "structure" as const,
      label: "当前章节计划",
      priority: 98,
      required: true,
      text: `所属卷：${input.volume?.title ?? "未分卷"}\n卷目标：${input.volume?.outline ?? ""}\n章节大纲：${input.chapter.outline || "暂未填写"}\n场景：\n${input.scenes.map((s, i) => `${i + 1}. ${s.title}｜视角：${s.viewpoint || "未指定"}｜地点：${s.location || "未指定"}｜${s.summary}`).join("\n") || "暂未拆分场景"}`,
    },
    ...input.bible.map((item, index) => ({
      id: item.id,
      kind: "bible" as const,
      label: `故事圣经 · ${item.kind}`,
      priority: 92 - index,
      required: item.kind === "style" || item.kind === "boundaries",
      text: item.content,
    })),
    ...(() => {
      // 人物按 tier 过滤：主角/核心配角常驻；酱油仅章纲提及；龙套不进上下文。
      // 场景卡（location 且有功能字段）仅章纲/章题提及才注入，锚点保证一致性。
      const chapterText = `${input.chapter.title}\n${input.chapter.outline}\n${input.scenes.map((s) => `${s.title}${s.summary}${s.location}`).join("\n")}`;
      const characterSources = input.entities
        .filter((item) => item.type === "character")
        .filter((item) => isCharacterRelevant(item, chapterText))
        .map((item) => ({
          id: item.id,
          kind: "entity" as const,
          label: `资料 · ${item.name}`,
          priority: characterTierOf(item) === "protagonist" ? 76 : 72,
          required: false,
          text: entityText(item),
        }));
      const sceneSources = input.entities
        .filter((item) => item.type === "location")
        .map((item) => ({ entity: item, card: sceneCardText(item) }))
        .filter(
          (item) =>
            item.card !== null && mentions(chapterText, item.entity) === true,
        )
        .map((item) => ({
          id: `${item.entity.id}:scene`,
          kind: "entity" as const,
          label: `场景 · ${item.entity.name}`,
          priority: 88,
          required: false,
          text: `${item.entity.name}${item.entity.aliases.length ? `（别名：${item.entity.aliases.join("、")}）` : ""}\n${item.card}`,
        }));
      const otherSources = input.entities
        .filter(
          (item) =>
            item.type !== "character" &&
            (item.type !== "location" || sceneCardText(item) === null),
        )
        .map((item) => ({
          id: item.id,
          kind: "entity" as const,
          label: `资料 · ${item.name}`,
          priority: 72,
          required: false,
          text: entityText(item),
        }));
      return [...sceneSources, ...characterSources, ...otherSources];
    })(),
    ...(input.namePoolHint
      ? [
          {
            id: "name-pool",
            kind: "entity" as const,
            label: "名称库",
            priority: 70,
            required: false,
            text: input.namePoolHint,
          },
        ]
      : []),
    ...input.foreshadow
      .filter(
        (item) => item.status !== "resolved" && item.status !== "abandoned",
      )
      .map((item) => ({
        id: item.id,
        kind: "continuity" as const,
        label: `伏笔 · ${item.title}`,
        priority: 84,
        required: false,
        text: `状态：${item.status}\n${item.detail}`,
      })),
    ...input.timeline.map((item) => ({
      id: item.id,
      kind: "continuity" as const,
      label: `时间线 · ${item.title}`,
      priority: 82,
      required: false,
      text: `${item.storyTime}\n${item.detail}`,
    })),
    ...input.characterStates.map((item) => ({
      id: item.id,
      kind: "continuity" as const,
      label: "角色当前状态",
      priority: 86,
      required: false,
      text: `${item.summary}\n位置：${item.location}；身体：${item.physical}；情绪：${item.emotional}\n目标：${item.goals.join("、")}\n已知：${item.knowledge.join("、")}\n物品：${item.inventory.join("、")}`,
    })),
    ...input.recentChapters.map((item) => ({
      id: item.id,
      kind: "recent_chapter" as const,
      label: `最近正文 · ${item.title}`,
      priority: 78 + item.position / 10000,
      required: false,
      text: item.content,
    })),
  ]
    .filter((item) => item.text.trim())
    .sort(
      (a, b) =>
        Number(b.required) - Number(a.required) || b.priority - a.priority,
    );
  let remaining = Math.max(0, input.inputBudget),
    rendered: string[] = [];
  const packed: PackedContextSource[] = sources.map((source) => {
    const tokens = estimateTokens(source.text),
      allow = Math.min(tokens, remaining);
    if (allow <= 0)
      return {
        ...source,
        estimatedTokens: tokens,
        includedTokens: 0,
        status: "omitted",
      };
    const ratio = allow / tokens,
      text =
        ratio >= 1
          ? source.text
          : trimAtBoundary(
              source.text,
              Math.max(1, Math.floor(source.text.length * ratio)),
            );
    remaining -= allow;
    rendered.push(`## ${source.label}\n${text}`);
    return {
      ...source,
      estimatedTokens: tokens,
      includedTokens: allow,
      status: allow < tokens ? "trimmed" : "included",
    };
  });
  const renderedText = rendered.join("\n\n"),
    inputTokens = packed.reduce((sum, item) => sum + item.includedTokens, 0);
  return {
    chapterId: input.chapter.id,
    renderedText,
    contentHash: fingerprint(renderedText),
    inputTokens,
    outputTokensReserved: input.outputTokensReserved,
    totalBudget: input.inputBudget + input.outputTokensReserved,
    sources: packed,
    createdAt: new Date().toISOString(),
  };
}

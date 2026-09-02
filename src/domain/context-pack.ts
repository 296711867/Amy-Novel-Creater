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
  /** 审查驱动的修订要求（AN-023/AN-027）：按最新正史重写本章时注入。 */
  revisionNotes?: string;
}

export function estimateTokens(text: string): number {
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const rest = text.replace(/[\u3400-\u9fff\uf900-\ufaff\s]/g, "").length;
  return Math.max(text.trim() ? 1 : 0, Math.ceil(cjk * 1.05 + rest / 4));
}
export function selectRecentChapters(
  chapters: Chapter[],
  beforePosition: number,
  candidateChain: Chapter[] = [],
  limit = 2,
): Chapter[] {
  const byId = new Map(
    chapters
      .filter((item) => item.position < beforePosition && item.content.trim())
      .map((item) => [item.id, item]),
  );
  for (const item of candidateChain)
    if (item.position < beforePosition && item.content.trim())
      byId.set(item.id, item);
  return [...byId.values()]
    .sort((a, b) => a.position - b.position)
    .slice(-limit);
}
/**
 * 写第 N 章时只取每个人截至第 N-1 章的最新状态：初始档案之外的
 * 外貌/衣着/身份/伤势演进都按章覆盖，避免“伤好了、衣服换回来了”。
 * 手动创建（无章节归属）的状态视为作者给定的最新状态。
 */
export function selectCharacterStates(
  states: CharacterState[],
  chapterPositionById: Map<string, number>,
  beforePosition: number,
): CharacterState[] {
  const positionOf = (state: CharacterState): number =>
    state.chapterId && chapterPositionById.has(state.chapterId)
      ? chapterPositionById.get(state.chapterId)!
      : Number.POSITIVE_INFINITY;
  const latest = new Map<string, CharacterState>();
  for (const state of states) {
    const position = positionOf(state);
    if (Number.isFinite(position) && position >= beforePosition) continue;
    const current = latest.get(state.characterId);
    if (
      !current ||
      positionOf(state) > positionOf(current) ||
      (positionOf(state) === positionOf(current) &&
        state.updatedAt >= current.updatedAt)
    )
      latest.set(state.characterId, state);
  }
  return [...latest.values()];
}
/** 单章上下文最多注入的开放伏笔条数（AN-038 伏笔膨胀治理）。 */
export const FORESHADOW_CONTEXT_LIMIT = 16;
/** 单章上下文最多注入的时间线事件条数（取最近发生的）。 */
export const TIMELINE_CONTEXT_LIMIT = 24;

/**
 * AN-038 开放伏笔裁剪：无上限注入会让上下文随章节数线性膨胀（实测 175 条
 * 未回收伏笔把第 61 章推到 10.6 万 tokens）。排序规则：
 * 1. 本章计划（章题/大纲/场景）提及的伏笔最先保留——即将回收；
 * 2. 其余按埋设章距当前章的"账龄"降序——埋得越久越超期，越该优先回收。
 */
export function selectForeshadowThreads(
  foreshadow: ForeshadowThread[],
  positionByChapterId: Map<string, number>,
  chapterPosition: number,
  chapterPlanText: string,
  limit = FORESHADOW_CONTEXT_LIMIT,
): ForeshadowThread[] {
  const positionOf = (item: ForeshadowThread): number =>
    item.setupChapterId
      ? (positionByChapterId.get(item.setupChapterId) ??
        Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;
  return foreshadow
    .filter(
      (item) => item.status !== "resolved" && item.status !== "abandoned",
    )
    .filter((item) => {
      const setup = positionOf(item);
      return setup < chapterPosition;
    })
    .sort((a, b) => {
      const aMentioned = chapterPlanText.includes(a.title),
        bMentioned = chapterPlanText.includes(b.title);
      if (aMentioned !== bMentioned)
        return Number(bMentioned) - Number(aMentioned);
      // 账龄大（埋得早）在前；无埋设章的排最后。
      const aAge = chapterPosition - positionOf(a),
        bAge = chapterPosition - positionOf(b);
      return bAge - aAge || a.createdAt.localeCompare(b.createdAt);
    })
    .slice(0, limit);
}

/**
 * AN-038 时间线裁剪：只保留截至当前章最近的 N 条事件。更早的事件已由
 * 周期收束状态与人物状态概括，逐条注入只是重复消耗预算。作者手动创建
 * （无章节归属）的事件视为世界观锚点，优先保留。
 */
export function selectTimelineEvents(
  timeline: TimelineEvent[],
  positionByChapterId: Map<string, number>,
  chapterPosition: number,
  limit = TIMELINE_CONTEXT_LIMIT,
): TimelineEvent[] {
  const chaptered = timeline
    .filter((item) => {
      if (!item.chapterId) return false;
      const at = positionByChapterId.get(item.chapterId);
      return at !== undefined && at <= chapterPosition;
    })
    .sort(
      (a, b) =>
        (positionByChapterId.get(a.chapterId!) ??
          Number.POSITIVE_INFINITY) -
          (positionByChapterId.get(b.chapterId!) ?? Number.POSITIVE_INFINITY) ||
        a.createdAt.localeCompare(b.createdAt),
    );
  const manual = timeline.filter((item) => !item.chapterId);
  const keptManual = manual.slice(0, limit),
    keptChaptered = chaptered.slice(
      Math.max(0, chaptered.length - Math.max(0, limit - keptManual.length)),
    );
  return [...keptManual, ...keptChaptered];
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
    ...(input.revisionNotes?.trim()
      ? [
          {
            id: "revision-notes",
            kind: "instruction" as const,
            label: "审查修订要求",
            priority: 99,
            required: true,
            text: `本章是按审查反馈重写的版本。上一版被审查出以下问题，重写时必须逐项解决，同时保持与正史一致：\n${input.revisionNotes.trim()}`,
          },
        ]
      : []),
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
    ...(input.foreshadow.length
      ? [
          {
            id: "foreshadow-guidance",
            kind: "continuity" as const,
            label: "伏笔治理",
            priority: 85,
            required: false,
            text: "以下开放伏笔按「本章计划提及优先，其次埋设最久」排序。写作时优先推进或回收最早埋下且仍未回收的伏笔，不要凭空新开无法回收的伏笔线。",
          },
        ]
      : []),
    ...input.foreshadow.map((item) => ({
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
      text: [
        item.summary,
        `位置：${item.location}；身体：${item.physical}；情绪：${item.emotional}`,
        item.appearance && `外貌：${item.appearance}`,
        item.outfit && `衣着：${item.outfit}`,
        item.identity && `身份：${item.identity}`,
        `目标：${item.goals.join("、")}`,
        `已知：${item.knowledge.join("、")}`,
        `物品：${item.inventory.join("、")}`,
        `技能：${item.skills.join("、")}`,
      ]
        .filter(Boolean)
        .join("\n"),
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

import { z } from "zod";
import type { Chapter, Novel } from "./novel";
import { entityShortRef, type BibleSection, type StoryEntity } from "./story-bible";
import { getTemplate, renderTemplate } from "./prompt-templates";
import type { PromptTemplateOverrides } from "./prompt-templates";
import type { NewPlanningProposal } from "./planning-proposal";
import type { PlanningCycle } from "./planning-cycle";
import type {
  CharacterState,
  ForeshadowThread,
  TimelineEvent,
} from "./continuity";
import { selectCharacterStates } from "./context-pack";
import {
  EMPTY_PLANNING_BRIEF,
  planningBriefText,
  type PlanningBrief,
} from "./planning-workflow";

// 真实模型常把 profile 字段值写成数组或数字（如“核心手段”:["a","b"]）。
// 解析边界统一归一为字符串，避免结构等价的数据被整体拒绝。
const profileValue = z
  .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
  .transform((value) =>
    Array.isArray(value) ? value.map(String).join("、") : String(value),
  );
const profile = z.record(z.string(), profileValue).default({});
const entity = z.object({
  type: z.enum(["character", "location", "organization", "item", "term"]),
  name: z.string().min(1),
  summary: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  profile,
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
        position: z.number().int().positive().optional(),
        volumeTitle: z.string().default(""),
        title: z.string().min(1),
        outline: z.string().min(1),
        viewpoint: z.string().default(""),
        characters: z.array(z.string()).default([]),
        scenes: z.array(z.string()).default([]),
        items: z.array(z.string()).default([]),
        skills: z.array(z.string()).default([]),
      }),
    )
    .max(600),
  cycle: z
    .object({
      goal: z.string().default(""),
      openingState: z.string().default(""),
      climax: z.string().default(""),
      expectedClosingState: z.string().default(""),
    })
    .default({
      goal: "",
      openingState: "",
      climax: "",
      expectedClosingState: "",
    }),
  proposals: z
    .array(
      z.object({
        action: z.enum(["add", "update", "merge"]),
        targetType: z.enum([
          "character",
          "location",
          "organization",
          "item",
          "term",
        ]),
        targetRef: z.string().optional(),
        targetName: z.string().min(1),
        patch: z.object({
          summary: z.string().optional(),
          aliases: z.array(z.string()).optional(),
          profile: profile.optional(),
        }),
        reason: z.string().min(1),
      }),
    )
    .max(30)
    .default([]),
});
const castPlan = z.object({
  characters: z
    .array(
      z.object({
        entityRef: z.string().optional(),
        name: z.string().min(1),
        summary: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        tier: z.enum(["protagonist", "support", "recurring"]),
        profile,
        /** 给作者读的详细人物小传；存进 profile.详细小传。 */
        detailedBio: z.string().default(""),
      }),
    )
    .max(30),
  extras: z.array(z.string().min(1)).max(80).default([]),
});
const scenePlan = z.object({
  scenes: z
    .array(
      z.object({
        entityRef: z.string().optional(),
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
  entities: z
    .array(
      z.object({
        type: z.enum(["organization", "item", "term"]),
        entityRef: z.string().optional(),
        name: z.string().min(1),
        summary: z.string().min(1),
        aliases: z.array(z.string()).default([]),
        profile,
      }),
    )
    .max(20)
    .default([]),
});
export type PlannedEntity = z.infer<typeof entity>;
export type BiblePlan = z.infer<typeof biblePlan>;
export type StructurePlan = z.infer<typeof structurePlan>;
export type CastPlan = z.infer<typeof castPlan>;
export type ScenePlan = z.infer<typeof scenePlan>;
export type StructurePlanningProposal = NewPlanningProposal;
export type PlanPhase = "bible" | "structure" | "cast" | "scenes";
export interface PlanRange {
  startChapter: number;
  endChapter: number;
}
export interface NovelPlanningPromptInput {
  phase: PlanPhase;
  novel: Novel;
  bible: BibleSection[];
  brief: PlanningBrief;
  entities: StoryEntity[];
  chapters?: Chapter[];
  range?: PlanRange;
  rollingMemory?: RollingPlanningMemory;
  namePoolText: string;
  overrides?: PromptTemplateOverrides;
}
export interface RollingPlanningMemory {
  cycles: PlanningCycle[];
  characterStates: CharacterState[];
  timeline: TimelineEvent[];
  foreshadow: ForeshadowThread[];
}
export interface NovelPlanSummary {
  phase: PlanPhase;
  sections: number;
  entities: number;
  volumes: number;
  chapters: number;
  extras: number;
}

const clip = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value;

/**
 * 下一批策划只读取范围开始前已确认的动态正史。总长度硬限制 4000 字符，
 * 优先保留上一周期收束和人物最新状态，再放开放伏笔与时间线尾部。
 */
export function rollingPlanningMemoryText(
  memory: RollingPlanningMemory | undefined,
  entities: StoryEntity[],
  chapters: Chapter[],
  range: PlanRange,
): string {
  if (!memory || range.startChapter <= 1)
    return "（首个规划周期，没有上一批封存记忆）";
  const previous = memory.cycles
      .filter(
        (item) =>
          item.status === "completed" && item.endChapter < range.startChapter,
      )
      .sort((a, b) => b.endChapter - a.endChapter)[0],
    positions = new Map(chapters.map((item) => [item.id, item.position])),
    characterNames = new Map(entities.map((item) => [item.id, item.name])),
    states = selectCharacterStates(
      memory.characterStates,
      positions,
      range.startChapter,
    )
      .map((state) => {
        const details = [
          state.summary,
          state.location && `位置：${state.location}`,
          state.identity && `身份：${state.identity}`,
          state.physical && `身体：${state.physical}`,
          state.emotional && `情绪：${state.emotional}`,
          state.goals.length && `目标：${state.goals.join("、")}`,
          state.inventory.length && `持有：${state.inventory.join("、")}`,
          state.skills.length && `技能：${state.skills.join("、")}`,
        ].filter(Boolean);
        return `- ${characterNames.get(state.characterId) ?? state.characterId}：${clip(details.join("；"), 320)}`;
      })
      .slice(0, 20),
    beforeRange = (chapterId: string | null) =>
      !chapterId || (positions.get(chapterId) ?? Number.POSITIVE_INFINITY) < range.startChapter,
    openForeshadow = memory.foreshadow
      .filter(
        (item) =>
          !["resolved", "abandoned"].includes(item.status) &&
          beforeRange(item.setupChapterId),
      )
      .slice(0, 12)
      .map(
        (item) =>
          `- ${item.title}（${item.status}）：${clip(item.detail, 180)}`,
      ),
    timelineTail = memory.timeline
      .filter((item) => beforeRange(item.chapterId))
      .sort((a, b) => {
        const aPosition = a.chapterId ? (positions.get(a.chapterId) ?? 0) : 0,
          bPosition = b.chapterId ? (positions.get(b.chapterId) ?? 0) : 0;
        return aPosition - bPosition || a.updatedAt.localeCompare(b.updatedAt);
      })
      .slice(-12)
      .map(
        (item) =>
          `- ${item.storyTime}｜${item.title}：${clip(item.detail, 180)}`,
      ),
    sections = [
      previous
        ? `【上一周期 第 ${previous.startChapter}–${previous.endChapter} 章】\n预期结束：${clip(previous.expectedClosingState || "未填写", 700)}\n实际结束（优先作为下一批起点）：${clip(previous.actualClosingState || "未填写", 1200)}`
        : "【上一周期】没有找到已封存周期；只能使用下方动态正史。",
      `【人物最新状态】\n${states.join("\n") || "无已确认人物状态"}`,
      `【开放伏笔】\n${openForeshadow.join("\n") || "无开放伏笔"}`,
      `【时间线尾部】\n${timelineTail.join("\n") || "无已确认时间线"}`,
    ];
  return clip(sections.join("\n\n"), 4000);
}

export function extractPlanningJson(raw: string): string {
  const text = raw.trim();
  if (!text) throw new Error("模型没有返回规划内容");
  try {
    JSON.parse(text);
    return text;
  } catch {}

  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const candidate = match[1].trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {}
  }

  const start = text.indexOf("{");
  if (start < 0) throw new Error("模型响应中没有 JSON 对象");
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) {
      const candidate = text.slice(start, index + 1),
        tail = text.slice(index + 1).replace(/```/g, "").trim();
      if (/^[\[{]/.test(tail))
        throw new Error("模型返回了多个 JSON 对象，请在规划日志中审核原始响应");
      JSON.parse(candidate);
      return candidate;
    }
  }
  throw new Error("模型返回的 JSON 对象没有完整结束");
}
export function parseBiblePlan(raw: string): BiblePlan {
  return biblePlan.parse(JSON.parse(extractPlanningJson(raw)));
}
export function parseStructurePlan(raw: string): StructurePlan {
  return structurePlan.parse(JSON.parse(extractPlanningJson(raw)));
}
/**
 * 真实模型常把阶段范围写进卷名（“卷一·启航（1-3章）”），而章节引用裸名
 * （“卷一·启航”），分隔符也不稳定（·／：／空格）。卷名匹配统一走归一化键。
 */
export function normalizeVolumeTitle(title: string): string {
  return title
    .replace(/[（(][^（）()]*[\)）]/g, "")
    .replace(/[\s·．:：、,，\-—_]/g, "")
    .toLowerCase();
}
export function assertCompleteStructurePlan(
  plan: StructurePlan,
  targetChapters: number,
  range?: PlanRange,
): void {
  const expected = range
    ? range.endChapter - range.startChapter + 1
    : targetChapters;
  if (plan.chapters.length !== expected)
    throw new Error(
      `章节规划不完整：需要 ${expected} 章，模型只返回 ${plan.chapters.length} 章`,
    );
  if (range) {
    const positions = plan.chapters.map(
      (item, index) => item.position ?? range.startChapter + index,
    );
    for (let index = 0; index < expected; index++)
      if (positions[index] !== range.startChapter + index)
        throw new Error(
          `章节范围不连续：需要第 ${range.startChapter}–${range.endChapter} 章`,
        );
  }
  const volumeKeys = new Set(
    plan.volumes.map((item) => normalizeVolumeTitle(item.title)),
  );
  const unknown = plan.chapters.find(
    (item) =>
      item.volumeTitle && !volumeKeys.has(normalizeVolumeTitle(item.volumeTitle)),
  );
  if (unknown)
    throw new Error(`章节“${unknown.title}”引用了不存在的卷“${unknown.volumeTitle}”`);
}
export function parseCastPlan(raw: string): CastPlan {
  return castPlan.parse(JSON.parse(extractPlanningJson(raw)));
}
export function parseScenePlan(raw: string): ScenePlan {
  return scenePlan.parse(JSON.parse(extractPlanningJson(raw)));
}

export function biblePlanningPrompt(
  novel: Novel,
  bible: BibleSection[] = [],
  authorBrief: PlanningBrief = EMPTY_PLANNING_BRIEF,
  overrides?: PromptTemplateOverrides,
): string {
  const existing = bible
    .filter((item) => item.content.trim())
    .map((item) => `【${item.kind}】\n${item.content}`)
    .join("\n\n")
    .slice(0, 6000);
  const brief = planningBriefText(authorBrief);
  return renderTemplate(getTemplate("bible_planning", overrides), {
    title: novel.title,
    genre: novel.genre,
    premise: novel.premise || "（未填写，请基于标题与题材合理构思）",
    targetChapters: novel.targetChapters,
    chapterWords: novel.chapterWords,
    brief: [brief, existing && `【既有故事圣经，仅用于重新生成时参考】\n${existing}`]
      .filter(Boolean)
      .join("\n\n") || "（无额外简报）",
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
export function rollingStructurePlanningPrompt(
  novel: Novel,
  bible: BibleSection[],
  entities: StoryEntity[],
  chapters: Chapter[],
  range: PlanRange,
  rollingMemory?: RollingPlanningMemory,
  overrides?: PromptTemplateOverrides,
): string {
  const digest = bible
      .map((item) => `【${item.kind}】\n${item.content}`)
      .join("\n\n")
      .slice(0, 6000),
    catalog = entities
      .map(
        (item) =>
          `${entityShortRef(item)} [${item.type}] ${item.name}${item.aliases.length ? `（${item.aliases.join("、")}）` : ""}：${item.summary}`,
      )
      .join("\n")
      .slice(0, 8000),
    existing = chapters
      .filter(
        (item) =>
          item.position >= range.startChapter &&
          item.position <= range.endChapter,
      )
      .map(
        (item) =>
          `第 ${item.position} 章｜${item.title}｜${item.outline || "尚未规划"}`,
      )
      .join("\n");
  return renderTemplate(
    getTemplate("rolling_structure_planning", overrides),
    {
      title: novel.title,
      genre: novel.genre,
      premise: novel.premise || "",
      targetChapters: novel.targetChapters,
      chapterWords: novel.chapterWords,
      startChapter: range.startChapter,
      endChapter: range.endChapter,
      bible: digest || "（尚未生成故事圣经）",
      entities: catalog || "（尚无实体，请在 proposals 中补充必要内容）",
      canonMemory: rollingPlanningMemoryText(
        rollingMemory,
        entities,
        chapters,
        range,
      ),
      existingPlans: existing || "（当前范围尚未规划）",
    },
  ).text;
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
        `- ${entityShortRef(item)}｜${item.name}${item.aliases.length ? `（别名：${item.aliases.join("、")}）` : ""}：${item.summary}`,
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
        `- ${entityShortRef(item)}｜${item.name}${item.aliases.length ? `（别名：${item.aliases.join("、")}）` : ""}：${item.summary}`,
    )
    .join("\n");
  return renderTemplate(getTemplate("scene_planning", overrides), {
    title: novel.title,
    genre: novel.genre,
    bible: digest || "（尚未生成故事圣经，建议先生成）",
    locations: existing || "（暂无）",
  }).text;
}

export function novelPlanningPrompt(input: NovelPlanningPromptInput): string {
  const {
    phase,
    novel,
    bible,
    brief,
    entities,
    chapters = [],
    range,
    rollingMemory,
    namePoolText,
    overrides,
  } =
    input;
  if (phase === "bible")
    return biblePlanningPrompt(novel, bible, brief, overrides);
  if (phase === "structure")
    return range
      ? rollingStructurePlanningPrompt(
          novel,
          bible,
          entities,
          chapters,
          range,
          rollingMemory,
          overrides,
        )
      : structurePlanningPrompt(novel, bible, overrides);
  if (phase === "cast")
    return castPlanningPrompt(
      novel,
      bible,
      entities.filter((item) => item.type === "character"),
      namePoolText,
      overrides,
    );
  return scenePlanningPrompt(
    novel,
    bible,
    entities.filter((item) => item.type === "location"),
    overrides,
  );
}

export function planningMaxOutputTokens(phase: PlanPhase): number {
  if (phase === "bible") return 8000;
  if (phase === "structure") return 12000;
  return 12000;
}

export function planningJsonRepairPrompt(input: {
  phase: PlanPhase;
  rawResponse: string;
  parseError: string;
}): string {
  return [
    "你是 JSON 修复器。只修复语法和结构，不改写、扩写或删减故事事实。",
    `规划阶段：${input.phase}`,
    `解析错误：${input.parseError}`,
    "输出要求：只返回一个可解析的 JSON 对象，不要 Markdown 围栏，不要解释。",
    "待修复原文：",
    input.rawResponse,
  ].join("\n");
}

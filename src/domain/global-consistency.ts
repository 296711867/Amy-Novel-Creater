import { z } from "zod";
import type { Chapter } from "./novel";
import type { StoryEntity } from "./story-bible";
import type {
  CharacterState,
  ForeshadowThread,
  TimelineEvent,
} from "./continuity";
import type { NewPlanningProposal } from "./planning-proposal";
import { estimateTokens } from "./context-pack";
import type { FindingSeverity } from "./quality-check";

/**
 * AN-027 全局一致性审查。
 *
 * 章节与事实建议合并入正史后，正史内部会随章节累积漂移（位置跳变、道具
 * 重复持有、伏笔超期、引用悬空等）。本模块分两层：
 * 1. `checkGlobalConsistency`：确定性规则校验器，纯本地、零 token，
 *    每章接受后增量跑、封存周期前全量跑；
 * 2. `globalReviewPrompt` / `parseGlobalReview`：AI 语义审查的提示词与
 *    解析（动机矛盾、剧情逻辑、设定漂移），每周期跑一次，产出修复
 *    提案——设定层走 planning_proposals 人工审核，不直接改正史。
 */

export const GLOBAL_REVIEW_CYCLE_ID = "global-review";

export type GlobalFindingCategory =
  | "character"
  | "location"
  | "foreshadow"
  | "timeline"
  | "consistency";

export interface GlobalFinding {
  id: string;
  novelId: string;
  /** rule = 确定性校验器；ai = 语义审查；author = 作者连读时手动标记的疑点。 */
  source: "rule" | "ai" | "author";
  severity: FindingSeverity;
  category: GlobalFindingCategory;
  message: string;
  evidence: string;
  /** 修复建议（AI 审查必填，规则校验可选）。 */
  suggestion?: string;
  /** 修复对象：setting = 实体/设定卡；chapter = 某章正文需要重写。 */
  targetKind?: "setting" | "chapter";
  targetName?: string;
  chapterPosition?: number;
  status: "open" | "dismissed";
  createdAt: string;
}

export interface GlobalConsistencyInput {
  chapters: Chapter[];
  entities: StoryEntity[];
  timeline: TimelineEvent[];
  foreshadow: ForeshadowThread[];
  characterStates: CharacterState[];
  /** 伏笔超期阈值（章）；默认 30。 */
  overdueThreshold?: number;
}

const normalizePlace = (value: string) => value.trim().replace(/[。．\s]+$/g, "");
const normalizeItem = (value: string) => value.trim();

/** 确定性全局校验：只依赖章序号与实体引用，不解析自由文本时间。 */
export function checkGlobalConsistency(
  input: GlobalConsistencyInput,
): GlobalFinding[] {
  const findings: GlobalFinding[] = [];
  const novelId = input.entities[0]?.novelId ?? input.timeline[0]?.novelId ?? "";
  const now = new Date().toISOString();
  const chapterById = new Map(input.chapters.map((item) => [item.id, item]));
  const characterEntities = input.entities.filter(
    (item) => item.type === "character",
  );
  const entityById = new Map(input.entities.map((item) => [item.id, item]));

  const positionOf = (chapterId: string | null): number =>
    (chapterId ? chapterById.get(chapterId)?.position : undefined) ?? 0;

  // 1. 记忆引用悬空：状态/时间线/伏笔指向不存在的章节或人物。
  for (const state of input.characterStates) {
    if (!entityById.has(state.characterId))
      findings.push({
        id: `rule:dangling-state:${state.id}`,
        novelId,
        source: "rule",
        severity: "error",
        category: "consistency",
        message: "人物状态记录指向不存在的人物实体",
        evidence: `characterState ${state.id}（summary：${state.summary.slice(0, 40)}）`,
        status: "open",
        createdAt: now,
      });
    if (state.chapterId && !chapterById.has(state.chapterId))
      findings.push({
        id: `rule:dangling-state-chapter:${state.id}`,
        novelId,
        source: "rule",
        severity: "error",
        category: "consistency",
        message: "人物状态记录指向不存在的章节",
        evidence: `characterState ${state.id}`,
        status: "open",
        createdAt: now,
      });
  }
  for (const event of input.timeline) {
    if (event.chapterId && !chapterById.has(event.chapterId))
      findings.push({
        id: `rule:dangling-timeline:${event.id}`,
        novelId,
        source: "rule",
        severity: "error",
        category: "timeline",
        message: "时间线事件指向不存在的章节",
        evidence: event.title,
        status: "open",
        createdAt: now,
      });
    for (const participantId of event.participantIds)
      if (!entityById.has(participantId))
        findings.push({
          id: `rule:dangling-participant:${event.id}:${participantId}`,
          novelId,
          source: "rule",
          severity: "warning",
          category: "timeline",
          message: "时间线参与者未匹配到实体",
          evidence: `${event.title} → ${participantId}`,
          status: "open",
          createdAt: now,
        });
  }
  for (const thread of input.foreshadow) {
    for (const [key, chapterId] of [
      ["setupChapterId", thread.setupChapterId],
      ["payoffChapterId", thread.payoffChapterId],
    ] as const)
      if (chapterId && !chapterById.has(chapterId))
        findings.push({
          id: `rule:dangling-foreshadow:${thread.id}:${key}`,
          novelId,
          source: "rule",
          severity: "error",
          category: "foreshadow",
          message: `伏笔的${key === "setupChapterId" ? "埋设" : "回收"}章节不存在`,
          evidence: thread.title,
          status: "open",
          createdAt: now,
        });
  }

  // 2. 位置跳变：相邻两条人物状态的地点突变，且两章之间没有该人物的
  //    时间线事件可以解释移动。
  const statesByCharacter = new Map<string, CharacterState[]>();
  for (const state of input.characterStates) {
    const list = statesByCharacter.get(state.characterId) ?? [];
    list.push(state);
    statesByCharacter.set(state.characterId, list);
  }
  const eventsByEntity = new Map<string, TimelineEvent[]>();
  for (const event of input.timeline)
    for (const participantId of event.participantIds) {
      const list = eventsByEntity.get(participantId) ?? [];
      list.push(event);
      eventsByEntity.set(participantId, list);
    }
  for (const [characterId, list] of statesByCharacter) {
    const character = entityById.get(characterId);
    if (!character) continue;
    const ordered = [...list]
      .filter((item) => item.location.trim())
      .sort((a, b) => positionOf(a.chapterId) - positionOf(b.chapterId));
    for (let index = 1; index < ordered.length; index++) {
      const previous = ordered[index - 1],
        current = ordered[index],
        from = normalizePlace(previous.location),
        to = normalizePlace(current.location);
      if (!from || !to || from === to) continue;
      const previousPosition = positionOf(previous.chapterId),
        currentPosition = positionOf(current.chapterId);
      if (!previousPosition || !currentPosition) continue;
      const explained = (eventsByEntity.get(characterId) ?? []).some(
        (event) => {
          const position = positionOf(event.chapterId);
          return (
            position > previousPosition &&
            position <= currentPosition &&
            event.participantIds.includes(characterId)
          );
        },
      );
      if (explained) continue;
      findings.push({
        id: `rule:location-jump:${characterId}:${current.id}`,
        novelId,
        source: "rule",
        severity: "warning",
        category: "location",
        message: `人物「${character.name}」的位置从「${from}」跳到「${to}」，两章之间没有对应的时间线事件解释移动`,
        evidence: `第 ${previousPosition} 章 → 第 ${currentPosition} 章的状态记录`,
        suggestion:
          "在中间章节补一条移动/转场的时间线事件，或修正其中一处状态的位置。",
        targetKind: "setting",
        targetName: character.name,
        chapterPosition: currentPosition,
        status: "open",
        createdAt: now,
      });
    }
  }

  // 3. 道具重复持有：同一件道具同时出现在多个人物的最新道具栏。
  const latestStates = [...statesByCharacter.entries()]
    .map(([characterId, list]) => {
      const withPosition = list
        .filter((item) => positionOf(item.chapterId))
        .sort(
          (a, b) => positionOf(b.chapterId) - positionOf(a.chapterId),
        );
      return withPosition[0]
        ? { characterId, state: withPosition[0] }
        : null;
    })
    .filter((item): item is { characterId: string; state: CharacterState } =>
      Boolean(item),
    );
  const itemHolders = new Map<string, string[]>();
  for (const entry of latestStates)
    for (const rawItem of entry.state.inventory) {
      const item = normalizeItem(rawItem);
      if (!item) continue;
      const holders = itemHolders.get(item) ?? [];
      const character = entityById.get(entry.characterId);
      if (character && !holders.includes(character.name))
        holders.push(character.name);
      itemHolders.set(item, holders);
    }
  for (const [item, holders] of itemHolders)
    if (holders.length > 1)
      findings.push({
        id: `rule:duplicate-item:${item}`,
        novelId,
        source: "rule",
        severity: "warning",
        category: "character",
        message: `道具「${item}」同时出现在 ${holders.length} 个人物的最新道具栏：${holders.join("、")}`,
        evidence: holders.map((name) => `「${name}」持有`).join("；"),
        suggestion:
          "确认道具归属并修正其中一方的道具栏，或补一条转移记录（时间线事件）。",
        targetKind: "setting",
        targetName: item,
        status: "open",
        createdAt: now,
      });

  // 4. 伏笔超期：埋设后超过阈值章数仍未回收。
  const threshold = input.overdueThreshold ?? 30;
  const latestPosition = input.chapters.reduce(
    (max, item) => Math.max(max, item.position),
    0,
  );
  for (const thread of input.foreshadow) {
    if (thread.status === "resolved" || thread.status === "abandoned") continue;
    const setupPosition = thread.setupChapterId
      ? positionOf(thread.setupChapterId)
      : 0;
    if (!setupPosition || latestPosition - setupPosition <= threshold) continue;
    findings.push({
      id: `rule:foreshadow-overdue:${thread.id}`,
      novelId,
      source: "rule",
      severity: "warning",
      category: "foreshadow",
      message: `伏笔「${thread.title}」埋设于第 ${setupPosition} 章，已 ${latestPosition - setupPosition} 章未回收（阈值 ${threshold}）`,
      evidence: thread.detail.slice(0, 60),
      suggestion:
        "在后续策划包里安排回收，或明确标记为 abandoned，避免读者视角的弃坑。",
      targetKind: "setting",
      targetName: thread.title,
      status: "open",
      createdAt: now,
    });
  }

  // 5. 别名冲突：不同实体共享同一名称或别名，AI 引用时会产生歧义。
  //    同一组实体共享多个名称时合并为一条发现——id 由实体组派生，
  //    按名称键逐条产出会造成同 id 重复，持久层主键会整批失败。
  const nameOwners = new Map<string, Set<string>>();
  for (const entity of input.entities)
    for (const name of [entity.name, ...entity.aliases]) {
      const key = name.trim().toLowerCase();
      if (!key) continue;
      const owners = nameOwners.get(key) ?? new Set<string>();
      owners.add(entity.name);
      nameOwners.set(key, owners);
    }
  const collisions = new Map<string, { owners: string[]; keys: string[] }>();
  for (const [key, owners] of nameOwners) {
    if (owners.size <= 1) continue;
    const groupId = [...owners].sort().join("|");
    const entry = collisions.get(groupId) ?? { owners: [...owners], keys: [] };
    entry.keys.push(key);
    collisions.set(groupId, entry);
  }
  for (const [, { owners, keys }] of collisions)
    findings.push({
      id: `rule:name-collision:${[...owners].sort().join("|")}`,
      novelId,
      source: "rule",
      severity: "warning",
      category: "consistency",
      message: `多个实体共享同一名称或别名：${owners.join("、")}`,
      evidence: `冲突名称/别名（${keys.length} 个）：${keys.join("、")}`,
      suggestion: "修正别名或合并实体，避免 AI 写作时引用错人。",
      targetKind: "setting",
      status: "open",
      createdAt: now,
    });

  // 6. 停用实体仍有最新章节状态。
  const latestCharacterIds = new Set(latestStates.map((item) => item.characterId));
  for (const entity of characterEntities)
    if (entity.status === "inactive" && latestCharacterIds.has(entity.id)) {
      const state = latestStates.find((item) => item.characterId === entity.id)!;
      findings.push({
        id: `rule:inactive-state:${entity.id}`,
        novelId,
        source: "rule",
        severity: "warning",
        category: "character",
        message: `人物「${entity.name}」已标记停用，但第 ${positionOf(state.state.chapterId)} 章仍有其状态记录`,
        evidence: state.state.summary.slice(0, 60),
        suggestion: "确认退场设定与状态记录是否矛盾。",
        targetKind: "setting",
        targetName: entity.name,
        status: "open",
        createdAt: now,
      });
    }

  // 保险：任何规则对同一对象重复产出时只保留第一条。saveGlobalFindings
  // 以 id 为主键整批写入，重复 id 会让整个事务回滚、发现永远存不下来。
  const unique = new Map<string, GlobalFinding>();
  for (const finding of findings)
    if (!unique.has(finding.id)) unique.set(finding.id, finding);
  return [...unique.values()];
}

/** AI 审查提示词的输入：全部来自已入正史的数据。 */
export interface GlobalReviewPromptInput {
  novelTitle: string;
  genre: string;
  bible: Array<{ title: string; content: string }>;
  entities: StoryEntity[];
  chapters: Chapter[];
  characterStates: CharacterState[];
  timeline: TimelineEvent[];
  foreshadow: ForeshadowThread[];
  /** 近几章正文（截断装预算），用于语义对照。 */
  recentContents: Array<{ position: number; title: string; content: string }>;
  /** 上下文预算（token）。 */
  inputBudget: number;
}

const clip = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value;

export function globalReviewPrompt(input: GlobalReviewPromptInput): string {
  const sections: string[] = [];
  const push = (label: string, text: string) => {
    const block = `## ${label}\n${text}`;
    sections.push(block);
    return block;
  };
  const bible = input.bible
    .filter((item) => item.content.trim())
    .map((item) => `【${item.title}】${clip(item.content, 600)}`)
    .join("\n");
  if (bible) push("故事圣经（节选）", bible);

  const characters = input.entities
    .filter((item) => item.type === "character")
    .map(
      (item) =>
        `- ${item.name}${item.aliases.length ? `（别名：${item.aliases.join("、")}）` : ""}：${clip(item.summary, 120)}${item.status === "inactive" ? "（已停用）" : ""}`,
    )
    .join("\n");
  if (characters) push("人物卡", characters);

  const others = input.entities
    .filter((item) => item.type !== "character")
    .map((item) => `- [${item.type}] ${item.name}：${clip(item.summary, 100)}`)
    .join("\n");
  if (others) push("其他实体（地点/势力/物品/术语）", others);

  const stateLines = new Map<string, string[]>();
  for (const state of input.characterStates) {
    const chapter = input.chapters.find((item) => item.id === state.chapterId);
    const name =
      input.entities.find((item) => item.id === state.characterId)?.name ??
      state.characterId;
    const list = stateLines.get(name) ?? [];
    list.push(
      `第${chapter?.position ?? "?"}章 @${state.location || "?"}｜${clip(state.summary, 80)}｜道具：${state.inventory.join("、") || "无"}｜知识：${state.knowledge.join("、") || "无"}`,
    );
    stateLines.set(name, list);
  }
  const states = [...stateLines.entries()]
    .map(([name, lines]) => `### ${name}\n${lines.join("\n")}`)
    .join("\n");
  if (states) push("人物状态链（按章）", states);

  const timeline = input.timeline
    .slice(-40)
    .map((event) => {
      const chapter = input.chapters.find((item) => item.id === event.chapterId);
      return `- 第${chapter?.position ?? "?"}章（${event.storyTime}）${event.title}：${clip(event.detail, 80)}`;
    })
    .join("\n");
  if (timeline) push("时间线（最近 40 条）", timeline);

  const foreshadow = input.foreshadow
    .map((thread) => {
      const setup = input.chapters.find((item) => item.id === thread.setupChapterId);
      return `- [${thread.status}] ${thread.title}（埋设第${setup?.position ?? "?"}章）：${clip(thread.detail, 80)}`;
    })
    .join("\n");
  if (foreshadow) push("伏笔清单", foreshadow);

  const outline = input.chapters
    .map((item) => `第${item.position}章 ${item.title}：${clip(item.outline, 60)}`)
    .join("\n");
  if (outline) push("章节目录与章纲", outline);

  const recent = input.recentContents
    .map((item) => `### 第${item.position}章 ${item.title}\n${clip(item.content, 1500)}`)
    .join("\n\n");
  if (recent) push("近几章正文（节选）", recent);

  // 按预算从后往前装（正文优先保住，前面的设定先截）。
  let assembled = sections.join("\n\n");
  if (estimateTokens(assembled) > input.inputBudget) {
    while (
      sections.length > 2 &&
      estimateTokens(sections.join("\n\n")) > input.inputBudget
    )
      sections.shift();
    assembled = sections.join("\n\n");
  }

  return `你是长篇小说的一致性审稿编辑。请审查《${input.novelTitle}》（${input.genre}）截至目前的全部正史记忆，找出跨章节的全局矛盾。逐章检查时已经覆盖单章问题，你只报告需要全局视角才能发现的：人物动机/行为前后矛盾、地点或道具流转不合理、时间顺序冲突、人物知道了剧情上不可能知道的事、设定规则违背故事圣经、伏笔被遗忘或前后描述不一致、退场人物再次出场。

${assembled}

输出 JSON（不要输出其他内容）：
{
  "summary": "整体一致性评价，两三句话",
  "issues": [
    {
      "severity": "error|warning|info",
      "category": "character|location|foreshadow|timeline|consistency",
      "message": "问题描述",
      "evidence": "引用具体章节/状态作为证据",
      "suggestion": "具体修复建议",
      "targetKind": "setting|chapter",
      "targetName": "涉及的人物/道具/伏笔名；targetKind 为 chapter 时填章节号数字",
      "chapterPosition": 12
    }
  ],
  "proposals": [
    {
      "action": "update|add",
      "targetType": "character|location|organization|item|term",
      "targetName": "实体名",
      "patch": { "summary": "修正后的摘要" },
      "reason": "为什么这样修"
    }
  ]
}
issues 最多 20 条；没有问题输出空数组。proposals 只在设定卡本身需要修正时给出（最多 10 条），正文问题只出 issues（targetKind=chapter）。`;
}

const globalReviewResponse = z.object({
  summary: z.string().default(""),
  issues: z
    .array(
      z.object({
        severity: z.enum(["error", "warning", "info"]),
        category: z
          .enum(["character", "location", "foreshadow", "timeline", "consistency"])
          .default("consistency"),
        message: z.string().min(1),
        evidence: z.string().default(""),
        suggestion: z.string().default(""),
        targetKind: z.enum(["setting", "chapter"]).default("setting"),
        targetName: z.string().default(""),
        chapterPosition: z.coerce.number().int().positive().optional(),
      }),
    )
    .max(20)
    .default([]),
  proposals: z
    .array(
      z.object({
        action: z.enum(["update", "add"]),
        targetType: z.enum(["character", "location", "organization", "item", "term"]),
        targetName: z.string().min(1),
        patch: z
          .object({
            summary: z.string().optional(),
            profile: z.record(z.string(), z.string()).optional(),
          })
          .default({}),
        reason: z.string().default(""),
      }),
    )
    .max(10)
    .default([]),
});

export interface GlobalReviewOutcome {
  summary: string;
  findings: GlobalFinding[];
  proposals: NewPlanningProposal[];
}

function stableFindingId(prefix: string, parts: string[]): string {
  let hash = 0;
  const source = parts.join("|");
  for (let index = 0; index < source.length; index++) {
    hash = (hash * 31 + source.charCodeAt(index)) | 0;
  }
  return `ai:${prefix}:${(hash >>> 0).toString(36)}`;
}

/** 解析 AI 全局审查响应；raw 必须是 JSON 文本（平衡截取由调用方完成）。 */
export function parseGlobalReview(
  raw: string,
  context: { novelId: string },
): GlobalReviewOutcome {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = globalReviewResponse.parse(JSON.parse(text));
  const now = new Date().toISOString();
  const findings: GlobalFinding[] = [];
  const seenIds = new Set<string>();
  for (const issue of parsed.issues) {
    // id 只由 message 派生：同一问题跨运行保持稳定，“忽略”状态才能延续；
    // 模型对同一问题复述两次时去重，避免持久层主键冲突。
    const id = stableFindingId("issue", [issue.message]);
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    findings.push({
      id,
      novelId: context.novelId,
      source: "ai",
      severity: issue.severity,
      category: issue.category,
      message: issue.message,
      evidence: issue.evidence,
      suggestion: issue.suggestion || undefined,
      targetKind: issue.targetKind,
      targetName: issue.targetName || undefined,
      chapterPosition: issue.chapterPosition,
      status: "open",
      createdAt: now,
    });
  }
  const proposals: NewPlanningProposal[] = parsed.proposals.map((proposal) => ({
    action: proposal.action,
    targetType: proposal.targetType,
    targetName: proposal.targetName,
    patch: proposal.patch,
    reason: proposal.reason || "全局一致性审查建议",
  }));
  return { summary: parsed.summary, findings, proposals };
}

import type { Chapter } from "./novel";
import type { StoryEntity } from "./story-bible";
import type {
  CharacterState,
  ForeshadowThread,
  TimelineEvent,
} from "./continuity";

/**
 * AN-030 故事总览：对已入正史的章节与记忆做纯本地聚合（零 token），
 * 让作者一屏看全人物出场、道具流转、伏笔进度与各章摘要；
 * AN-033 记忆体检：结构化列出可修复的记忆问题（重复状态、同章多状态、
 * 悬空引用、伏笔超期），供总览页一键清理。
 */

export interface StoryOverviewInput {
  chapters: Chapter[];
  entities: StoryEntity[];
  timeline: TimelineEvent[];
  foreshadow: ForeshadowThread[];
  characterStates: CharacterState[];
  /** 伏笔超期阈值（章）；默认 30。 */
  overdueThreshold?: number;
}

export interface CharacterPresence {
  characterId: string;
  name: string;
  status: "active" | "inactive";
  /** 首次/最近出现章节（状态或时间线参与者）。0 = 未关联章节。 */
  firstPosition: number;
  lastPosition: number;
  /** 出现过的章节序号（升序去重）。 */
  activePositions: number[];
  stateCount: number;
  latestSummary: string;
}

export interface ItemFlowEntry {
  item: string;
  /** 持有链：按章节顺序列出（position, holder）；相邻同名持有者合并。 */
  chain: Array<{ position: number; holder: string }>;
}

export interface ForeshadowProgressEntry {
  id: string;
  title: string;
  status: ForeshadowThread["status"];
  setupPosition: number;
  payoffPosition: number | null;
  /** 埋设距最新章节的章数。 */
  age: number;
  overdue: boolean;
}

export interface ChapterDigestEntry {
  position: number;
  title: string;
  status: Chapter["status"];
  wordCount: number;
  timelineCount: number;
  stateCount: number;
  foreshadowPlantedCount: number;
}

export type MemoryIssueKind =
  | "duplicate-state"
  | "multi-state-chapter"
  | "overdue-foreshadow"
  | "dangling-ref";

export interface MemoryIssue {
  kind: MemoryIssueKind;
  severity: "error" | "warning";
  message: string;
  /** duplicate-state：保留第一条、删除其余；其他问题为相关记录 id。 */
  fix?: { keepId: string; dropIds: string[] };
  targetIds: string[];
}

export interface StoryOverview {
  stats: {
    acceptedChapters: number;
    totalChapters: number;
    totalWords: number;
    characterCount: number;
    timelineCount: number;
    foreshadowOpen: number;
    foreshadowOverdue: number;
    stateCount: number;
  };
  characters: CharacterPresence[];
  items: ItemFlowEntry[];
  foreshadow: ForeshadowProgressEntry[];
  chapters: ChapterDigestEntry[];
  issues: MemoryIssue[];
}

const normalizeItem = (value: string) => value.trim();

export function buildStoryOverview(
  input: StoryOverviewInput,
): StoryOverview {
  const threshold = input.overdueThreshold ?? 30;
  const chapters = [...input.chapters].sort((a, b) => a.position - b.position);
  const chapterById = new Map(chapters.map((item) => [item.id, item]));
  const positionOf = (chapterId: string | null): number =>
    (chapterId ? chapterById.get(chapterId)?.position : undefined) ?? 0;
  // 最新进度按已入正史章节计算（与全局校验同规则）。
  const latestPosition = chapters
    .filter((item) => item.status === "accepted")
    .reduce((max, item) => Math.max(max, item.position), 0);
  const entityById = new Map(input.entities.map((item) => [item.id, item]));

  // 人物出场：状态快照 + 时间线参与合并。
  const presence = new Map<
    string,
    { positions: Set<number>; states: CharacterState[] }
  >();
  const record = (characterId: string, position: number) => {
    const entry =
      presence.get(characterId) ?? { positions: new Set<number>(), states: [] };
    if (position) entry.positions.add(position);
    presence.set(characterId, entry);
  };
  for (const state of input.characterStates) {
    record(state.characterId, positionOf(state.chapterId));
    presence.get(state.characterId)!.states.push(state);
  }
  for (const event of input.timeline)
    for (const participantId of event.participantIds)
      record(participantId, positionOf(event.chapterId));
  const characters: CharacterPresence[] = [];
  for (const entity of input.entities) {
    if (entity.type !== "character") continue;
    const entry = presence.get(entity.id);
    const positions = [...(entry?.positions ?? [])].sort((a, b) => a - b);
    const states = [...(entry?.states ?? [])].sort(
      (a, b) => positionOf(a.chapterId) - positionOf(b.chapterId),
    );
    characters.push({
      characterId: entity.id,
      name: entity.name,
      status: entity.status,
      firstPosition: positions[0] ?? 0,
      lastPosition: positions[positions.length - 1] ?? 0,
      activePositions: positions,
      stateCount: states.length,
      latestSummary: states[states.length - 1]?.summary ?? "（还没有状态记录）",
    });
  }
  characters.sort((a, b) => a.firstPosition - b.firstPosition || b.stateCount - a.stateCount);

  // 道具流转：每条状态按章顺序展开 inventory，相邻同持有者合并。
  const itemChains = new Map<string, Array<{ position: number; holder: string }>>();
  for (const [characterId, entry] of presence) {
    const holder =
      entityById.get(characterId)?.name ?? `未知人物(${characterId.slice(0, 4)})`;
    const ordered = [...entry.states].sort(
      (a, b) => positionOf(a.chapterId) - positionOf(b.chapterId),
    );
    for (const state of ordered)
      for (const rawItem of state.inventory) {
        const item = normalizeItem(rawItem);
        if (!item) continue;
        const position = positionOf(state.chapterId);
        const chain = itemChains.get(item) ?? [];
        const last = chain[chain.length - 1];
        if (!last || last.holder !== holder || last.position !== position)
          chain.push({ position: position || latestPosition, holder });
        itemChains.set(item, chain);
      }
  }
  const items: ItemFlowEntry[] = [...itemChains]
    .filter(([, chain]) => chain.length > 1)
    .map(([item, chain]) => ({ item, chain }))
    .sort((a, b) => b.chain.length - a.chain.length);

  // 伏笔进度：埋设章 → 回收章 + 年龄与超期标记。
  const foreshadow: ForeshadowProgressEntry[] = input.foreshadow
    .map((thread) => {
      const setupPosition = positionOf(thread.setupChapterId);
      const payoffPosition = thread.payoffChapterId
        ? positionOf(thread.payoffChapterId)
        : null;
      const age = latestPosition - setupPosition;
      return {
        id: thread.id,
        title: thread.title,
        status: thread.status,
        setupPosition,
        payoffPosition,
        age,
        overdue:
          thread.status !== "resolved" &&
          thread.status !== "abandoned" &&
          setupPosition > 0 &&
          age > threshold,
      };
    })
    .sort((a, b) => b.age - a.age);

  // 各章摘要行。
  const chapters_ = chapters;
  const digest = chapters_.map((chapter) => ({
    position: chapter.position,
    title: chapter.title,
    status: chapter.status,
    wordCount: chapter.wordCount,
    timelineCount: input.timeline.filter(
      (item) => item.chapterId === chapter.id,
    ).length,
    stateCount: input.characterStates.filter(
      (item) => item.chapterId === chapter.id,
    ).length,
    foreshadowPlantedCount: input.foreshadow.filter(
      (item) => item.setupChapterId === chapter.id,
    ).length,
  }));

  // 记忆体检。
  const issues: MemoryIssue[] = [];
  const byCharacterChapter = new Map<string, CharacterState[]>();
  for (const state of input.characterStates) {
    const key = `${state.characterId}:${state.chapterId ?? "none"}`;
    const list = byCharacterChapter.get(key) ?? [];
    list.push(state);
    byCharacterChapter.set(key, list);
  }
  for (const [key, list] of byCharacterChapter) {
    if (list.length < 2) continue;
    const [characterId] = key.split(":");
    const name = entityById.get(characterId)?.name ?? "未知人物";
    const identical = new Map<string, CharacterState[]>();
    for (const state of list) {
      const group = identical.get(state.summary) ?? [];
      group.push(state);
      identical.set(state.summary, group);
    }
    for (const [, group] of identical)
      if (group.length > 1)
        issues.push({
          kind: "duplicate-state",
          severity: "warning",
          message: `「${name}」同一章有 ${group.length} 条完全相同的状态记录，可保留一条删除其余。`,
          fix: { keepId: group[0].id, dropIds: group.slice(1).map((item) => item.id) },
          targetIds: group.map((item) => item.id),
        });
    const distinct = new Set(list.map((item) => item.summary));
    if (distinct.size > 1)
      issues.push({
        kind: "multi-state-chapter",
        severity: "warning",
        message: `「${name}」同一章有 ${list.length} 条内容不同的状态记录（含 ${distinct.size} 种描述），请人工确认是否矛盾（如年龄/身份前后不一）。`,
        targetIds: list.map((item) => item.id),
      });
  }
  for (const thread of foreshadow)
    if (thread.overdue)
      issues.push({
        kind: "overdue-foreshadow",
        severity: "warning",
        message: `伏笔「${thread.title}」埋设于第 ${thread.setupPosition} 章，已 ${thread.age} 章未回收（阈值 ${threshold}）。`,
        targetIds: [thread.id],
      });
  for (const state of input.characterStates)
    if (!entityById.has(state.characterId))
      issues.push({
        kind: "dangling-ref",
        severity: "error",
        message: "一条人物状态指向不存在的人物实体（悬空引用），需删除或补建实体。",
        targetIds: [state.id],
      });

  const accepted = chapters.filter((item) => item.status === "accepted");
  return {
    stats: {
      acceptedChapters: accepted.length,
      totalChapters: chapters.length,
      totalWords: accepted.reduce((sum, item) => sum + item.wordCount, 0),
      characterCount: characters.length,
      timelineCount: input.timeline.length,
      foreshadowOpen: input.foreshadow.filter(
        (item) => item.status !== "resolved" && item.status !== "abandoned",
      ).length,
      foreshadowOverdue: foreshadow.filter((item) => item.overdue).length,
      stateCount: input.characterStates.length,
    },
    characters,
    items,
    foreshadow,
    chapters: digest,
    issues,
  };
}

import type { Chapter } from "./novel";
import type { PlanningCycle } from "./planning-cycle";
import type {
  CharacterState,
  ForeshadowThread,
  TimelineEvent,
} from "./continuity";
import type { StoryEntity } from "./story-bible";

/**
 * AN-035 全自动巡航：跨周期的无人值守连跑。
 *
 * 两段式模型的第二段——地基期作者用现有逐项流程精控；信任建立后开启
 * 巡航，循环「周期规划（提案自动处理）→ 建批次 → 正文连写与正史建议
 * 自动接受（复用 AN-026/028）→ 封存 → 下一周期」直到目标章数。
 * 停止即留痕：报错 / 批次预算耗尽 / 质量门触发都转为 paused 状态并
 * 记录原因，作者处理后一键续跑；重启经持久化自动重挂载。
 */

/** 巡航开关与状态（渲染层持久化；进度本身全部在库里）。 */
export interface CruiseState {
  enabled: boolean;
  /** active = 循环推进中；paused = 停在原地等待作者（原因见 message）。 */
  status: "active" | "paused";
  /** 巡航到第几章收工。 */
  targetChapter: number;
  message: string;
  updatedAt: string;
}

const clip = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value;

/**
 * 从最新正史记忆确定性起草周期「实际结束状态」（零 token）。
 * 它是下一周期规划的开场正史输入；作者可随时在周期页改写。
 */
export function draftClosingState(input: {
  cycle: PlanningCycle;
  chapters: Chapter[];
  entities: StoryEntity[];
  timeline: TimelineEvent[];
  characterStates: CharacterState[];
  foreshadow: ForeshadowThread[];
}): string {
  const inRange = (chapterId: string | null) =>
    input.chapters.some((item) => item.id === chapterId);
  const entityById = new Map(input.entities.map((item) => [item.id, item]));

  // 1) 时间线尾部：本周期最后 3 条事件。
  const tailEvents = input.timeline
    .filter((item) => !item.chapterId || inRange(item.chapterId))
    .slice(-3)
    .map((item) => clip(`${item.title}：${item.detail}`, 60));

  // 2) 核心人物收尾状态：状态记录最多的前 3 名人物的最新一条。
  const countByCharacter = new Map<string, number>();
  const latestByCharacter = new Map<string, CharacterState>();
  for (const state of input.characterStates) {
    countByCharacter.set(
      state.characterId,
      (countByCharacter.get(state.characterId) ?? 0) + 1,
    );
    const current = latestByCharacter.get(state.characterId);
    if (!current || state.updatedAt > current.updatedAt)
      latestByCharacter.set(state.characterId, state);
  }
  const headline = [...countByCharacter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([characterId]) => {
      const name = entityById.get(characterId)?.name ?? "未知人物";
      const latest = latestByCharacter.get(characterId);
      return clip(`${name}：${latest?.summary ?? "状态未知"}`, 70);
    });

  // 3) 未回收伏笔：下一周期应优先安排回收的钩子。
  const openThreads = input.foreshadow.filter(
    (item) => item.status !== "resolved" && item.status !== "abandoned",
  );
  const hooks = openThreads
    .slice(0, 5)
    .map((item) => clip(item.title, 20))
    .join("、");

  const parts = [
    input.cycle.endChapter > 0
      ? `截至第 ${input.cycle.endChapter} 章：`
      : "",
    tailEvents.length ? `关键事件：${tailEvents.join("；")}。` : "",
    headline.length ? `人物收尾：${headline.join("；")}。` : "",
    openThreads.length
      ? `未回收伏笔 ${openThreads.length} 条（${hooks}）待后续回收。`
      : "伏笔已全部回收或废弃。",
  ].filter(Boolean);
  return clip(parts.join(""), 480);
}

/**
 * 计算下一个巡航周期范围；返回 null 表示已到达目标章数，巡航收工。
 * 范围不超过目标章数与章节目录长度。
 */
export function nextCycleRange(input: {
  sealedEndChapter: number;
  targetChapter: number;
  cycleSize: number;
  totalChapters: number;
}): { startChapter: number; endChapter: number } | null {
  const startChapter = input.sealedEndChapter + 1;
  if (startChapter > input.targetChapter) return null;
  const ceiling = Math.min(input.targetChapter, input.totalChapters);
  return {
    startChapter,
    endChapter: Math.min(
      startChapter + input.cycleSize - 1,
      Math.max(ceiling, startChapter),
    ),
  };
}

/** 巡航周期使用的生成策略：沿用上一周期策略，仅替换章节范围。 */
export function cruisePolicy<
  T extends { startChapter: number; endChapter: number },
>(previous: T, range: { startChapter: number; endChapter: number }): T {
  return { ...previous, ...range };
}

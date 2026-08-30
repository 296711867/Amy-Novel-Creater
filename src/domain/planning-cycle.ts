export type PlanningCycleStatus =
  | "planning"
  | "proposal_review"
  | "plan_review"
  | "ready"
  | "generating"
  | "memory_review"
  | "completed"
  | "failed"
  | "needs_revision"
  | "superseded";

export interface ClosingStateInput {
  characterStates: Array<{
    characterId: string;
    chapterId: string | null;
    summary: string;
    location: string;
    goals: string[];
    inventory: string[];
    skills: string[];
  }>;
  characters: Array<{ id: string; name: string }>;
  chapters: Array<{ id: string; position: number }>;
  foreshadow: Array<{ title: string; status: string }>;
  range: { startChapter: number; endChapter: number };
}

export interface PlanningCycle {
  id: string;
  novelId: string;
  startChapter: number;
  endChapter: number;
  status: PlanningCycleStatus;
  goal: string;
  openingState: string;
  climax: string;
  expectedClosingState: string;
  actualClosingState: string;
  createdAt: string;
  updatedAt: string;
}

export type SavePlanningCycleInput = Omit<
  PlanningCycle,
  "id" | "createdAt" | "updatedAt"
> & { id?: string };

export function planningCycleRange(
  positions: Array<{ position: number; title: string; outline: string }>,
  targetChapters: number,
  size = 10,
): { startChapter: number; endChapter: number } | null {
  const first = positions
    .slice()
    .sort((a, b) => a.position - b.position)
    .find(
      (item) =>
        !item.outline.trim() || /^第\s*\d+\s*章$/.test(item.title.trim()),
    );
  if (!first) return null;
  return {
    startChapter: first.position,
    endChapter: Math.min(targetChapters, first.position + size - 1),
  };
}

/**
 * 从已回写记忆拼装“实际结束状态”草稿：每名角色取批次内最新状态，
 * 加上未决伏笔。确定性组装、不调模型；作者修改后随封存保存。
 */
export function composeClosingState(input: ClosingStateInput): string {
  const positionOf = (chapterId: string | null) =>
    chapterId
      ? (input.chapters.find((item) => item.id === chapterId)?.position ?? 0)
      : 0;
  const inRange = (position: number) =>
    position >= input.range.startChapter &&
    position <= input.range.endChapter;
  const latest = new Map<string, ClosingStateInput["characterStates"][number]>();
  for (const state of input.characterStates) {
    const position = positionOf(state.chapterId);
    if (!inRange(position)) continue;
    const known = latest.get(state.characterId);
    if (!known || position >= positionOf(known.chapterId))
      latest.set(state.characterId, state);
  }
  const lines = [...latest.entries()]
    .sort(
      (a, b) => positionOf(a[1].chapterId) - positionOf(b[1].chapterId),
    )
    .map(([characterId, state]) => {
      const character = input.characters.find(
        (item) => item.id === characterId,
      );
      if (!character) return "";
      return `${character.name}（第${positionOf(state.chapterId) || "?"}章）：位于${
        state.location || "未知"
      }；目标：${state.goals.join("、") || "无"}；持有：${
        state.inventory.join("、") || "无"
      }；技能：${state.skills.join("、") || "无"}`;
    })
    .filter(Boolean);
  const openThreads = input.foreshadow
    .filter((item) => !["resolved", "abandoned"].includes(item.status))
    .map((item) => `${item.title}（${item.status}）`);
  return [
    `第 ${input.range.startChapter}–${input.range.endChapter} 章实际结束状态：`,
    ...lines,
    openThreads.length
      ? `未决伏笔：${openThreads.join("；")}`
      : "无未决伏笔",
  ]
    .filter(Boolean)
    .join("\n");
}

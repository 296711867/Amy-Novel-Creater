export type NovelStatus =
  "planning" | "writing" | "paused" | "completed" | "archived";
export type ChapterStatus =
  | "planned"
  | "generating"
  | "candidate"
  | "draft"
  | "accepted"
  | "needs_review";

export interface Novel {
  id: string;
  title: string;
  genre: string;
  premise: string;
  targetWords: number;
  targetChapters: number;
  chapterWords: number;
  /** 滚动规划每批章数；上限受规划 JSON 稳定性约束（实测 10 章约 3.5k 输出 token）。 */
  cycleSize: number;
  status: NovelStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Chapter {
  id: string;
  novelId: string;
  position: number;
  volumeId: string | null;
  title: string;
  outline: string;
  status: ChapterStatus;
  targetWords: number;
  content: string;
  wordCount: number;
  updatedAt: string;
}

export interface ChapterVersion {
  id: string;
  chapterId: string;
  versionNo: number;
  origin: "manual" | "autosave" | "ai" | "accepted";
  content: string;
  wordCount: number;
  createdAt: string;
}

export interface SaveChapterInput {
  chapterId: string;
  title: string;
  outline: string;
  content: string;
  createSnapshot?: boolean;
  origin?: ChapterVersion["origin"];
}

export interface CreateChapterInput {
  novelId: string;
  volumeId: string | null;
  title?: string;
  targetWords: number;
}

export interface UpdateChapterPlanInput {
  chapterId: string;
  volumeId: string | null;
  title: string;
  outline: string;
  targetWords: number;
}

export interface CreateNovelInput {
  title: string;
  genre: string;
  premise: string;
  targetChapters: number;
  chapterWords: number;
  cycleSize?: number;
}

/** 滚动批次大小边界：过小则周期开销占比高，过大则规划 JSON 失败率上升。 */
export const CYCLE_SIZE_MIN = 5;
export const CYCLE_SIZE_MAX = 15;
export const CYCLE_SIZE_DEFAULT = 10;

export function normalizeCycleSize(value: number | null | undefined): number {
  const parsed = Number(value);
  // 空值、非数与非正数视为未设置，回退默认，而不是钳到下限。
  if (value === null || value === undefined || !Number.isFinite(parsed) || parsed <= 0)
    return CYCLE_SIZE_DEFAULT;
  return Math.min(CYCLE_SIZE_MAX, Math.max(CYCLE_SIZE_MIN, Math.round(parsed)));
}

export function calculateTargetWords(
  input: Pick<CreateNovelInput, "targetChapters" | "chapterWords">,
): number {
  return input.targetChapters * input.chapterWords;
}

export function buildInitialChapters(
  novelId: string,
  count: number,
  chapterWords: number,
): Chapter[] {
  const now = new Date().toISOString();
  return Array.from({ length: count }, (_, index) => ({
    id: `${novelId}:chapter:${index + 1}`,
    novelId,
    position: index + 1,
    volumeId: null,
    title: `第 ${index + 1} 章`,
    outline: "",
    status: "planned",
    targetWords: chapterWords,
    content: "",
    wordCount: 0,
    updatedAt: now,
  }));
}

export function countCjkWords(content: string): number {
  return content.replace(/\s+/g, "").length;
}

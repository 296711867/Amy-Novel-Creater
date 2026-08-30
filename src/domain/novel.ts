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

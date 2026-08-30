export type BatchStatus =
  | "draft"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
export type GenerationJobStatus =
  | "queued"
  | "building_context"
  | "generating"
  | "candidate_ready"
  | "completed"
  | "waiting_retry"
  | "failed"
  | "paused";
export interface GenerationBatch {
  id: string;
  novelId: string;
  status: BatchStatus;
  policy: GenerationPolicy;
  outputTokensUsed: number;
  createdAt: string;
  updatedAt: string;
}
export interface GenerationJob {
  id: string;
  batchId: string;
  chapterId: string;
  position: number;
  status: GenerationJobStatus;
  attempt: number;
  candidateId: string | null;
  inputTokens: number;
  outputTokens: number;
  error: string;
  updatedAt: string;
}
export const JOB_TRANSITIONS: Record<
  GenerationJobStatus,
  GenerationJobStatus[]
> = {
  queued: ["building_context", "paused"],
  building_context: ["generating", "waiting_retry", "failed", "paused"],
  generating: ["candidate_ready", "waiting_retry", "failed", "paused"],
  candidate_ready: ["completed", "queued"],
  completed: [],
  waiting_retry: ["queued", "failed", "paused"],
  failed: ["queued"],
  paused: ["queued"],
};
export function canMoveJob(
  from: GenerationJobStatus,
  to: GenerationJobStatus,
): boolean {
  return from === to || JOB_TRANSITIONS[from].includes(to);
}
export function nextRunnableJob(
  jobs: GenerationJob[],
): GenerationJob | undefined {
  return [...jobs]
    .sort((a, b) => a.position - b.position)
    .find(
      (item) => item.status === "queued" || item.status === "waiting_retry",
    );
}
export function batchProgress(jobs: GenerationJob[]): number {
  return jobs.length
    ? Math.round(
        (jobs.filter(
          (item) =>
            item.status === "completed" || item.status === "candidate_ready",
        ).length /
          jobs.length) *
          100,
      )
    : 0;
}

export interface GenerationPolicy {
  startChapter: number;
  endChapter: number;
  chapterWords: number;
  continuityCheck: boolean;
  maxRetries: number;
  approvalMode: "candidate" | "chapter_review";
  outputTokenBudget: number;
  /** 并发生成的章节数（1–3）。候选稿模式下章节彼此独立，可安全并行。 */
  concurrency?: number;
}

export interface GenerationEstimate {
  chapterCount: number;
  targetWords: number;
  estimatedOutputTokens: number;
  estimatedContextTokens: number;
}

export function estimateGeneration(
  policy: GenerationPolicy,
): GenerationEstimate {
  const chapterCount = Math.max(0, policy.endChapter - policy.startChapter + 1);
  const targetWords = chapterCount * policy.chapterWords;
  return {
    chapterCount,
    targetWords,
    estimatedOutputTokens: Math.ceil(targetWords * 1.35),
    estimatedContextTokens: chapterCount * 12000,
  };
}

export function validateChapterRange(
  policy: GenerationPolicy,
  totalChapters: number,
): string | null {
  if (policy.startChapter < 1) return "起始章节不能小于 1";
  if (policy.endChapter < policy.startChapter)
    return "结束章节不能早于起始章节";
  if (policy.endChapter > totalChapters) return "结束章节超出当前目录";
  if (policy.chapterWords < 500 || policy.chapterWords > 20000)
    return "单章字数应在 500–20000 之间";
  return null;
}

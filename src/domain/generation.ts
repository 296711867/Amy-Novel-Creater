export type BatchStatus =
  | "draft"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";
export interface GenerationBatch {
  id: string;
  novelId: string;
  status: BatchStatus;
  policy: GenerationPolicy;
  outputTokensUsed: number;
  /** 审批制下暂停等待作者审核上一章候选稿时为 true。 */
  awaitingReview: boolean;
  createdAt: string;
  updatedAt: string;
}
export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = {
  draft: "草稿",
  queued: "排队中",
  running: "生成中",
  paused: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
export type GenerationJobStatus =
  | "queued"
  | "building_context"
  | "generating"
  | "candidate_ready"
  | "completed"
  | "waiting_retry"
  | "failed"
  | "paused";
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
export const JOB_STATUS_LABELS: Record<GenerationJobStatus, string> = {
  queued: "排队中",
  building_context: "构建上下文",
  generating: "正在写作",
  candidate_ready: "待审阅",
  completed: "已入正史",
  waiting_retry: "等待重试",
  failed: "失败",
  paused: "已暂停",
};
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
  /** 兼容旧批次配置；长篇候选链启用后执行器固定串行。 */
  concurrency?: number;
  /** 正文生成是否启用 GLM 深度思考（默认关闭：更快，且 max_tokens 全部留给正文）。 */
  deepThinking?: boolean;
  /** 可选文风模板；空值表示由模型按作品设定自由发挥。 */
  styleTemplateId?: string;
  /**
   * 审批制（默认开启）：每章候选稿生成后批次暂停，等待作者接受候选稿
   * 并处理正史建议，才继续生成下一章。设为 false 恢复旧的连续生成。
   */
  approvalGate?: boolean;
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

export function retryDelayMs(
  attempt: number,
  retryAfterMs?: number | null,
): number {
  if (retryAfterMs !== null && retryAfterMs !== undefined)
    return Math.min(120_000, Math.max(0, retryAfterMs));
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

export function waitForRetry(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve(true);
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** 审批制默认开启：旧批次策略里没有该字段时同样按单章审批执行。 */
export function approvalGateEnabled(policy: GenerationPolicy): boolean {
  return policy.approvalGate !== false;
}

export function pendingFactProposalCount(
  proposals: Array<{ status: string }>,
): number {
  return proposals.filter((item) => item.status === "proposed").length;
}

export function candidateReviewComplete(
  candidateStatus: string,
  proposals: Array<{ status: string }>,
): boolean {
  return (
    candidateStatus === "accepted" && pendingFactProposalCount(proposals) === 0
  );
}

/**
 * 生成过程事件：给作者看的中文阶段摘要，同时保留 harness 需要的
 * 结构化字段（模型、尝试次数、token、耗时、检查结果）。不含 API Key、
 * 完整提示词或整章原文。
 */
export type GenerationEventLevel = "info" | "success" | "warning" | "error";
export type GenerationEventStage =
  | "batch_started"
  | "context_build"
  | "state_loaded"
  | "generating"
  | "candidate_saved"
  | "quality_check"
  | "fact_extraction"
  | "chapter_review"
  | "awaiting_review"
  | "chapter_accepted"
  | "retry"
  | "failed"
  | "batch_paused"
  | "batch_completed"
  | "plan_started"
  | "plan_received"
  | "plan_applied";
export interface GenerationEvent {
  id: string;
  batchId: string;
  novelId: string;
  chapterId: string | null;
  stage: GenerationEventStage;
  level: GenerationEventLevel;
  message: string;
  data: Record<string, unknown>;
  createdAt: string;
}
export type NewGenerationEvent = Omit<GenerationEvent, "id" | "createdAt">;

export function generationEventToJsonl(events: GenerationEvent[]): string {
  return events
    .map((event) =>
      JSON.stringify({
        ts: event.createdAt,
        runId: event.batchId,
        novelId: event.novelId,
        chapterId: event.chapterId,
        stage: event.stage,
        level: event.level,
        message: event.message,
        ...event.data,
      }),
    )
    .join("\n");
}

/**
 * “可能受影响”级联：前文章节在候选稿生成之后被修改过，且修改不是
 * “接受候选稿原样回写”（那种情况内容与候选一致，不影响后文），
 * 则后续章节的候选稿基于旧前文，应重新生成。
 */
export function staleEarlierChapterTitle(
  candidate: { chapterId: string; createdAt: string },
  chapters: Array<{
    id: string;
    position: number;
    title: string;
    content: string;
    updatedAt: string;
  }>,
  candidatesOfNovel: Array<{
    chapterId: string;
    createdAt: string;
    content: string;
  }>,
): string | null {
  const own = chapters.find((item) => item.id === candidate.chapterId);
  if (!own) return null;
  for (const chapter of chapters) {
    if (chapter.position >= own.position) continue;
    if (!chapter.content.trim()) continue;
    if (chapter.updatedAt <= candidate.createdAt) continue;
    const referenced = candidatesOfNovel
      .filter((item) => item.chapterId === chapter.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (referenced && referenced.content.trim() === chapter.content.trim())
      continue;
    return chapter.title;
  }
  return null;
}

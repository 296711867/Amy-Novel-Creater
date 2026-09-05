export type CandidateStatus = "candidate" | "accepted" | "rejected";
export const CANDIDATE_STATUS_LABELS: Record<CandidateStatus, string> = {
  candidate: "候选稿",
  accepted: "已入正史",
  rejected: "已拒绝",
};
export interface ChapterCandidate {
  id: string;
  novelId: string;
  chapterId: string;
  profileId: string;
  contextHash: string;
  content: string;
  wordCount: number;
  status: CandidateStatus;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  createdAt: string;
  updatedAt: string;
}
export interface GenerateChapterInput {
  requestId: string;
  novelId: string;
  chapterId: string;
  profileId: string;
  contextText: string;
  contextHash: string;
  maxOutputTokens: number;
  temperature: number;
  styleTemplateId?: string;
}
export interface AnalyzeChapterCandidateInput {
  novelId: string;
  chapterId: string;
  candidateId: string;
  profileId: string;
  content: string;
  chapterReview: boolean;
  continuityCheck: boolean;
  failClosed: boolean;
  minimumWordRatio: number;
}
export interface GenerationProgress {
  requestId: string;
  type: "started" | "delta" | "usage";
  delta?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
}
export interface ContinueChapterInput {
  requestId: string;
  novelId: string;
  chapterId: string;
  profileId: string;
  contextHash: string;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
}
export interface ContinueChapterResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}
/**
 * 字数不足时的续写提示：正文被 max_tokens 截断是长章最常见的失败模式，
 * 用同一上下文补一次尾部，而不是整章重写（省 token 且保住已写内容）。
 */
export function continuationPrompt(
  contextText: string,
  partial: string,
  targetWords: number,
): string {
  return `${contextText}\n\n【已写正文（前文，勿重复）】\n${partial}\n\n【续写要求】上面的正文还没写完。从中断处无缝继续：不要重复已有句子，不要写章节标题、总结或结束语，继续推进本章事件与冲突，直到接近本章目标 ${targetWords} 字。只输出续写部分的正文。`;
}
/** 拼接补写结果时去掉模型重复复述的尾部重叠。 */
export function mergeContinuation(existing: string, appendix: string): string {
  const tail = existing.slice(-120),
    overlap = Math.max(
      0,
      ...Array.from({ length: Math.min(60, appendix.length) }, (_, i) =>
        appendix.startsWith(tail.slice(-i)) ? i : 0,
      ),
    );
  return `${existing}\n${appendix.slice(overlap)}`.trim();
}

export type CandidateStatus = "candidate" | "accepted" | "rejected";
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
}
export interface GenerationProgress {
  requestId: string;
  type: "started" | "delta" | "usage";
  delta?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
}

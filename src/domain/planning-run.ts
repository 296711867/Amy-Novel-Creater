import type { PlanPhase } from "./planning";

export type PlanningRunStatus = "running" | "received" | "completed" | "failed";

export interface PlanningRun {
  id: string;
  novelId: string;
  phase: PlanPhase;
  startChapter: number | null;
  endChapter: number | null;
  profileId: string;
  provider: string;
  model: string;
  promptHash: string;
  rawResponse: string;
  repairResponse: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  status: PlanningRunStatus;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface StartPlanningRunInput {
  novelId: string;
  phase: PlanPhase;
  startChapter?: number | null;
  endChapter?: number | null;
  profileId: string;
  provider: string;
  model: string;
  prompt: string;
}

export interface PlanningRunResponse {
  rawResponse: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface PlanningRunRepairResponse {
  repairResponse: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export function planningPromptHash(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

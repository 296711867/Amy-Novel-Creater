export type UsageMeasurement = "provider" | "estimated";
export interface UsageRecord {
  id: string;
  novelId: string;
  chapterId: string | null;
  operation:
    | "context_build"
    | "generation"
    | "continuity_check"
    | "chapter_review"
    | "planning"
    | "global_review";
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  cost: number | null;
  measurement: UsageMeasurement;
  createdAt: string;
}
export interface SaveUsageInput extends Omit<UsageRecord, "id" | "createdAt"> {}
export interface UsageSummary {
  actualInputTokens: number;
  actualOutputTokens: number;
  actualCachedTokens: number;
  estimatedTokens: number;
  cost: number;
  actualRuns: number;
  estimates: number;
}
export function summarizeUsage(records: UsageRecord[]): UsageSummary {
  return records.reduce(
    (sum, item) => {
      if (item.measurement === "provider") {
        sum.actualInputTokens += item.inputTokens;
        sum.actualOutputTokens += item.outputTokens;
        sum.actualCachedTokens += item.cachedTokens;
        sum.actualRuns++;
      } else {
        sum.estimatedTokens += item.inputTokens + item.outputTokens;
        sum.estimates++;
      }
      sum.cost += item.cost ?? 0;
      return sum;
    },
    {
      actualInputTokens: 0,
      actualOutputTokens: 0,
      actualCachedTokens: 0,
      estimatedTokens: 0,
      cost: 0,
      actualRuns: 0,
      estimates: 0,
    },
  );
}

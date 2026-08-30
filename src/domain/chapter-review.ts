import { z } from "zod";
import { getTemplate, renderTemplate } from "./prompt-templates";
import type { PromptTemplateOverrides } from "./prompt-templates";
import type { ContinuityFinding } from "./quality-check";
const reviewResponse = z.object({
  issues: z
    .array(
      z.object({
        severity: z.enum(["error", "warning", "info"]),
        message: z.string().min(1),
        evidence: z.string().default(""),
      }),
    )
    .max(50),
});
export function chapterReviewPrompt(
  outline: string,
  content: string,
  overrides?: PromptTemplateOverrides,
): string {
  return renderTemplate(getTemplate("chapter_review", overrides), {
    outline,
    content,
  }).text;
}
export function parseChapterReview(raw: string): ContinuityFinding[] {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return reviewResponse.parse(JSON.parse(text)).issues.map((issue, index) => ({
    id: `review:${index}`,
    severity: issue.severity,
    category: "consistency" as const,
    message: issue.message,
    evidence: issue.evidence,
  }));
}

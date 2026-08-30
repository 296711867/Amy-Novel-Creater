import { z } from "zod";
import type { FactProposalKind } from "./quality-check";
import type { FactProposal } from "./quality-check";
import { getTemplate, renderTemplate } from "./prompt-templates";
import type { PromptTemplateOverrides } from "./prompt-templates";
const proposal = z.object({
  kind: z.enum(["timeline", "character_state", "foreshadow"]),
  title: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});
const response = z.object({ proposals: z.array(proposal).max(50) });
export type ExtractedProposal = {
  kind: FactProposalKind;
  title: string;
  payload: Record<string, unknown>;
};
export function factExtractionPrompt(
  content: string,
  overrides?: PromptTemplateOverrides,
): string {
  return renderTemplate(getTemplate("fact_extraction", overrides), {
    content,
  }).text;
}
export function parseFactExtraction(raw: string): ExtractedProposal[] {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  return response.parse(JSON.parse(text)).proposals;
}

const timelinePayload = z.object({
  storyTime: z.string().min(1),
  detail: z.string().min(1),
  participants: z.array(z.string()).default([]),
});
const characterPayload = z.object({
  characterName: z.string().min(1),
  summary: z.string().min(1),
  location: z.string().default(""),
  physical: z.string().default(""),
  emotional: z.string().default(""),
  knowledge: z.array(z.string()).default([]),
  goals: z.array(z.string()).default([]),
  inventory: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
});
const foreshadowPayload = z.object({
  detail: z.string().min(1),
  status: z
    .enum(["planned", "planted", "developing", "resolved", "abandoned"])
    .default("planted"),
});
export function parseProposalPayload(proposal: FactProposal) {
  if (proposal.kind === "timeline")
    return {
      kind: proposal.kind,
      payload: timelinePayload.parse(proposal.payload),
    } as const;
  if (proposal.kind === "character_state")
    return {
      kind: proposal.kind,
      payload: characterPayload.parse(proposal.payload),
    } as const;
  return {
    kind: proposal.kind,
    payload: foreshadowPayload.parse(proposal.payload),
  } as const;
}

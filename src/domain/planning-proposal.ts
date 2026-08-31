import type { StoryEntityType } from "./story-bible";

export type PlanningProposalStatus = "pending" | "accepted" | "rejected";

export interface PlanningProposalPatch {
  summary?: string;
  aliases?: string[];
  profile?: Record<string, string>;
}

export interface PlanningProposal {
  id: string;
  novelId: string;
  cycleId: string;
  startChapter: number;
  endChapter: number;
  action: "add" | "update" | "merge";
  targetType: StoryEntityType;
  targetRef?: string;
  targetName: string;
  patch: PlanningProposalPatch;
  reason: string;
  status: PlanningProposalStatus;
  createdAt: string;
  updatedAt: string;
}

export type NewPlanningProposal = Pick<
  PlanningProposal,
  "action" | "targetType" | "targetRef" | "targetName" | "patch" | "reason"
>;

export function planningProposalIdentity(
  proposal: NewPlanningProposal,
): string {
  const target = proposal.targetRef?.trim().toLowerCase() ||
    proposal.targetName.trim().toLowerCase();
  if (proposal.action === "add")
    return `add|${proposal.targetType}|${proposal.targetName.trim().toLowerCase()}`;
  return `${proposal.action}|${proposal.targetType}|${target}|${stablePatch(
    proposal.patch,
  )}`;
}

function stablePatch(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stablePatch).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${key}:${stablePatch(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

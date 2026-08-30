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
  action: "add" | "update";
  targetType: StoryEntityType;
  targetName: string;
  patch: PlanningProposalPatch;
  reason: string;
  status: PlanningProposalStatus;
  createdAt: string;
  updatedAt: string;
}

export type NewPlanningProposal = Pick<
  PlanningProposal,
  "action" | "targetType" | "targetName" | "patch" | "reason"
>;

import { describe, expect, it } from "vitest";
import { reviewPlanningProposal } from "@application/review-planning-proposal";
import type { PlanningProposal } from "@domain/planning-proposal";
import type { StoryEntity } from "@domain/story-bible";

describe("planning proposal review", () => {
  it("does not change locked canon", async () => {
    const proposal: PlanningProposal = {
      id: "p1", novelId: "n1", cycleId: "c1", startChapter: 1, endChapter: 10,
      action: "update", targetType: "character", targetName: "林舟",
      patch: { summary: "被改写" }, reason: "剧情需要", status: "pending",
      createdAt: "t", updatedAt: "t",
    };
    const entity: StoryEntity = {
      id: "e1", novelId: "n1", type: "character", name: "林舟",
      summary: "原设定", aliases: [], profile: { locked: "true" },
      status: "active", createdAt: "t", updatedAt: "t",
    };
    await expect(
      reviewPlanningProposal(
        {
          listPlanningProposals: async () => [proposal],
          updatePlanningProposalStatus: async () => proposal,
          listStoryEntities: async () => [entity],
          saveStoryEntity: async () => entity,
        },
        "n1",
        "p1",
        "accepted",
      ),
    ).rejects.toThrow("锁定设定");
  });
});

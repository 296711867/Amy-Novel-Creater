import { describe, expect, it, vi } from "vitest";
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
  it("merges a qualified name into the referenced entity only after approval", async () => {
    const proposal: PlanningProposal = {
        id: "p2", novelId: "n1", cycleId: "entity-merge",
        startChapter: 0, endChapter: 0, action: "merge",
        targetType: "character", targetRef: "E-ABC12345", targetName: "崔衡",
        patch: { aliases: ["崔衡"], profile: { tier: "support" } },
        reason: "疑似同一人", status: "pending", createdAt: "t", updatedAt: "t",
      },
      entity: StoryEntity = {
        id: "abc12345-long", novelId: "n1", type: "character",
        name: "守灯人旧部首脑·崔衡", summary: "原设定", aliases: [],
        profile: {}, status: "active", createdAt: "t", updatedAt: "t",
      },
      save = vi.fn(async (input) => ({ ...entity, ...input }));
    await reviewPlanningProposal(
      {
        listPlanningProposals: async () => [proposal],
        updatePlanningProposalStatus: async (_id, status) => ({
          ...proposal,
          status,
        }),
        listStoryEntities: async () => [entity],
        saveStoryEntity: save,
      },
      "n1",
      proposal.id,
      "accepted",
    );
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: entity.id,
        name: entity.name,
        aliases: ["崔衡"],
      }),
    );
  });
});

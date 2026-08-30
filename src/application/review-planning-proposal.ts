import type {
  PlanningProposal,
  PlanningProposalStatus,
} from "@domain/planning-proposal";
import type {
  SaveStoryEntityInput,
  StoryEntity,
} from "@domain/story-bible";

export interface PlanningProposalReviewStore {
  listPlanningProposals(novelId: string): Promise<PlanningProposal[]>;
  updatePlanningProposalStatus(
    id: string,
    status: PlanningProposalStatus,
  ): Promise<PlanningProposal>;
  listStoryEntities(novelId: string): Promise<StoryEntity[]>;
  saveStoryEntity(input: SaveStoryEntityInput): Promise<StoryEntity>;
}

export async function reviewPlanningProposal(
  store: PlanningProposalReviewStore,
  novelId: string,
  proposalId: string,
  status: Exclude<PlanningProposalStatus, "pending">,
): Promise<PlanningProposal> {
  const proposal = (await store.listPlanningProposals(novelId)).find(
    (item) => item.id === proposalId,
  );
  if (!proposal) throw new Error("策划提案不存在");
  if (status === "accepted") {
    const entities = await store.listStoryEntities(novelId),
      existing = entities.find(
        (item) =>
          item.type === proposal.targetType && item.name === proposal.targetName,
      );
    if (proposal.action === "update" && !existing)
      throw new Error(`找不到要更新的设定“${proposal.targetName}”`);
    if (existing?.profile.locked === "true")
      throw new Error(`“${proposal.targetName}”是锁定设定，不能由策划提案修改`);
    const lockedFields = new Set(
      (existing?.profile.lockedFields ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    );
    const touchedLocked = Object.keys(proposal.patch.profile ?? {}).find((key) =>
      lockedFields.has(key),
    );
    if (touchedLocked)
      throw new Error(`字段“${touchedLocked}”已锁定，不能由策划提案修改`);
    await store.saveStoryEntity({
      id: existing?.id,
      novelId,
      type: proposal.targetType,
      name: proposal.targetName,
      summary: proposal.patch.summary ?? existing?.summary ?? proposal.reason,
      aliases: proposal.patch.aliases ?? existing?.aliases ?? [],
      profile: { ...(existing?.profile ?? {}), ...(proposal.patch.profile ?? {}) },
    });
  }
  return store.updatePlanningProposalStatus(proposalId, status);
}

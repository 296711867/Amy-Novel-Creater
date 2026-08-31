import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import type {
  NewPlanningProposal,
  PlanningProposal,
  PlanningProposalStatus,
} from "@domain/planning-proposal";
import { planningProposalIdentity } from "@domain/planning-proposal";
import { parseJson, type DbRow } from "./shared";

function fromRow(row: DbRow): PlanningProposal {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    cycleId: String(row.cycle_id),
    startChapter: Number(row.start_chapter),
    endChapter: Number(row.end_chapter),
    action: row.action as PlanningProposal["action"],
    targetType: row.target_type as PlanningProposal["targetType"],
    targetRef: row.target_ref ? String(row.target_ref) : undefined,
    targetName: String(row.target_name),
    patch: parseJson(row.patch_json, {}),
    reason: String(row.reason),
    status: row.status as PlanningProposalStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createPlanningProposalsRepository(client: Client) {
  async function list(novelId: string): Promise<PlanningProposal[]> {
    const result = await client.execute({
      sql: "SELECT * FROM planning_proposals WHERE novel_id=? ORDER BY start_chapter,created_at",
      args: [novelId],
    });
    return result.rows.map((row) => fromRow(row as DbRow));
  }

  async function replacePending(
    novelId: string,
    cycleId: string,
    startChapter: number,
    endChapter: number,
    proposals: NewPlanningProposal[],
  ): Promise<PlanningProposal[]> {
    const before = await list(novelId),
      now = new Date().toISOString();
    await client.execute({
      sql: "DELETE FROM planning_proposals WHERE novel_id=? AND start_chapter=? AND end_chapter=? AND status='pending'",
      args: [novelId, startChapter, endChapter],
    });
    const retained = before.filter(
        (item) =>
          !(
            item.startChapter === startChapter &&
            item.endChapter === endChapter &&
            item.status === "pending"
          ),
      ),
      unique = uniqueNewProposals(retained, proposals);
    if (unique.length)
      await client.batch(
        unique.map((item) => ({
          sql: "INSERT INTO planning_proposals (id,novel_id,cycle_id,start_chapter,end_chapter,action,target_type,target_ref,target_name,patch_json,reason,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          args: [
            nanoid(), novelId, cycleId, startChapter, endChapter, item.action,
            item.targetType, item.targetRef ?? null, item.targetName, JSON.stringify(item.patch),
            item.reason, "pending", now, now,
          ],
        })),
        "write",
      );
    return (await list(novelId)).filter(
      (item) =>
        item.startChapter === startChapter && item.endChapter === endChapter,
    );
  }

  async function addUnique(
    novelId: string,
    cycleId: string,
    startChapter: number,
    endChapter: number,
    proposals: NewPlanningProposal[],
  ): Promise<PlanningProposal[]> {
    const unique = uniqueNewProposals(await list(novelId), proposals),
      now = new Date().toISOString();
    if (unique.length)
      await client.batch(
        unique.map((item) => ({
          sql: "INSERT INTO planning_proposals (id,novel_id,cycle_id,start_chapter,end_chapter,action,target_type,target_ref,target_name,patch_json,reason,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          args: [
            nanoid(), novelId, cycleId, startChapter, endChapter, item.action,
            item.targetType, item.targetRef ?? null, item.targetName,
            JSON.stringify(item.patch), item.reason, "pending", now, now,
          ],
        })),
        "write",
      );
    return (await list(novelId)).filter(
      (item) => planningProposalIdentity(item) && unique.some(
        (proposal) => planningProposalIdentity(proposal) === planningProposalIdentity(item),
      ),
    );
  }

  async function updateStatus(
    id: string,
    status: PlanningProposalStatus,
  ): Promise<PlanningProposal> {
    await client.execute({
      sql: "UPDATE planning_proposals SET status=?,updated_at=? WHERE id=?",
      args: [status, new Date().toISOString(), id],
    });
    const result = await client.execute({
      sql: "SELECT * FROM planning_proposals WHERE id=?",
      args: [id],
    });
    if (!result.rows[0]) throw new Error("策划提案不存在");
    return fromRow(result.rows[0] as DbRow);
  }

  return { list, replacePending, addUnique, updateStatus };
}

function uniqueNewProposals(
  existing: PlanningProposal[],
  proposals: NewPlanningProposal[],
): NewPlanningProposal[] {
  const seen = new Set(
    existing
      .filter((item) => item.status !== "rejected")
      .map(planningProposalIdentity),
  );
  return proposals.filter((item) => {
    const key = planningProposalIdentity(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

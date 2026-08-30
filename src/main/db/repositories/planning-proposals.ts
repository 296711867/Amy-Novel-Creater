import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import type {
  NewPlanningProposal,
  PlanningProposal,
  PlanningProposalStatus,
} from "@domain/planning-proposal";
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
    const now = new Date().toISOString();
    await client.execute({
      sql: "DELETE FROM planning_proposals WHERE novel_id=? AND start_chapter=? AND end_chapter=? AND status='pending'",
      args: [novelId, startChapter, endChapter],
    });
    if (proposals.length)
      await client.batch(
        proposals.map((item) => ({
          sql: "INSERT INTO planning_proposals (id,novel_id,cycle_id,start_chapter,end_chapter,action,target_type,target_name,patch_json,reason,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          args: [
            nanoid(), novelId, cycleId, startChapter, endChapter, item.action,
            item.targetType, item.targetName, JSON.stringify(item.patch),
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

  return { list, replacePending, updateStatus };
}

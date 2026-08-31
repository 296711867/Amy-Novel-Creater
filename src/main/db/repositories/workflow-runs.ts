import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import type {
  CreateWorkflowRunInput,
  UpdateWorkflowRunInput,
  WorkflowRun,
} from "@domain/workflow-run";
import { parseJson, type DbRow } from "./shared";

function fromRow(row: DbRow): WorkflowRun {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    mode: row.mode as WorkflowRun["mode"],
    currentPhase: row.current_phase as WorkflowRun["currentPhase"],
    status: row.status as WorkflowRun["status"],
    checkpoint: (row.checkpoint || null) as WorkflowRun["checkpoint"],
    config: parseJson(row.config_json, {} as WorkflowRun["config"]),
    attempt: Number(row.attempt),
    batchId: row.batch_id ? String(row.batch_id) : null,
    error: String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createWorkflowRunsRepository(client: Client) {
  async function get(id: string): Promise<WorkflowRun | null> {
    const result = await client.execute({
      sql: "SELECT * FROM workflow_runs WHERE id=?",
      args: [id],
    });
    return result.rows[0] ? fromRow(result.rows[0] as DbRow) : null;
  }

  async function create(input: CreateWorkflowRunInput): Promise<WorkflowRun> {
    const id = nanoid(),
      now = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO workflow_runs (id,novel_id,mode,current_phase,status,checkpoint,config_json,attempt,batch_id,error,created_at,updated_at) VALUES (?,?,?,'bible','paused',NULL,?,0,NULL,'',?,?)",
      args: [id, input.novelId, input.mode, JSON.stringify(input.config), now, now],
    });
    return (await get(id))!;
  }

  async function update(input: UpdateWorkflowRunInput): Promise<WorkflowRun> {
    const current = await get(input.id);
    if (!current) throw new Error("Workflow run 不存在");
    const next = { ...current, ...input, updatedAt: new Date().toISOString() };
    await client.execute({
      sql: "UPDATE workflow_runs SET current_phase=?,status=?,checkpoint=?,attempt=?,batch_id=?,error=?,updated_at=? WHERE id=?",
      args: [
        next.currentPhase,
        next.status,
        next.checkpoint,
        next.attempt,
        next.batchId,
        next.error,
        next.updatedAt,
        next.id,
      ],
    });
    return (await get(input.id))!;
  }

  async function list(novelId: string): Promise<WorkflowRun[]> {
    const result = await client.execute({
      sql: "SELECT * FROM workflow_runs WHERE novel_id=? ORDER BY created_at DESC",
      args: [novelId],
    });
    return result.rows.map((row) => fromRow(row as DbRow));
  }

  return { get, create, update, list };
}

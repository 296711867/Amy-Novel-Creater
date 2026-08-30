import type { Client } from "@libsql/client";
import {
  defaultPlanningWorkflow,
  normalizePlanningWorkflow,
  type PlanningBrief,
  type PlanningReviewStep,
  type PlanningWorkflow,
} from "@domain/planning-workflow";
import { parseJson, type DbRow } from "./shared";

function fromRow(row: DbRow): PlanningWorkflow {
  return normalizePlanningWorkflow({
    novelId: String(row.novel_id),
    brief: parseJson<PlanningBrief>(row.brief_json, defaultPlanningWorkflow("").brief),
    confirmedSteps: parseJson<PlanningReviewStep[]>(row.confirmed_steps_json, []),
    updatedAt: String(row.updated_at),
  });
}

export function createPlanningWorkflowRepository(client: Client) {
  async function getPlanningWorkflow(novelId: string): Promise<PlanningWorkflow> {
    const result = await client.execute({
      sql: "SELECT * FROM planning_workflows WHERE novel_id=?",
      args: [novelId],
    });
    return result.rows[0]
      ? fromRow(result.rows[0] as DbRow)
      : defaultPlanningWorkflow(novelId);
  }

  async function savePlanningWorkflow(
    workflow: PlanningWorkflow,
  ): Promise<PlanningWorkflow> {
    const value = normalizePlanningWorkflow(workflow);
    await client.execute({
      sql: `INSERT INTO planning_workflows (novel_id,brief_json,confirmed_steps_json,updated_at) VALUES (?,?,?,?) ON CONFLICT(novel_id) DO UPDATE SET brief_json=excluded.brief_json,confirmed_steps_json=excluded.confirmed_steps_json,updated_at=excluded.updated_at`,
      args: [
        value.novelId,
        JSON.stringify(value.brief),
        JSON.stringify(value.confirmedSteps),
        value.updatedAt,
      ],
    });
    return value;
  }

  return { getPlanningWorkflow, savePlanningWorkflow };
}

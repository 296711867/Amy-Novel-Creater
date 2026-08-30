import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import {
  planningPromptHash,
  type PlanningRun,
  type PlanningRunResponse,
  type StartPlanningRunInput,
} from "@domain/planning-run";
import type { DbRow } from "./shared";

function fromRow(row: DbRow): PlanningRun {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    phase: row.phase as PlanningRun["phase"],
    startChapter: row.start_chapter === null ? null : Number(row.start_chapter),
    endChapter: row.end_chapter === null ? null : Number(row.end_chapter),
    profileId: String(row.profile_id),
    provider: String(row.provider),
    model: String(row.model),
    promptHash: String(row.prompt_hash),
    rawResponse: String(row.raw_response),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cachedTokens: Number(row.cached_tokens),
    status: row.status as PlanningRun["status"],
    error: String(row.error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createPlanningRunsRepository(client: Client) {
  async function get(id: string): Promise<PlanningRun | null> {
    const result = await client.execute({
      sql: "SELECT * FROM planning_runs WHERE id=?",
      args: [id],
    });
    return result.rows[0] ? fromRow(result.rows[0] as DbRow) : null;
  }

  async function start(input: StartPlanningRunInput): Promise<PlanningRun> {
    const id = nanoid(),
      now = new Date().toISOString();
    await client.execute({
      sql: "INSERT INTO planning_runs VALUES (?,?,?,?,?,?,?,?,?,'',0,0,0,'running','',?,?)",
      args: [
        id,
        input.novelId,
        input.phase,
        input.startChapter ?? null,
        input.endChapter ?? null,
        input.profileId,
        input.provider,
        input.model,
        planningPromptHash(input.prompt),
        now,
        now,
      ],
    });
    return (await get(id))!;
  }

  async function received(
    id: string,
    response: PlanningRunResponse,
  ): Promise<PlanningRun> {
    await client.execute({
      sql: "UPDATE planning_runs SET raw_response=?,input_tokens=?,output_tokens=?,cached_tokens=?,status='received',error='',updated_at=? WHERE id=?",
      args: [
        response.rawResponse,
        response.inputTokens,
        response.outputTokens,
        response.cachedTokens,
        new Date().toISOString(),
        id,
      ],
    });
    return (await get(id))!;
  }

  async function complete(id: string): Promise<PlanningRun> {
    await client.execute({
      sql: "UPDATE planning_runs SET status='completed',error='',updated_at=? WHERE id=?",
      args: [new Date().toISOString(), id],
    });
    return (await get(id))!;
  }

  async function fail(id: string, error: string): Promise<PlanningRun> {
    await client.execute({
      sql: "UPDATE planning_runs SET status='failed',error=?,updated_at=? WHERE id=?",
      args: [error, new Date().toISOString(), id],
    });
    return (await get(id))!;
  }

  async function list(novelId: string): Promise<PlanningRun[]> {
    const result = await client.execute({
      sql: "SELECT * FROM planning_runs WHERE novel_id=? ORDER BY created_at DESC",
      args: [novelId],
    });
    return result.rows.map((row) => fromRow(row as DbRow));
  }

  return { get, start, received, complete, fail, list };
}

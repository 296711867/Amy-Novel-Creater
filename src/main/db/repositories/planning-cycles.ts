import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import type {
  PlanningCycle,
  SavePlanningCycleInput,
} from "@domain/planning-cycle";
import type { DbRow } from "./shared";

function fromRow(row: DbRow): PlanningCycle {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    startChapter: Number(row.start_chapter),
    endChapter: Number(row.end_chapter),
    status: row.status as PlanningCycle["status"],
    goal: String(row.goal),
    openingState: String(row.opening_state),
    climax: String(row.climax),
    expectedClosingState: String(row.expected_closing_state),
    actualClosingState: String(row.actual_closing_state),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createPlanningCyclesRepository(client: Client) {
  async function list(novelId: string): Promise<PlanningCycle[]> {
    const result = await client.execute({
      sql: "SELECT * FROM planning_cycles WHERE novel_id=? ORDER BY start_chapter,created_at",
      args: [novelId],
    });
    return result.rows.map((row) => fromRow(row as DbRow));
  }

  async function save(input: SavePlanningCycleInput): Promise<PlanningCycle> {
    const existing = input.id
        ? input.id
        : String(
            (
              await client.execute({
                sql: "SELECT id FROM planning_cycles WHERE novel_id=? AND start_chapter=? AND end_chapter=? AND status!='superseded' ORDER BY created_at DESC LIMIT 1",
                args: [input.novelId, input.startChapter, input.endChapter],
              })
            ).rows[0]?.id ?? "",
          ),
      id = existing || nanoid(),
      now = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO planning_cycles VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET start_chapter=excluded.start_chapter,end_chapter=excluded.end_chapter,status=excluded.status,goal=excluded.goal,opening_state=excluded.opening_state,climax=excluded.climax,expected_closing_state=excluded.expected_closing_state,actual_closing_state=excluded.actual_closing_state,updated_at=excluded.updated_at`,
      args: [
        id,
        input.novelId,
        input.startChapter,
        input.endChapter,
        input.status,
        input.goal,
        input.openingState,
        input.climax,
        input.expectedClosingState,
        input.actualClosingState,
        now,
        now,
      ],
    });
    const result = await client.execute({
      sql: "SELECT * FROM planning_cycles WHERE id=?",
      args: [id],
    });
    return fromRow(result.rows[0] as DbRow);
  }

  return { list, save };
}

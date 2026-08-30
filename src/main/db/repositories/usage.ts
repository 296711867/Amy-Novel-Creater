import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import type { SaveUsageInput, UsageRecord } from "@domain/usage";
import type { DbRow } from "./shared";

function usageFrom(row: DbRow): UsageRecord {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    chapterId: row.chapter_id ? String(row.chapter_id) : null,
    operation: row.operation as UsageRecord["operation"],
    provider: String(row.provider),
    model: String(row.model),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cachedTokens: Number(row.cached_tokens),
    cost: row.cost === null ? null : Number(row.cost),
    measurement: row.measurement as UsageRecord["measurement"],
    createdAt: String(row.created_at),
  };
}

export function createUsageRepository(client: Client) {
  async function saveUsage(input: SaveUsageInput): Promise<UsageRecord> {
    const item: UsageRecord = {
      id: nanoid(),
      ...input,
      createdAt: new Date().toISOString(),
    };
    await client.execute({
      sql: "INSERT INTO usage_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [
        item.id,
        item.novelId,
        item.chapterId,
        item.operation,
        item.provider,
        item.model,
        item.inputTokens,
        item.outputTokens,
        item.cachedTokens,
        item.cost,
        item.measurement,
        item.createdAt,
      ],
    });
    return item;
  }

  async function listUsage(novelId?: string): Promise<UsageRecord[]> {
    const result = novelId
      ? await client.execute({
          sql: "SELECT * FROM usage_records WHERE novel_id=? ORDER BY created_at DESC",
          args: [novelId],
        })
      : await client.execute(
          "SELECT * FROM usage_records ORDER BY created_at DESC",
        );
    return result.rows.map((row) => usageFrom(row as DbRow));
  }

  return { saveUsage, listUsage };
}

import type { Client } from "@libsql/client";

export type DbRow = Record<string, unknown>;

export function parseJson<T>(value: unknown, fallback: T): T {
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

export async function resequence(
  client: Client,
  table: string,
  ownerColumn: string,
  ownerId: string,
  ids: string[],
): Promise<void> {
  const found = await client.execute({
      sql: `SELECT id FROM ${table} WHERE ${ownerColumn}=?`,
      args: [ownerId],
    }),
    actual = new Set(found.rows.map((row) => String(row.id)));
  if (ids.length !== actual.size || ids.some((id) => !actual.has(id)))
    throw new Error("Invalid reorder set");
  await client.batch(
    [
      ...ids.map((id, index) => ({
        sql: `UPDATE ${table} SET position=? WHERE id=?`,
        args: [-(index + 1), id],
      })),
      ...ids.map((id, index) => ({
        sql: `UPDATE ${table} SET position=? WHERE id=?`,
        args: [index + 1, id],
      })),
    ],
    "write",
  );
}

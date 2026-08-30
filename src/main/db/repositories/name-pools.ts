import type { Client } from "@libsql/client";
import {
  defaultNamePool,
  type NamePool,
  type NamePoolGenre,
} from "@domain/name-pool";
import { parseJson, type DbRow } from "./shared";

function poolFrom(row: DbRow, novelId: string): NamePool {
  return {
    novelId,
    genre: String(row.genre) as NamePoolGenre,
    surnames: parseJson<string[]>(row.surnames_json, []),
    givenNames: parseJson<string[]>(row.given_names_json, []),
    usedNames: parseJson<string[]>(row.used_names_json, []),
    updatedAt: String(row.updated_at),
  };
}

export function createNamePoolRepository(client: Client) {
  return {
    // 按需种子：首次读取时用题材默认池初始化，作者/AI 后续可覆盖扩充。
    async getNamePool(novelId: string, genre: string): Promise<NamePool> {
      const existing = await client.execute({
        sql: "SELECT * FROM name_pools WHERE novel_id = ?",
        args: [novelId],
      });
      if (existing.rows.length) return poolFrom(existing.rows[0], novelId);
      const seeded = defaultNamePool(novelId, genre),
        now = seeded.updatedAt;
      await client.execute({
        sql: "INSERT INTO name_pools (novel_id, genre, surnames_json, given_names_json, used_names_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        args: [
          novelId,
          seeded.genre,
          JSON.stringify(seeded.surnames),
          JSON.stringify(seeded.givenNames),
          JSON.stringify(seeded.usedNames),
          now,
        ],
      });
      return seeded;
    },
    async saveNamePool(pool: NamePool): Promise<NamePool> {
      const now = new Date().toISOString();
      await client.execute({
        sql: "INSERT INTO name_pools (novel_id, genre, surnames_json, given_names_json, used_names_json, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(novel_id) DO UPDATE SET genre = excluded.genre, surnames_json = excluded.surnames_json, given_names_json = excluded.given_names_json, used_names_json = excluded.used_names_json, updated_at = excluded.updated_at",
        args: [
          pool.novelId,
          pool.genre,
          JSON.stringify(pool.surnames),
          JSON.stringify(pool.givenNames),
          JSON.stringify(pool.usedNames),
          now,
        ],
      });
      return { ...pool, updatedAt: now };
    },
  };
}

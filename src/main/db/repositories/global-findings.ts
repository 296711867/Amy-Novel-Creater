import type { Client } from "@libsql/client";
import type { GlobalFinding } from "@domain/global-consistency";
import { type DbRow } from "./shared";

function fromRow(row: DbRow): GlobalFinding {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    source: row.source as GlobalFinding["source"],
    severity: row.severity as GlobalFinding["severity"],
    category: row.category as GlobalFinding["category"],
    message: String(row.message),
    evidence: String(row.evidence ?? ""),
    suggestion: row.suggestion ? String(row.suggestion) : undefined,
    targetKind: row.target_kind
      ? (row.target_kind as GlobalFinding["targetKind"])
      : undefined,
    targetName: row.target_name ? String(row.target_name) : undefined,
    chapterPosition:
      row.chapter_position === null || row.chapter_position === undefined
        ? undefined
        : Number(row.chapter_position),
    status: row.status as GlobalFinding["status"],
    createdAt: String(row.created_at),
  };
}

/** AN-027 全局一致性发现：确定性规则与 AI 审查共用一张表。 */
export function createGlobalFindingsRepository(client: Client) {
  async function list(novelId: string): Promise<GlobalFinding[]> {
    const result = await client.execute({
      sql: "SELECT * FROM global_findings WHERE novel_id=? ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC",
      args: [novelId],
    });
    return result.rows.map(fromRow);
  }
  async function replace(novelId: string, findings: GlobalFinding[]) {
    await client.batch(
      [
        {
          sql: "DELETE FROM global_findings WHERE novel_id=?",
          args: [novelId],
        },
        ...findings.map((item) => ({
          sql: "INSERT INTO global_findings (id,novel_id,source,severity,category,message,evidence,suggestion,target_kind,target_name,chapter_position,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          args: [
            item.id,
            novelId,
            item.source,
            item.severity,
            item.category,
            item.message,
            item.evidence,
            item.suggestion ?? null,
            item.targetKind ?? null,
            item.targetName ?? null,
            item.chapterPosition ?? null,
            item.status,
            item.createdAt,
          ],
        })),
      ],
      "write",
    );
    return list(novelId);
  }
  return { list, replace };
}

export type GlobalFindingsRepository = ReturnType<
  typeof createGlobalFindingsRepository
>;

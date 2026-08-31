import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import type {
  SaveStyleTemplateInput,
  StyleTemplate,
} from "@domain/style-template";
import type { DbRow } from "./shared";

function fromRow(row: DbRow): StyleTemplate {
  return {
    id: String(row.id),
    name: String(row.name),
    authorAlias: String(row.author_alias),
    sourceTitle: String(row.source_title),
    sampleText: String(row.sample_text),
    contentSummary: String(row.content_summary),
    styleSummary: String(row.style_summary),
    styleGuide: String(row.style_guide),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createStyleTemplatesRepository(client: Client) {
  async function list(): Promise<StyleTemplate[]> {
    const result = await client.execute(
      "SELECT * FROM style_templates ORDER BY updated_at DESC",
    );
    return result.rows.map((row) => fromRow(row as DbRow));
  }
  async function get(id: string): Promise<StyleTemplate | null> {
    const result = await client.execute({
      sql: "SELECT * FROM style_templates WHERE id=?",
      args: [id],
    });
    return result.rows[0] ? fromRow(result.rows[0] as DbRow) : null;
  }
  async function save(input: SaveStyleTemplateInput): Promise<StyleTemplate> {
    const id = input.id ?? nanoid(),
      now = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO style_templates VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,author_alias=excluded.author_alias,source_title=excluded.source_title,sample_text=excluded.sample_text,content_summary=excluded.content_summary,style_summary=excluded.style_summary,style_guide=excluded.style_guide,updated_at=excluded.updated_at`,
      args: [
        id,
        input.name.trim(),
        input.authorAlias.trim(),
        input.sourceTitle.trim(),
        input.sampleText.trim(),
        input.contentSummary.trim(),
        input.styleSummary.trim(),
        input.styleGuide.trim(),
        now,
        now,
      ],
    });
    return (await get(id))!;
  }
  async function remove(id: string): Promise<void> {
    await client.execute({ sql: "DELETE FROM style_templates WHERE id=?", args: [id] });
  }
  return { list, get, save, remove };
}

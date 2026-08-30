import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import {
  normalizeAliases,
  type BibleSection,
  type BibleSectionKind,
  type SaveBibleSectionInput,
  type SaveStoryEntityInput,
  type StoryEntity,
  type StoryEntityType,
} from "@domain/story-bible";
import { parseJson, type DbRow } from "./shared";

function sectionFrom(row: DbRow): BibleSection {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    kind: row.kind as BibleSectionKind,
    content: String(row.content),
    versionNo: Number(row.version_no),
    updatedAt: String(row.updated_at),
  };
}

function entityFrom(row: DbRow): StoryEntity {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    type: row.type as StoryEntityType,
    name: String(row.name),
    summary: String(row.summary),
    aliases: parseJson<string[]>(row.aliases_json, []),
    profile: parseJson<Record<string, string>>(row.profile_json, {}),
    status: row.status as StoryEntity["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createStoryBibleRepository(client: Client) {
  async function listBibleSections(novelId: string): Promise<BibleSection[]> {
    const now = new Date().toISOString();
    const kinds: BibleSectionKind[] = [
      "intent",
      "world",
      "style",
      "boundaries",
    ];
    await client.batch(
      kinds.map((kind) => ({
        sql: "INSERT OR IGNORE INTO story_bibles VALUES (?, ?, ?, ?, ?, ?)",
        args: [`${novelId}:bible:${kind}`, novelId, kind, "", 1, now],
      })),
      "write",
    );
    const result = await client.execute({
      sql: "SELECT * FROM story_bibles WHERE novel_id=? ORDER BY CASE kind WHEN 'intent' THEN 1 WHEN 'world' THEN 2 WHEN 'style' THEN 3 ELSE 4 END",
      args: [novelId],
    });
    return result.rows.map((row) => sectionFrom(row as DbRow));
  }

  async function saveBibleSection(
    input: SaveBibleSectionInput,
  ): Promise<BibleSection> {
    await listBibleSections(input.novelId);
    const now = new Date().toISOString();
    await client.execute({
      sql: "UPDATE story_bibles SET content=?, version_no=version_no+1, updated_at=? WHERE novel_id=? AND kind=?",
      args: [input.content, now, input.novelId, input.kind],
    });
    const result = await client.execute({
      sql: "SELECT * FROM story_bibles WHERE novel_id=? AND kind=?",
      args: [input.novelId, input.kind],
    });
    return sectionFrom(result.rows[0] as DbRow);
  }

  async function listStoryEntities(
    novelId: string,
    type?: StoryEntityType,
  ): Promise<StoryEntity[]> {
    const result = type
      ? await client.execute({
          sql: "SELECT * FROM story_entities WHERE novel_id=? AND type=? ORDER BY updated_at DESC",
          args: [novelId, type],
        })
      : await client.execute({
          sql: "SELECT * FROM story_entities WHERE novel_id=? ORDER BY type, updated_at DESC",
          args: [novelId],
        });
    return result.rows.map((row) => entityFrom(row as DbRow));
  }

  async function saveStoryEntity(
    input: SaveStoryEntityInput,
  ): Promise<StoryEntity> {
    const now = new Date().toISOString(),
      id = input.id ?? nanoid(),
      aliases = JSON.stringify(normalizeAliases(input.aliases)),
      profile = JSON.stringify(input.profile);
    await client.execute({
      sql: `INSERT INTO story_entities (id,novel_id,type,name,summary,aliases_json,profile_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'active',?,?) ON CONFLICT(id) DO UPDATE SET type=excluded.type,name=excluded.name,summary=excluded.summary,aliases_json=excluded.aliases_json,profile_json=excluded.profile_json,updated_at=excluded.updated_at`,
      args: [
        id,
        input.novelId,
        input.type,
        input.name.trim(),
        input.summary,
        aliases,
        profile,
        now,
        now,
      ],
    });
    const result = await client.execute({
      sql: "SELECT * FROM story_entities WHERE id=?",
      args: [id],
    });
    return entityFrom(result.rows[0] as DbRow);
  }

  async function deleteStoryEntity(entityId: string): Promise<void> {
    await client.execute({
      sql: "DELETE FROM story_entities WHERE id=?",
      args: [entityId],
    });
  }

  return {
    listBibleSections,
    saveBibleSection,
    listStoryEntities,
    saveStoryEntity,
    deleteStoryEntity,
  };
}

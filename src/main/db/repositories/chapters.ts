import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import {
  countCjkWords,
  type Chapter,
  type ChapterVersion,
  type CreateChapterInput,
  type SaveChapterInput,
  type UpdateChapterPlanInput,
} from "@domain/novel";
import { resequence, type DbRow } from "./shared";

function chapterFrom(row: DbRow): Chapter {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    position: Number(row.position),
    volumeId: row.volume_id ? String(row.volume_id) : null,
    title: String(row.title),
    outline: String(row.outline),
    status: row.status as Chapter["status"],
    targetWords: Number(row.target_words),
    content: String(row.content ?? ""),
    wordCount: Number(row.word_count ?? 0),
    updatedAt: String(row.updated_at),
  };
}

function versionFrom(row: DbRow): ChapterVersion {
  return {
    id: String(row.id),
    chapterId: String(row.chapter_id),
    versionNo: Number(row.version_no),
    origin: row.origin as ChapterVersion["origin"],
    content: String(row.content),
    wordCount: Number(row.word_count),
    createdAt: String(row.created_at),
  };
}

export function createChaptersRepository(client: Client) {
  async function getChapter(chapterId: string): Promise<Chapter | null> {
    const result = await client.execute({
      sql: "SELECT * FROM chapters WHERE id = ?",
      args: [chapterId],
    });
    return result.rows[0] ? chapterFrom(result.rows[0] as DbRow) : null;
  }

  async function listChapters(novelId: string): Promise<Chapter[]> {
    const result = await client.execute({
      sql: "SELECT * FROM chapters WHERE novel_id = ? ORDER BY position",
      args: [novelId],
    });
    return result.rows.map((row) => chapterFrom(row as DbRow));
  }

  async function saveChapter(input: SaveChapterInput): Promise<Chapter> {
    const now = new Date().toISOString(),
      wordCount = countCjkWords(input.content);
    await client.execute({
      sql: `UPDATE chapters SET title=?, outline=?, content=?, word_count=?, status=CASE WHEN status='planned' THEN 'draft' ELSE status END, updated_at=? WHERE id=?`,
      args: [
        input.title,
        input.outline,
        input.content,
        wordCount,
        now,
        input.chapterId,
      ],
    });
    if (input.createSnapshot)
      await createChapterSnapshot(input.chapterId, input.origin ?? "manual");
    const chapter = await getChapter(input.chapterId);
    if (!chapter) throw new Error("Chapter not found");
    return chapter;
  }

  async function createChapter(input: CreateChapterInput): Promise<Chapter> {
    const count = await client.execute({
        sql: "SELECT COALESCE(MAX(position),0)+1 next_position FROM chapters WHERE novel_id=?",
        args: [input.novelId],
      }),
      position = Number(count.rows[0].next_position),
      now = new Date().toISOString(),
      id = nanoid();
    await client.execute({
      sql: `INSERT INTO chapters (id,novel_id,position,volume_id,title,outline,status,target_words,content,word_count,updated_at) VALUES (?,?,?,?,?,?,'planned',?,'',0,?)`,
      args: [
        id,
        input.novelId,
        position,
        input.volumeId,
        input.title?.trim() || `第 ${position} 章`,
        "",
        input.targetWords,
        now,
      ],
    });
    return (await getChapter(id))!;
  }

  async function updateChapterPlan(
    input: UpdateChapterPlanInput,
  ): Promise<Chapter> {
    await client.execute({
      sql: "UPDATE chapters SET volume_id=?,title=?,outline=?,target_words=?,updated_at=? WHERE id=?",
      args: [
        input.volumeId,
        input.title.trim(),
        input.outline,
        input.targetWords,
        new Date().toISOString(),
        input.chapterId,
      ],
    });
    const chapter = await getChapter(input.chapterId);
    if (!chapter) throw new Error("Chapter not found");
    return chapter;
  }

  async function deleteChapter(id: string): Promise<void> {
    await client.execute({
      sql: "DELETE FROM chapters WHERE id=?",
      args: [id],
    });
  }

  async function reorderChapters(
    novelId: string,
    ids: string[],
  ): Promise<Chapter[]> {
    await resequence(client, "chapters", "novel_id", novelId, ids);
    return listChapters(novelId);
  }

  async function listChapterVersions(
    chapterId: string,
  ): Promise<ChapterVersion[]> {
    const result = await client.execute({
      sql: "SELECT * FROM chapter_versions WHERE chapter_id=? ORDER BY version_no DESC",
      args: [chapterId],
    });
    return result.rows.map((row) => versionFrom(row as DbRow));
  }

  async function createChapterSnapshot(
    chapterId: string,
    origin: ChapterVersion["origin"] = "manual",
  ): Promise<ChapterVersion> {
    const chapter = await getChapter(chapterId);
    if (!chapter) throw new Error("Chapter not found");
    const count = await client.execute({
      sql: "SELECT COALESCE(MAX(version_no),0)+1 AS next_no FROM chapter_versions WHERE chapter_id=?",
      args: [chapterId],
    });
    const version: ChapterVersion = {
      id: nanoid(),
      chapterId,
      versionNo: Number(count.rows[0].next_no),
      origin,
      content: chapter.content,
      wordCount: chapter.wordCount,
      createdAt: new Date().toISOString(),
    };
    await client.execute({
      sql: "INSERT INTO chapter_versions VALUES (?, ?, ?, ?, ?, ?, ?)",
      args: [
        version.id,
        version.chapterId,
        version.versionNo,
        version.origin,
        version.content,
        version.wordCount,
        version.createdAt,
      ],
    });
    return version;
  }

  return {
    getChapter,
    listChapters,
    saveChapter,
    createChapter,
    updateChapterPlan,
    deleteChapter,
    reorderChapters,
    listChapterVersions,
    createChapterSnapshot,
  };
}

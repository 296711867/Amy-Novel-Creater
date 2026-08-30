import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import type {
  SaveSceneInput,
  SaveVolumeInput,
  StoryScene,
  StoryStructure,
  StoryVolume,
} from "@domain/story-structure";
import { resequence, type DbRow } from "./shared";

function volumeFrom(row: DbRow): StoryVolume {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    position: Number(row.position),
    title: String(row.title),
    outline: String(row.outline),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function sceneFrom(row: DbRow): StoryScene {
  return {
    id: String(row.id),
    chapterId: String(row.chapter_id),
    position: Number(row.position),
    title: String(row.title),
    summary: String(row.summary),
    viewpoint: String(row.viewpoint),
    location: String(row.location),
    targetWords: Number(row.target_words),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createStoryStructureRepository(client: Client) {
  async function listStoryStructure(novelId: string): Promise<StoryStructure> {
    let volumes = await client.execute({
      sql: "SELECT * FROM story_volumes WHERE novel_id=? ORDER BY position",
      args: [novelId],
    });
    if (!volumes.rows.length) {
      const now = new Date().toISOString(),
        id = nanoid();
      await client.execute({
        sql: "INSERT INTO story_volumes VALUES (?,?,?,?,?,?,?)",
        args: [id, novelId, 1, "第一卷", "", now, now],
      });
      await client.execute({
        sql: "UPDATE chapters SET volume_id=? WHERE novel_id=? AND volume_id IS NULL",
        args: [id, novelId],
      });
      volumes = await client.execute({
        sql: "SELECT * FROM story_volumes WHERE novel_id=? ORDER BY position",
        args: [novelId],
      });
    }
    const scenes = await client.execute({
      sql: "SELECT s.* FROM story_scenes s JOIN chapters c ON c.id=s.chapter_id WHERE c.novel_id=? ORDER BY c.position,s.position",
      args: [novelId],
    });
    return {
      volumes: volumes.rows.map((row) => volumeFrom(row as DbRow)),
      scenes: scenes.rows.map((row) => sceneFrom(row as DbRow)),
    };
  }

  async function saveVolume(input: SaveVolumeInput): Promise<StoryVolume> {
    const now = new Date().toISOString(),
      id = input.id ?? nanoid();
    if (input.id)
      await client.execute({
        sql: "UPDATE story_volumes SET title=?,outline=?,updated_at=? WHERE id=?",
        args: [input.title.trim(), input.outline, now, id],
      });
    else {
      const result = await client.execute({
        sql: "SELECT COALESCE(MAX(position),0)+1 next_position FROM story_volumes WHERE novel_id=?",
        args: [input.novelId],
      });
      await client.execute({
        sql: "INSERT INTO story_volumes VALUES (?,?,?,?,?,?,?)",
        args: [
          id,
          input.novelId,
          Number(result.rows[0].next_position),
          input.title.trim(),
          input.outline,
          now,
          now,
        ],
      });
    }
    const row = await client.execute({
      sql: "SELECT * FROM story_volumes WHERE id=?",
      args: [id],
    });
    return volumeFrom(row.rows[0] as DbRow);
  }

  async function deleteVolume(id: string): Promise<void> {
    const row = await client.execute({
      sql: "SELECT novel_id FROM story_volumes WHERE id=?",
      args: [id],
    });
    if (!row.rows[0]) return;
    const count = await client.execute({
      sql: "SELECT COUNT(*) count FROM story_volumes WHERE novel_id=?",
      args: [String(row.rows[0].novel_id)],
    });
    if (Number(count.rows[0].count) <= 1)
      throw new Error("At least one volume is required");
    await client.execute({
      sql: "UPDATE chapters SET volume_id=NULL WHERE volume_id=?",
      args: [id],
    });
    await client.execute({
      sql: "DELETE FROM story_volumes WHERE id=?",
      args: [id],
    });
  }

  async function reorderVolumes(
    novelId: string,
    ids: string[],
  ): Promise<StoryVolume[]> {
    await resequence(client, "story_volumes", "novel_id", novelId, ids);
    return (await listStoryStructure(novelId)).volumes;
  }

  async function saveScene(input: SaveSceneInput): Promise<StoryScene> {
    const now = new Date().toISOString(),
      id = input.id ?? nanoid();
    if (input.id)
      await client.execute({
        sql: "UPDATE story_scenes SET title=?,summary=?,viewpoint=?,location=?,target_words=?,updated_at=? WHERE id=?",
        args: [
          input.title.trim(),
          input.summary,
          input.viewpoint,
          input.location,
          input.targetWords,
          now,
          id,
        ],
      });
    else {
      const result = await client.execute({
        sql: "SELECT COALESCE(MAX(position),0)+1 next_position FROM story_scenes WHERE chapter_id=?",
        args: [input.chapterId],
      });
      await client.execute({
        sql: "INSERT INTO story_scenes VALUES (?,?,?,?,?,?,?,?,?,?)",
        args: [
          id,
          input.chapterId,
          Number(result.rows[0].next_position),
          input.title.trim(),
          input.summary,
          input.viewpoint,
          input.location,
          input.targetWords,
          now,
          now,
        ],
      });
    }
    const row = await client.execute({
      sql: "SELECT * FROM story_scenes WHERE id=?",
      args: [id],
    });
    return sceneFrom(row.rows[0] as DbRow);
  }

  async function deleteScene(id: string): Promise<void> {
    await client.execute({
      sql: "DELETE FROM story_scenes WHERE id=?",
      args: [id],
    });
  }

  async function reorderScenes(
    chapterId: string,
    ids: string[],
  ): Promise<StoryScene[]> {
    await resequence(client, "story_scenes", "chapter_id", chapterId, ids);
    const rows = await client.execute({
      sql: "SELECT * FROM story_scenes WHERE chapter_id=? ORDER BY position",
      args: [chapterId],
    });
    return rows.rows.map((row) => sceneFrom(row as DbRow));
  }

  return {
    listStoryStructure,
    saveVolume,
    deleteVolume,
    reorderVolumes,
    saveScene,
    deleteScene,
    reorderScenes,
  };
}

import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import {
  normalizeStateList,
  type CharacterState,
  type ForeshadowThread,
  type SaveCharacterStateInput,
  type SaveForeshadowInput,
  type SaveTimelineEventInput,
  type TimelineEvent,
} from "@domain/continuity";
import { parseJson, type DbRow } from "./shared";

function timelineFrom(row: DbRow): TimelineEvent {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    chapterId: row.chapter_id ? String(row.chapter_id) : null,
    storyTime: String(row.story_time),
    title: String(row.title),
    detail: String(row.detail),
    participantIds: parseJson<string[]>(row.participant_ids_json, []),
    source: row.source as TimelineEvent["source"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function foreshadowFrom(row: DbRow): ForeshadowThread {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    title: String(row.title),
    detail: String(row.detail),
    setupChapterId: row.setup_chapter_id ? String(row.setup_chapter_id) : null,
    payoffChapterId: row.payoff_chapter_id
      ? String(row.payoff_chapter_id)
      : null,
    status: row.status as ForeshadowThread["status"],
    source: row.source as ForeshadowThread["source"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function characterStateFrom(row: DbRow): CharacterState {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    characterId: String(row.character_id),
    chapterId: row.chapter_id ? String(row.chapter_id) : null,
    summary: String(row.summary),
    location: String(row.location),
    physical: String(row.physical),
    emotional: String(row.emotional),
    knowledge: parseJson<string[]>(row.knowledge_json, []),
    goals: parseJson<string[]>(row.goals_json, []),
    inventory: parseJson<string[]>(row.inventory_json, []),
    skills: parseJson<string[]>(row.skills_json, []),
    source: row.source as CharacterState["source"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createContinuityRepository(client: Client) {
  async function listTimelineEvents(novelId: string): Promise<TimelineEvent[]> {
    const r = await client.execute({
      sql: "SELECT * FROM timeline_events WHERE novel_id=? ORDER BY story_time,created_at",
      args: [novelId],
    });
    return r.rows.map((row) => timelineFrom(row as DbRow));
  }

  async function saveTimelineEvent(
    input: SaveTimelineEventInput,
  ): Promise<TimelineEvent> {
    const now = new Date().toISOString(),
      id = input.id ?? nanoid();
    await client.execute({
      sql: `INSERT INTO timeline_events VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET chapter_id=excluded.chapter_id,story_time=excluded.story_time,title=excluded.title,detail=excluded.detail,participant_ids_json=excluded.participant_ids_json,source=excluded.source,updated_at=excluded.updated_at`,
      args: [
        id,
        input.novelId,
        input.chapterId,
        input.storyTime,
        input.title.trim(),
        input.detail,
        JSON.stringify(normalizeStateList(input.participantIds)),
        input.source ?? "manual",
        now,
        now,
      ],
    });
    const r = await client.execute({
      sql: "SELECT * FROM timeline_events WHERE id=?",
      args: [id],
    });
    return timelineFrom(r.rows[0] as DbRow);
  }

  async function deleteTimelineEvent(id: string): Promise<void> {
    await client.execute({
      sql: "DELETE FROM timeline_events WHERE id=?",
      args: [id],
    });
  }

  async function listForeshadowThreads(
    novelId: string,
  ): Promise<ForeshadowThread[]> {
    const r = await client.execute({
      sql: "SELECT * FROM foreshadow_threads WHERE novel_id=? ORDER BY updated_at DESC",
      args: [novelId],
    });
    return r.rows.map((row) => foreshadowFrom(row as DbRow));
  }

  async function saveForeshadowThread(
    input: SaveForeshadowInput,
  ): Promise<ForeshadowThread> {
    const now = new Date().toISOString(),
      id = input.id ?? nanoid();
    await client.execute({
      sql: `INSERT INTO foreshadow_threads VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,detail=excluded.detail,setup_chapter_id=excluded.setup_chapter_id,payoff_chapter_id=excluded.payoff_chapter_id,status=excluded.status,source=excluded.source,updated_at=excluded.updated_at`,
      args: [
        id,
        input.novelId,
        input.title.trim(),
        input.detail,
        input.setupChapterId,
        input.payoffChapterId,
        input.status,
        input.source ?? "manual",
        now,
        now,
      ],
    });
    const r = await client.execute({
      sql: "SELECT * FROM foreshadow_threads WHERE id=?",
      args: [id],
    });
    return foreshadowFrom(r.rows[0] as DbRow);
  }

  async function deleteForeshadowThread(id: string): Promise<void> {
    await client.execute({
      sql: "DELETE FROM foreshadow_threads WHERE id=?",
      args: [id],
    });
  }

  async function listCharacterStates(
    novelId: string,
    characterId?: string,
  ): Promise<CharacterState[]> {
    const r = characterId
      ? await client.execute({
          sql: "SELECT * FROM character_states WHERE novel_id=? AND character_id=? ORDER BY updated_at DESC",
          args: [novelId, characterId],
        })
      : await client.execute({
          sql: "SELECT * FROM character_states WHERE novel_id=? ORDER BY updated_at DESC",
          args: [novelId],
        });
    return r.rows.map((row) => characterStateFrom(row as DbRow));
  }

  async function saveCharacterState(
    input: SaveCharacterStateInput,
  ): Promise<CharacterState> {
    const now = new Date().toISOString(),
      id = input.id ?? nanoid();
    await client.execute({
      sql: `INSERT INTO character_states (id,novel_id,character_id,chapter_id,summary,location,physical,emotional,knowledge_json,goals_json,inventory_json,skills_json,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET chapter_id=excluded.chapter_id,summary=excluded.summary,location=excluded.location,physical=excluded.physical,emotional=excluded.emotional,knowledge_json=excluded.knowledge_json,goals_json=excluded.goals_json,inventory_json=excluded.inventory_json,skills_json=excluded.skills_json,source=excluded.source,updated_at=excluded.updated_at`,
      args: [
        id,
        input.novelId,
        input.characterId,
        input.chapterId,
        input.summary,
        input.location,
        input.physical,
        input.emotional,
        JSON.stringify(normalizeStateList(input.knowledge)),
        JSON.stringify(normalizeStateList(input.goals)),
        JSON.stringify(normalizeStateList(input.inventory)),
        JSON.stringify(normalizeStateList(input.skills)),
        input.source ?? "manual",
        now,
        now,
      ],
    });
    const r = await client.execute({
      sql: "SELECT * FROM character_states WHERE id=?",
      args: [id],
    });
    return characterStateFrom(r.rows[0] as DbRow);
  }

  async function deleteCharacterState(id: string): Promise<void> {
    await client.execute({
      sql: "DELETE FROM character_states WHERE id=?",
      args: [id],
    });
  }

  return {
    listTimelineEvents,
    saveTimelineEvent,
    deleteTimelineEvent,
    listForeshadowThreads,
    saveForeshadowThread,
    deleteForeshadowThread,
    listCharacterStates,
    saveCharacterState,
    deleteCharacterState,
  };
}

import type { Client, InStatement } from "@libsql/client";
import { nanoid } from "nanoid";
import {
  buildInitialChapters,
  calculateTargetWords,
  normalizeCycleSize,
  type Chapter,
  type CreateNovelInput,
  type Novel,
} from "@domain/novel";
import type { NovelProjectBundle } from "@domain/project-export";
import type { DbRow } from "./shared";

const NOVEL_COLUMNS =
  "id, title, genre, premise, target_words, target_chapters, chapter_words, status, created_at, updated_at, cycle_size";

function novelFrom(row: DbRow): Novel {
  return {
    id: String(row.id),
    title: String(row.title),
    genre: String(row.genre),
    premise: String(row.premise),
    targetWords: Number(row.target_words),
    targetChapters: Number(row.target_chapters),
    chapterWords: Number(row.chapter_words),
    cycleSize: normalizeCycleSize(row.cycle_size as number | null),
    status: row.status as Novel["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createNovelsRepository(client: Client) {
  async function listNovels(): Promise<Novel[]> {
    const result = await client.execute(
      "SELECT * FROM novels ORDER BY updated_at DESC",
    );
    return result.rows.map((row) => novelFrom(row as DbRow));
  }

  async function getNovel(id: string): Promise<Novel | null> {
    const result = await client.execute({
      sql: "SELECT * FROM novels WHERE id=?",
      args: [id],
    });
    return result.rows[0] ? novelFrom(result.rows[0] as DbRow) : null;
  }

  async function deleteNovel(id: string): Promise<void> {
    if (!(await getNovel(id))) throw new Error("作品不存在");
    const args = [id];
    await client.batch(
      [
        "DELETE FROM continuity_findings WHERE chapter_id IN (SELECT id FROM chapters WHERE novel_id=?)",
        "DELETE FROM fact_proposals WHERE chapter_id IN (SELECT id FROM chapters WHERE novel_id=?)",
        "DELETE FROM chapter_versions WHERE chapter_id IN (SELECT id FROM chapters WHERE novel_id=?)",
        "DELETE FROM story_scenes WHERE chapter_id IN (SELECT id FROM chapters WHERE novel_id=?)",
        "DELETE FROM generation_jobs WHERE batch_id IN (SELECT id FROM generation_batches WHERE novel_id=?)",
        "DELETE FROM chapter_candidates WHERE novel_id=?",
        "DELETE FROM context_snapshots WHERE novel_id=?",
        "DELETE FROM usage_records WHERE novel_id=?",
        "DELETE FROM timeline_events WHERE novel_id=?",
        "DELETE FROM foreshadow_threads WHERE novel_id=?",
        "DELETE FROM character_states WHERE novel_id=?",
        "DELETE FROM story_bibles WHERE novel_id=?",
        "DELETE FROM story_entities WHERE novel_id=?",
        "DELETE FROM story_volumes WHERE novel_id=?",
        "DELETE FROM name_pools WHERE novel_id=?",
        "DELETE FROM planning_runs WHERE novel_id=?",
        "DELETE FROM planning_cycles WHERE novel_id=?",
        "DELETE FROM planning_workflows WHERE novel_id=?",
        "DELETE FROM chapters WHERE novel_id=?",
        "DELETE FROM generation_batches WHERE novel_id=?",
        "DELETE FROM novels WHERE id=?",
      ].map((sql) => ({ sql, args })),
      "write",
    );
  }

  async function createNovel(
    input: CreateNovelInput,
  ): Promise<{ novel: Novel; chapters: Chapter[] }> {
    const now = new Date().toISOString();
    const id = nanoid();
    const novel: Novel = {
      id,
      ...input,
      premise: input.premise.trim(),
      targetWords: calculateTargetWords(input),
      cycleSize: normalizeCycleSize(input.cycleSize),
      status: "planning",
      createdAt: now,
      updatedAt: now,
    };
    const chapters = buildInitialChapters(
      id,
      input.targetChapters,
      input.chapterWords,
    );
    await client.batch(
      [
        {
          sql: `INSERT INTO novels (${NOVEL_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            novel.id,
            novel.title,
            novel.genre,
            novel.premise,
            novel.targetWords,
            novel.targetChapters,
            novel.chapterWords,
            novel.status,
            novel.createdAt,
            novel.updatedAt,
            novel.cycleSize,
          ],
        },
        ...chapters.map((chapter) => ({
          sql: "INSERT INTO chapters (id, novel_id, position, volume_id, title, outline, status, target_words, content, word_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          args: [
            chapter.id,
            chapter.novelId,
            chapter.position,
            chapter.volumeId,
            chapter.title,
            chapter.outline,
            chapter.status,
            chapter.targetWords,
            chapter.content,
            chapter.wordCount,
            chapter.updatedAt,
          ],
        })),
      ],
      "write",
    );
    return { novel, chapters };
  }

  async function importNovelProject(
    bundle: NovelProjectBundle,
  ): Promise<Novel> {
    const id = nanoid(),
      now = new Date().toISOString(),
      novel: Novel = {
        ...bundle.novel,
        id,
        title: `${bundle.novel.title}（恢复）`,
        cycleSize: normalizeCycleSize(bundle.novel.cycleSize),
        createdAt: now,
        updatedAt: now,
      };
    const chapterIds = new Map(
        bundle.chapters.map((item) => [
          item.id,
          `${id}:chapter:${item.position}`,
        ]),
      ),
      volumeIds = new Map(bundle.volumes.map((item) => [item.id, nanoid()])),
      entityIds = new Map(bundle.entities.map((item) => [item.id, nanoid()])),
      candidateIds = new Map(
        bundle.candidates.map((item) => [item.id, nanoid()]),
      ),
      cycleIds = new Map(
        (bundle.planningCycles ?? []).map((item) => [item.id, nanoid()]),
      );
    const commands: InStatement[] = [];
    commands.push({
      sql: `INSERT INTO novels (${NOVEL_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id,
        novel.title,
        novel.genre,
        novel.premise,
        novel.targetWords,
        novel.targetChapters,
        novel.chapterWords,
        novel.status,
        now,
        now,
        novel.cycleSize,
      ],
    });
    if (bundle.workflow)
      commands.push({
        sql: "INSERT INTO planning_workflows (novel_id,brief_json,confirmed_steps_json,updated_at) VALUES (?,?,?,?)",
        args: [
          id,
          JSON.stringify(bundle.workflow.brief),
          JSON.stringify(bundle.workflow.confirmedSteps),
          bundle.workflow.updatedAt,
        ],
      });
    for (const item of bundle.planningRuns ?? [])
      commands.push({
        sql: "INSERT INTO planning_runs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [
          nanoid(), id, item.phase, item.startChapter, item.endChapter,
          item.profileId, item.provider, item.model, item.promptHash,
          item.rawResponse, item.inputTokens, item.outputTokens,
          item.cachedTokens, item.status, item.error, item.createdAt, item.updatedAt,
        ],
      });
    for (const item of bundle.planningCycles ?? [])
      commands.push({
        sql: "INSERT INTO planning_cycles VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [
          cycleIds.get(item.id)!, id, item.startChapter, item.endChapter,
          item.status, item.goal, item.openingState, item.climax,
          item.expectedClosingState, item.actualClosingState,
          item.createdAt, item.updatedAt,
        ],
      });
    for (const item of bundle.planningProposals ?? [])
      if (cycleIds.has(item.cycleId))
        commands.push({
          sql: "INSERT INTO planning_proposals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          args: [
            nanoid(), id, cycleIds.get(item.cycleId)!, item.startChapter,
            item.endChapter, item.action, item.targetType, item.targetName,
            JSON.stringify(item.patch), item.reason, item.status,
            item.createdAt, item.updatedAt,
          ],
        });
    for (const item of bundle.volumes)
      commands.push({
        sql: "INSERT INTO story_volumes VALUES (?,?,?,?,?,?,?)",
        args: [
          volumeIds.get(item.id)!,
          id,
          item.position,
          item.title,
          item.outline,
          item.createdAt,
          item.updatedAt,
        ],
      });
    for (const item of bundle.chapters)
      commands.push({
        sql: "INSERT INTO chapters (id,novel_id,position,volume_id,title,outline,status,target_words,content,word_count,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        args: [
          chapterIds.get(item.id)!,
          id,
          item.position,
          item.volumeId ? (volumeIds.get(item.volumeId) ?? null) : null,
          item.title,
          item.outline,
          item.status,
          item.targetWords,
          item.content,
          item.wordCount,
          item.updatedAt,
        ],
      });
    for (const item of bundle.versions)
      if (chapterIds.has(item.chapterId))
        commands.push({
          sql: "INSERT INTO chapter_versions VALUES (?,?,?,?,?,?,?)",
          args: [
            nanoid(),
            chapterIds.get(item.chapterId)!,
            item.versionNo,
            item.origin,
            item.content,
            item.wordCount,
            item.createdAt,
          ],
        });
    for (const item of bundle.bible)
      commands.push({
        sql: "INSERT OR REPLACE INTO story_bibles VALUES (?,?,?,?,?,?)",
        args: [
          `${id}:bible:${item.kind}`,
          id,
          item.kind,
          item.content,
          item.versionNo,
          item.updatedAt,
        ],
      });
    for (const item of bundle.entities)
      commands.push({
        sql: "INSERT INTO story_entities VALUES (?,?,?,?,?,?,?,?,?,?)",
        args: [
          entityIds.get(item.id)!,
          id,
          item.type,
          item.name,
          item.summary,
          JSON.stringify(item.aliases),
          JSON.stringify(item.profile),
          item.status,
          item.createdAt,
          item.updatedAt,
        ],
      });
    for (const item of bundle.scenes)
      if (chapterIds.has(item.chapterId))
        commands.push({
          sql: "INSERT INTO story_scenes VALUES (?,?,?,?,?,?,?,?,?,?)",
          args: [
            nanoid(),
            chapterIds.get(item.chapterId)!,
            item.position,
            item.title,
            item.summary,
            item.viewpoint,
            item.location,
            item.targetWords,
            item.createdAt,
            item.updatedAt,
          ],
        });
    for (const item of bundle.timeline)
      commands.push({
        sql: "INSERT INTO timeline_events VALUES (?,?,?,?,?,?,?,?,?,?)",
        args: [
          nanoid(),
          id,
          item.chapterId ? (chapterIds.get(item.chapterId) ?? null) : null,
          item.storyTime,
          item.title,
          item.detail,
          JSON.stringify(
            item.participantIds.flatMap((value) => entityIds.get(value) ?? []),
          ),
          item.source,
          item.createdAt,
          item.updatedAt,
        ],
      });
    for (const item of bundle.foreshadow)
      commands.push({
        sql: "INSERT INTO foreshadow_threads VALUES (?,?,?,?,?,?,?,?,?,?)",
        args: [
          nanoid(),
          id,
          item.title,
          item.detail,
          item.setupChapterId
            ? (chapterIds.get(item.setupChapterId) ?? null)
            : null,
          item.payoffChapterId
            ? (chapterIds.get(item.payoffChapterId) ?? null)
            : null,
          item.status,
          item.source,
          item.createdAt,
          item.updatedAt,
        ],
      });
    for (const item of bundle.characterStates)
      if (entityIds.has(item.characterId))
        commands.push({
          sql: "INSERT INTO character_states (id,novel_id,character_id,chapter_id,summary,location,physical,emotional,knowledge_json,goals_json,inventory_json,skills_json,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          args: [
            nanoid(),
            id,
            entityIds.get(item.characterId)!,
            item.chapterId ? (chapterIds.get(item.chapterId) ?? null) : null,
            item.summary,
            item.location,
            item.physical,
            item.emotional,
            JSON.stringify(item.knowledge),
            JSON.stringify(item.goals),
            JSON.stringify(item.inventory),
            JSON.stringify(item.skills),
            item.source,
            item.createdAt,
            item.updatedAt,
          ],
        });
    for (const item of bundle.usage)
      commands.push({
        sql: "INSERT INTO usage_records VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        args: [
          nanoid(),
          id,
          item.chapterId ? (chapterIds.get(item.chapterId) ?? null) : null,
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
    for (const item of bundle.candidates)
      if (chapterIds.has(item.chapterId))
        commands.push({
          sql: "INSERT INTO chapter_candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
          args: [
            candidateIds.get(item.id)!,
            id,
            chapterIds.get(item.chapterId)!,
            item.profileId,
            item.contextHash,
            item.content,
            item.wordCount,
            item.status,
            item.inputTokens,
            item.outputTokens,
            item.cachedTokens,
            item.createdAt,
            item.updatedAt,
          ],
        });
    await client.batch(commands, "write");
    return novel;
  }

  async function updateCycleSize(id: string, cycleSize: number): Promise<Novel> {
    const novel = await getNovel(id);
    if (!novel) throw new Error("作品不存在");
    const normalized = normalizeCycleSize(cycleSize);
    await client.execute({
      sql: "UPDATE novels SET cycle_size=?, updated_at=? WHERE id=?",
      args: [normalized, new Date().toISOString(), id],
    });
    return (await getNovel(id))!;
  }

  return {
    listNovels,
    getNovel,
    deleteNovel,
    createNovel,
    importNovelProject,
    updateCycleSize,
  };
}

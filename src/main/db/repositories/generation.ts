import type { Client } from "@libsql/client";
import { nanoid } from "nanoid";
import { countCjkWords } from "@domain/novel";
import type { ContextPack } from "@domain/context-pack";
import type { ChapterCandidate } from "@domain/chapter-generation";
import type {
  ContinuityFinding,
  FactProposal,
  StoredFinding,
} from "@domain/quality-check";
import {
  estimateGeneration,
  type GenerationBatch,
  type GenerationJob,
  type GenerationJobStatus,
  type GenerationPolicy,
} from "@domain/generation";
import { parseJson, type DbRow } from "./shared";
import type { createChaptersRepository } from "./chapters";

type ChaptersRepo = ReturnType<typeof createChaptersRepository>;

function contextFrom(row: DbRow): ContextPack {
  return {
    chapterId: String(row.chapter_id),
    renderedText: String(row.rendered_text),
    contentHash: String(row.content_hash),
    inputTokens: Number(row.input_tokens),
    outputTokensReserved: Number(row.output_tokens_reserved),
    totalBudget: Number(row.total_budget),
    sources: parseJson(row.sources_json, []),
    createdAt: String(row.created_at),
  };
}

function candidateFrom(row: DbRow): ChapterCandidate {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    chapterId: String(row.chapter_id),
    profileId: String(row.profile_id),
    contextHash: String(row.context_hash),
    content: String(row.content),
    wordCount: Number(row.word_count),
    status: row.status as ChapterCandidate["status"],
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    cachedTokens: Number(row.cached_tokens),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function batchFrom(row: DbRow): GenerationBatch {
  return {
    id: String(row.id),
    novelId: String(row.novel_id),
    status: row.status as GenerationBatch["status"],
    policy: parseJson(row.policy_json, {} as GenerationPolicy),
    outputTokensUsed: Number(row.output_tokens_used),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function jobFrom(row: DbRow): GenerationJob {
  return {
    id: String(row.id),
    batchId: String(row.batch_id),
    chapterId: String(row.chapter_id),
    position: Number(row.position),
    status: row.status as GenerationJobStatus,
    attempt: Number(row.attempt),
    candidateId: row.candidate_id ? String(row.candidate_id) : null,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    error: String(row.error),
    updatedAt: String(row.updated_at),
  };
}

function findingFrom(row: DbRow): StoredFinding {
  return {
    id: String(row.id),
    candidateId: String(row.candidate_id),
    chapterId: String(row.chapter_id),
    severity: row.severity as StoredFinding["severity"],
    category: row.category as StoredFinding["category"],
    message: String(row.message),
    evidence: String(row.evidence),
    status: row.status as StoredFinding["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function proposalFrom(row: DbRow): FactProposal {
  return {
    id: String(row.id),
    candidateId: String(row.candidate_id),
    chapterId: String(row.chapter_id),
    kind: row.kind as FactProposal["kind"],
    title: String(row.title),
    payload: parseJson(row.payload_json, {}),
    status: row.status as FactProposal["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createGenerationRepository(
  client: Client,
  chapters: ChaptersRepo,
) {
  async function saveContextSnapshot(
    novelId: string,
    pack: ContextPack,
  ): Promise<ContextPack> {
    await client.execute({
      sql: "INSERT INTO context_snapshots VALUES (?,?,?,?,?,?,?,?,?,?)",
      args: [
        nanoid(),
        novelId,
        pack.chapterId,
        pack.renderedText,
        pack.contentHash,
        pack.inputTokens,
        pack.outputTokensReserved,
        pack.totalBudget,
        JSON.stringify(pack.sources),
        pack.createdAt,
      ],
    });
    return pack;
  }

  async function listContextSnapshots(
    novelId: string,
    chapterId?: string,
  ): Promise<ContextPack[]> {
    const result = chapterId
      ? await client.execute({
          sql: "SELECT * FROM context_snapshots WHERE novel_id=? AND chapter_id=? ORDER BY created_at DESC",
          args: [novelId, chapterId],
        })
      : await client.execute({
          sql: "SELECT * FROM context_snapshots WHERE novel_id=? ORDER BY created_at DESC",
          args: [novelId],
        });
    return result.rows.map((row) => contextFrom(row as DbRow));
  }

  async function getChapterCandidate(
    id: string,
  ): Promise<ChapterCandidate | null> {
    const result = await client.execute({
      sql: "SELECT * FROM chapter_candidates WHERE id=?",
      args: [id],
    });
    return result.rows[0] ? candidateFrom(result.rows[0] as DbRow) : null;
  }

  async function createChapterCandidate(
    input: Omit<
      ChapterCandidate,
      "id" | "wordCount" | "status" | "createdAt" | "updatedAt"
    >,
  ): Promise<ChapterCandidate> {
    const id = nanoid(),
      now = new Date().toISOString(),
      wordCount = countCjkWords(input.content);
    await client.execute({
      sql: "INSERT INTO chapter_candidates VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      args: [
        id,
        input.novelId,
        input.chapterId,
        input.profileId,
        input.contextHash,
        input.content,
        wordCount,
        "candidate",
        input.inputTokens,
        input.outputTokens,
        input.cachedTokens,
        now,
        now,
      ],
    });
    return (await getChapterCandidate(id))!;
  }

  async function listChapterCandidates(
    chapterId: string,
  ): Promise<ChapterCandidate[]> {
    const result = await client.execute({
      sql: "SELECT * FROM chapter_candidates WHERE chapter_id=? ORDER BY created_at DESC",
      args: [chapterId],
    });
    return result.rows.map((row) => candidateFrom(row as DbRow));
  }

  async function setCandidateStatus(
    id: string,
    status: "accepted" | "rejected",
  ): Promise<ChapterCandidate> {
    const candidate = await getChapterCandidate(id);
    if (!candidate) throw new Error("Candidate not found");
    if (candidate.status !== "candidate")
      throw new Error("Candidate already reviewed");
    if (status === "accepted") {
      const chapter = await chapters.getChapter(candidate.chapterId);
      if (!chapter) throw new Error("Chapter not found");
      await chapters.saveChapter({
        chapterId: chapter.id,
        title: chapter.title,
        outline: chapter.outline,
        content: candidate.content,
        createSnapshot: true,
        origin: "accepted",
      });
    }
    await client.execute({
      sql: "UPDATE chapter_candidates SET status=?,updated_at=? WHERE id=?",
      args: [status, new Date().toISOString(), id],
    });
    return (await getChapterCandidate(id))!;
  }

  async function createGenerationBatch(
    novelId: string,
    policy: GenerationPolicy,
  ): Promise<{ id: string; estimate: ReturnType<typeof estimateGeneration> }> {
    const id = nanoid(),
      now = new Date().toISOString(),
      chapterList = await chapters.listChapters(novelId),
      selected = chapterList.filter(
        (item) =>
          item.position >= policy.startChapter &&
          item.position <= policy.endChapter,
      );
    if (!selected.length) throw new Error("No chapters in range");
    await client.batch(
      [
        {
          sql: "INSERT INTO generation_batches VALUES (?,?,?,?,?,?,?)",
          args: [id, novelId, "queued", JSON.stringify(policy), 0, now, now],
        },
        ...selected.map((chapter, index) => ({
          sql: `INSERT INTO generation_jobs VALUES (?,?,?,?, 'queued',0,NULL,0,0,'',?)`,
          args: [nanoid(), id, chapter.id, index + 1, now],
        })),
      ],
      "write",
    );
    return { id, estimate: estimateGeneration(policy) };
  }

  async function listGenerationBatches(): Promise<GenerationBatch[]> {
    const result = await client.execute(
      "SELECT * FROM generation_batches ORDER BY created_at DESC",
    );
    return result.rows.map((row) => batchFrom(row as DbRow));
  }

  async function getGenerationBatch(
    id: string,
  ): Promise<GenerationBatch | null> {
    const result = await client.execute({
      sql: "SELECT * FROM generation_batches WHERE id=?",
      args: [id],
    });
    return result.rows[0] ? batchFrom(result.rows[0] as DbRow) : null;
  }

  async function listGenerationJobs(batchId: string): Promise<GenerationJob[]> {
    const result = await client.execute({
      sql: "SELECT * FROM generation_jobs WHERE batch_id=? ORDER BY position",
      args: [batchId],
    });
    return result.rows.map((row) => jobFrom(row as DbRow));
  }

  async function recoverGenerationJobs(batchId: string): Promise<void> {
    await client.execute({
      sql: `UPDATE generation_jobs SET status='queued',error='从上次中断处恢复',updated_at=? WHERE batch_id=? AND status IN ('building_context','generating','paused')`,
      args: [new Date().toISOString(), batchId],
    });
  }

  async function setBatchStatus(
    id: string,
    status: GenerationBatch["status"],
  ): Promise<GenerationBatch> {
    await client.execute({
      sql: "UPDATE generation_batches SET status=?,updated_at=? WHERE id=?",
      args: [status, new Date().toISOString(), id],
    });
    const item = await getGenerationBatch(id);
    if (!item) throw new Error("Batch not found");
    return item;
  }

  async function updateGenerationJob(
    id: string,
    status: GenerationJobStatus,
    patch: Partial<
      Pick<
        GenerationJob,
        "candidateId" | "inputTokens" | "outputTokens" | "error" | "attempt"
      >
    > = {},
  ): Promise<GenerationJob> {
    const currentResult = await client.execute({
      sql: "SELECT * FROM generation_jobs WHERE id=?",
      args: [id],
    });
    if (!currentResult.rows[0]) throw new Error("Job not found");
    const current = jobFrom(currentResult.rows[0] as DbRow),
      next = {
        ...current,
        ...patch,
        status,
        updatedAt: new Date().toISOString(),
      };
    await client.execute({
      sql: "UPDATE generation_jobs SET status=?,attempt=?,candidate_id=?,input_tokens=?,output_tokens=?,error=?,updated_at=? WHERE id=?",
      args: [
        next.status,
        next.attempt,
        next.candidateId,
        next.inputTokens,
        next.outputTokens,
        next.error,
        next.updatedAt,
        id,
      ],
    });
    if (next.outputTokens !== current.outputTokens)
      await client.execute({
        sql: "UPDATE generation_batches SET output_tokens_used=output_tokens_used+?,updated_at=? WHERE id=?",
        args: [
          next.outputTokens - current.outputTokens,
          next.updatedAt,
          next.batchId,
        ],
      });
    return next;
  }

  async function saveFindings(
    candidateId: string,
    chapterId: string,
    items: ContinuityFinding[],
  ): Promise<StoredFinding[]> {
    const now = new Date().toISOString(),
      stored = items.map((item) => ({
        ...item,
        id: nanoid(),
        candidateId,
        chapterId,
        status: "open" as const,
        createdAt: now,
        updatedAt: now,
      }));
    if (stored.length)
      await client.batch(
        stored.map((item) => ({
          sql: "INSERT INTO continuity_findings VALUES (?,?,?,?,?,?,?,?,?,?)",
          args: [
            item.id,
            item.candidateId,
            item.chapterId,
            item.severity,
            item.category,
            item.message,
            item.evidence,
            item.status,
            item.createdAt,
            item.updatedAt,
          ],
        })),
        "write",
      );
    return stored;
  }

  async function listFindings(candidateId: string): Promise<StoredFinding[]> {
    const result = await client.execute({
      sql: "SELECT * FROM continuity_findings WHERE candidate_id=? ORDER BY created_at",
      args: [candidateId],
    });
    return result.rows.map((row) => findingFrom(row as DbRow));
  }

  async function updateFinding(
    id: string,
    status: StoredFinding["status"],
  ): Promise<StoredFinding> {
    await client.execute({
      sql: "UPDATE continuity_findings SET status=?,updated_at=? WHERE id=?",
      args: [status, new Date().toISOString(), id],
    });
    const result = await client.execute({
      sql: "SELECT * FROM continuity_findings WHERE id=?",
      args: [id],
    });
    return findingFrom(result.rows[0] as DbRow);
  }

  async function listFactProposals(
    candidateId: string,
  ): Promise<FactProposal[]> {
    const result = await client.execute({
      sql: "SELECT * FROM fact_proposals WHERE candidate_id=? ORDER BY created_at",
      args: [candidateId],
    });
    return result.rows.map((row) => proposalFrom(row as DbRow));
  }

  async function saveFactProposals(
    candidateId: string,
    chapterId: string,
    items: Array<Pick<FactProposal, "kind" | "title" | "payload">>,
  ): Promise<FactProposal[]> {
    const now = new Date().toISOString(),
      stored = items.map((item) => ({
        ...item,
        id: nanoid(),
        candidateId,
        chapterId,
        status: "proposed" as const,
        createdAt: now,
        updatedAt: now,
      }));
    if (stored.length)
      await client.batch(
        stored.map((item) => ({
          sql: "INSERT INTO fact_proposals VALUES (?,?,?,?,?,?,?,?,?)",
          args: [
            item.id,
            item.candidateId,
            item.chapterId,
            item.kind,
            item.title,
            JSON.stringify(item.payload),
            item.status,
            item.createdAt,
            item.updatedAt,
          ],
        })),
        "write",
      );
    return stored;
  }

  async function updateFactProposal(
    id: string,
    status: FactProposal["status"],
  ): Promise<FactProposal> {
    const now = new Date().toISOString();
    await client.execute({
      sql: "UPDATE fact_proposals SET status=?,updated_at=? WHERE id=?",
      args: [status, now, id],
    });
    const result = await client.execute({
      sql: "SELECT * FROM fact_proposals WHERE id=?",
      args: [id],
    });
    if (!result.rows[0]) throw new Error("事实建议不存在");
    return proposalFrom(result.rows[0] as DbRow);
  }

  return {
    saveContextSnapshot,
    listContextSnapshots,
    createChapterCandidate,
    getChapterCandidate,
    listChapterCandidates,
    setCandidateStatus,
    createGenerationBatch,
    listGenerationBatches,
    getGenerationBatch,
    listGenerationJobs,
    recoverGenerationJobs,
    setBatchStatus,
    updateGenerationJob,
    saveFindings,
    listFindings,
    updateFinding,
    listFactProposals,
    saveFactProposals,
    updateFactProposal,
  };
}

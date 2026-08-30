import { buildContextPack, estimateTokens } from "@domain/context-pack";
import type { GenerationBatch, GenerationJob } from "@domain/generation";
import type { ModelProfile } from "@domain/model-profile";
import type { UsageMeasurement } from "@domain/usage";
import type { NovelDatabase } from "../db/database";
import type { SecretVault } from "../security/secret-vault";
import { streamOpenAICompatible } from "../model/openai-compatible";
import { checkCandidateQuality } from "@domain/quality-check";
import {
  factExtractionPrompt,
  parseFactExtraction,
} from "@domain/fact-extraction";
import {
  chapterReviewPrompt,
  parseChapterReview,
} from "@domain/chapter-review";
import { namePoolText } from "@domain/name-pool";

const MAX_CONCURRENCY = 3;
type StreamResult = Awaited<ReturnType<typeof streamOpenAICompatible>>;

export class BatchRunner {
  private readonly active = new Map<string, AbortController>();
  constructor(
    private readonly database: NovelDatabase,
    private readonly secrets: SecretVault,
  ) {}
  start(batchId: string): void {
    if (this.active.has(batchId)) return;
    const controller = new AbortController();
    this.active.set(batchId, controller);
    void this.run(batchId, controller).finally(() =>
      this.active.delete(batchId),
    );
  }
  async pause(batchId: string): Promise<void> {
    await this.database.setBatchStatus(batchId, "paused");
    this.active.get(batchId)?.abort();
  }
  private async run(
    batchId: string,
    controller: AbortController,
  ): Promise<void> {
    const batch = await this.database.getGenerationBatch(batchId);
    if (!batch) return;
    const profiles = await this.database.listModelProfiles(),
      profile = profiles.find((item) => item.isDefault) ?? profiles[0];
    if (!profile) {
      await this.database.setBatchStatus(batchId, "failed");
      return;
    }
    const apiKey = await this.secrets.get(profile.id);
    await this.database.recoverGenerationJobs(batchId);
    await this.database.setBatchStatus(batchId, "running");
    const limit = Math.min(
      Math.max(1, batch.policy.concurrency ?? 1),
      MAX_CONCURRENCY,
    );
    const inFlight = new Map<string, Promise<void>>();
    while (!controller.signal.aborted) {
      const current = await this.database.getGenerationBatch(batchId);
      if (!current || current.status !== "running") break;
      const jobs = await this.database.listGenerationJobs(batchId);
      if (current.outputTokensUsed >= current.policy.outputTokenBudget) {
        await this.database.setBatchStatus(batchId, "paused");
        break;
      }
      const runnable = jobs
        .filter(
          (item) =>
            (item.status === "queued" || item.status === "waiting_retry") &&
            !inFlight.has(item.id),
        )
        .sort((a, b) => a.position - b.position)
        .slice(0, limit - inFlight.size);
      for (const job of runnable) {
        const task = this.processJob(
          current,
          job,
          profile,
          apiKey,
          controller.signal,
        ).finally(() => inFlight.delete(job.id));
        inFlight.set(job.id, task);
      }
      if (!inFlight.size) {
        await this.database.setBatchStatus(
          batchId,
          jobs.some((item) => item.status === "failed")
            ? "failed"
            : "completed",
        );
        break;
      }
      await Promise.race(inFlight.values());
    }
    if (inFlight.size) await Promise.allSettled([...inFlight.values()]);
  }
  private async recordUsage(
    batch: GenerationBatch,
    profile: ModelProfile,
    chapterId: string,
    operation: "generation" | "continuity_check" | "chapter_review",
    promptTokens: {
      inputTokens: number;
      outputTokens: number;
      cachedTokens: number;
      measured: boolean;
    },
  ): Promise<void> {
    await this.database.saveUsage({
      novelId: batch.novelId,
      chapterId,
      operation,
      provider: profile.provider,
      model: profile.modelId,
      inputTokens: promptTokens.inputTokens,
      outputTokens: promptTokens.outputTokens,
      cachedTokens: promptTokens.cachedTokens,
      cost: null,
      measurement: (promptTokens.measured
        ? "provider"
        : "estimated") as UsageMeasurement,
    });
  }
  private async runAncillaryCall(
    profile: ModelProfile,
    apiKey: string,
    prompt: string,
    maxTokens: number,
    signal: AbortSignal,
  ): Promise<StreamResult | null> {
    try {
      // 辅助调用（事实提取 / 审查）只需要 JSON，思考纯浪费 token。
      return await streamOpenAICompatible(
        profile,
        apiKey,
        prompt,
        maxTokens,
        0.1,
        () => {},
        fetch,
        signal,
        "disabled",
      );
    } catch (error) {
      if (signal.aborted) throw error;
      // 审查与事实提取是增强步骤，失败不阻断候选稿产出。
      return null;
    }
  }
  private async processJob(
    current: GenerationBatch,
    job: GenerationJob,
    profile: ModelProfile,
    apiKey: string,
    signal: AbortSignal,
  ): Promise<void> {
    try {
      await this.database.updateGenerationJob(job.id, "building_context", {
        attempt: job.attempt + 1,
        error: "",
      });
      const [
        novel,
        chapter,
        chapters,
        bible,
        entities,
        structure,
        timeline,
        foreshadow,
        states,
      ] = await Promise.all([
        this.database.getNovel(current.novelId),
        this.database.getChapter(job.chapterId),
        this.database.listChapters(current.novelId),
        this.database.listBibleSections(current.novelId),
        this.database.listStoryEntities(current.novelId),
        this.database.listStoryStructure(current.novelId),
        this.database.listTimelineEvents(current.novelId),
        this.database.listForeshadowThreads(current.novelId),
        this.database.listCharacterStates(current.novelId),
      ]);
      if (!novel || !chapter) throw new Error("作品或章节不存在");
      const pool = await this.database.getNamePool(
        current.novelId,
        novel.genre,
      );
      const output = Math.min(
        Math.ceil(current.policy.chapterWords * 1.5),
        profile.contextWindow - 4000,
        current.policy.outputTokenBudget - current.outputTokensUsed,
      );
      if (output < 500) {
        await this.database.setBatchStatus(current.id, "paused");
        return;
      }
      const pack = buildContextPack({
        novel,
        chapter,
        volume: structure.volumes.find((item) => item.id === chapter.volumeId),
        scenes: structure.scenes.filter(
          (item) => item.chapterId === chapter.id,
        ),
        bible,
        entities,
        timeline: timeline.filter(
          (item) =>
            !item.chapterId ||
            (chapters.find((value) => value.id === item.chapterId)?.position ??
              Infinity) <= chapter.position,
        ),
        foreshadow,
        characterStates: states,
        recentChapters: chapters
          .filter(
            (item) => item.position < chapter.position && item.content.trim(),
          )
          .slice(-2),
        inputBudget: Math.max(4000, profile.contextWindow - output),
        outputTokensReserved: output,
        namePoolHint: pool.usedNames.length ? namePoolText(pool) : undefined,
      });
      await this.database.saveContextSnapshot(current.novelId, pack);
      await this.database.updateGenerationJob(job.id, "generating");
      const result = await streamOpenAICompatible(
        profile,
        apiKey,
        pack.renderedText,
        output,
        0.8,
        () => {},
        fetch,
        signal,
        current.policy.deepThinking ? "enabled" : "disabled",
      );
      const inputTokens =
          result.inputTokens || estimateTokens(pack.renderedText),
        outputTokens = result.outputTokens || estimateTokens(result.content);
      const candidate = await this.database.createChapterCandidate({
        novelId: current.novelId,
        chapterId: chapter.id,
        profileId: profile.id,
        contextHash: pack.contentHash,
        content: result.content,
        inputTokens,
        outputTokens,
        cachedTokens: result.cachedTokens,
      });
      await this.database.saveFindings(
        candidate.id,
        chapter.id,
        checkCandidateQuality({
          chapter,
          content: candidate.content,
          scenes: structure.scenes.filter(
            (item) => item.chapterId === chapter.id,
          ),
          entities,
          foreshadow,
        }),
      );
      await this.recordUsage(current, profile, chapter.id, "generation", {
        inputTokens,
        outputTokens,
        cachedTokens: result.cachedTokens,
        measured: Boolean(result.inputTokens || result.outputTokens),
      });
      if (current.policy.continuityCheck) {
        const extraction = await this.runAncillaryCall(
          profile,
          apiKey,
          factExtractionPrompt(candidate.content),
          1800,
          signal,
        );
        if (extraction) {
          const proposals = safeParseProposals(extraction.content);
          if (proposals)
            await this.database.saveFactProposals(
              candidate.id,
              chapter.id,
              proposals,
            );
          await this.recordUsage(
            current,
            profile,
            chapter.id,
            "continuity_check",
            {
              inputTokens:
                extraction.inputTokens || estimateTokens(candidate.content),
              outputTokens:
                extraction.outputTokens || estimateTokens(extraction.content),
              cachedTokens: extraction.cachedTokens,
              measured: Boolean(
                extraction.inputTokens || extraction.outputTokens,
              ),
            },
          );
        }
      }
      if (current.policy.approvalMode === "chapter_review") {
        const review = await this.runAncillaryCall(
          profile,
          apiKey,
          chapterReviewPrompt(chapter.outline || "暂未填写", candidate.content),
          1200,
          signal,
        );
        if (review) {
          const reviewFindings = safeParseReview(review.content);
          if (reviewFindings.length)
            await this.database.saveFindings(
              candidate.id,
              chapter.id,
              reviewFindings,
            );
          await this.recordUsage(
            current,
            profile,
            chapter.id,
            "chapter_review",
            {
              inputTokens:
                review.inputTokens || estimateTokens(candidate.content),
              outputTokens:
                review.outputTokens || estimateTokens(review.content),
              cachedTokens: review.cachedTokens,
              measured: Boolean(review.inputTokens || review.outputTokens),
            },
          );
        }
      }
      await this.database.updateGenerationJob(job.id, "candidate_ready", {
        candidateId: candidate.id,
        inputTokens,
        outputTokens,
      });
    } catch (error) {
      if (signal.aborted) {
        await this.database.updateGenerationJob(job.id, "paused", {
          error: "用户暂停",
        });
        return;
      }
      const attempt = job.attempt + 1,
        status =
          attempt <= current.policy.maxRetries ? "waiting_retry" : "failed";
      await this.database.updateGenerationJob(job.id, status, {
        attempt,
        error: error instanceof Error ? error.message : "生成失败",
      });
    }
  }
}
function safeParseReview(raw: string) {
  try {
    return parseChapterReview(raw);
  } catch {
    return [];
  }
}
function safeParseProposals(raw: string) {
  try {
    return parseFactExtraction(raw);
  } catch {
    // 模型偶发返回非法 JSON 时跳过提案，不影响已生成的候选稿。
    return null;
  }
}

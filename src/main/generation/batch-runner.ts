import {
  approvalGateEnabled,
  retryDelayMs,
  waitForRetry,
  type GenerationBatch,
  type GenerationEvent,
  type GenerationJob,
  type NewGenerationEvent,
} from "@domain/generation";
import {
  buildContextPack,
  estimateTokens,
  selectCharacterStates,
  selectForeshadowThreads,
  selectRecentChapters,
  selectTimelineEvents,
} from "@domain/context-pack";
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
import { ModelRequestError } from "@domain/model-profile";
import { applyStyleTemplate } from "@domain/style-template";
import {
  continuationPrompt,
  mergeContinuation,
} from "@domain/chapter-generation";
import { countCjkWords } from "@domain/novel";

type StreamResult = Awaited<ReturnType<typeof streamOpenAICompatible>>;
type Broadcast = (event: GenerationEvent) => void;

export class BatchRunner {
  private readonly active = new Map<string, AbortController>();
  constructor(
    private readonly database: NovelDatabase,
    private readonly secrets: SecretVault,
    private readonly broadcast: Broadcast = () => {},
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
  private async emit(input: NewGenerationEvent): Promise<void> {
    try {
      const event = await this.database.saveGenerationEvent(input);
      this.broadcast(event);
    } catch {
      // 日志属于增强能力，落库失败不能阻断生成本体。
    }
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
    const gate = approvalGateEnabled(batch.policy);
    await this.emit({
      batchId,
      novelId: batch.novelId,
      chapterId: null,
      stage: "batch_started",
      level: "info",
      message: `批次启动：第 ${batch.policy.startChapter}–${batch.policy.endChapter} 章，模型 ${profile.modelId}${gate ? "，单章审批制（每章确认后才写下一章）" : ""}`,
      data: {
        model: profile.modelId,
        provider: profile.provider,
        approvalGate: gate,
        outputTokenBudget: batch.policy.outputTokenBudget,
      },
    });
    // 长篇默认使用上一章候选链；同一本书必须串行，避免后章越过前章。
    const limit = 1;
    const inFlight = new Map<string, Promise<void>>();
    while (!controller.signal.aborted) {
      const current = await this.database.getGenerationBatch(batchId);
      if (!current || current.status !== "running") break;
      const jobs = await this.database.listGenerationJobs(batchId);
      if (current.outputTokensUsed >= current.policy.outputTokenBudget) {
        await this.database.setBatchStatus(batchId, "paused");
        await this.emit({
          batchId,
          novelId: current.novelId,
          chapterId: null,
          stage: "batch_paused",
          level: "warning",
          message: `已达到单批输出预算 ${current.policy.outputTokenBudget.toLocaleString()} tokens，安全暂停`,
          data: { outputTokensUsed: current.outputTokensUsed },
        });
        break;
      }
      const sorted = [...jobs].sort((a, b) => a.position - b.position);
      // 审批门：前面的章节全部确认为正史后，才允许生成本章。
      const blockedBy = gate
        ? sorted.find(
            (item) =>
              item.status !== "completed" &&
              sorted.some((later) => later.position > item.position),
          )
        : undefined;
      if (blockedBy && blockedBy.status === "candidate_ready") {
        await this.database.setBatchStatus(batchId, "paused", {
          awaitingReview: true,
        });
        await this.emit({
          batchId,
          novelId: current.novelId,
          chapterId: blockedBy.chapterId,
          stage: "awaiting_review",
          level: "info",
          message: "上一章候选稿尚未确认为正史，已暂停等待审核",
          data: { position: blockedBy.position },
        });
        break;
      }
      const runnable = sorted
        .filter(
          (item) =>
            (item.status === "queued" || item.status === "waiting_retry") &&
            !inFlight.has(item.id),
        )
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
        const failed = jobs.some((item) => item.status === "failed"),
          awaiting = jobs.some((item) => item.status === "candidate_ready");
        if (!failed && gate && awaiting) {
          // 最后一章候选稿尚未确认为正史：停在等待审核，而不是提前完成。
          await this.database.setBatchStatus(batchId, "paused", {
            awaitingReview: true,
          });
          break;
        }
        await this.database.setBatchStatus(
          batchId,
          failed ? "failed" : "completed",
        );
        if (!failed)
          await this.emit({
            batchId,
            novelId: current.novelId,
            chapterId: null,
            stage: "batch_completed",
            level: "success",
            message: "本批任务全部完成",
            data: {
              chapters: jobs.length,
              outputTokensUsed: current.outputTokensUsed,
            },
          });
        break;
      }
      await Promise.race(inFlight.values());
      // 单章审批制：一章候选稿就绪后暂停，等作者改稿、审正史建议再继续。
      if (gate) {
        const after = await this.database.getGenerationBatch(batchId);
        if (!after || after.status !== "running") break;
        const remaining = (await this.database.listGenerationJobs(batchId)).some(
          (item) => item.status === "queued" || item.status === "waiting_retry",
        );
        if (remaining) {
          await this.database.setBatchStatus(batchId, "paused", {
            awaitingReview: true,
          });
          break;
        }
      }
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
    const base = { batchId: current.id, novelId: current.novelId };
    try {
      await this.database.updateGenerationJob(job.id, "building_context", {
        attempt: job.attempt + 1,
        error: "",
      });
      const contextStartAt = Date.now();
      const [
        novel,
        chapter,
        chapters,
        bible,
        entities,
        structure,
        timeline,
        foreshadow,
        allStates,
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
      const positionById = new Map<string, number>(
          chapters.map((item) => [item.id, item.position] as [string, number]),
        ),
        // 只带“截至上一章”的每人最新状态：外貌/衣着/身份/伤势演进不回退。
        states = selectCharacterStates(
          allStates,
          positionById,
          chapter.position,
        ),
        pool = await this.database.getNamePool(
          current.novelId,
          novel.genre,
        );
      await this.emit({
        ...base,
        chapterId: chapter.id,
        stage: "context_build",
        level: "info",
        message: `正在整理第 ${chapter.position} 章上下文（圣经 ${bible.filter((item) => item.content.trim()).length} 份、人物卡 ${entities.filter((item) => item.type === "character").length} 张、时间线 ${timeline.length} 条、伏笔 ${foreshadow.length} 条）`,
        data: { position: chapter.position },
      });
      if (states.length)
        await this.emit({
          ...base,
          chapterId: chapter.id,
          stage: "state_loaded",
          level: "info",
          message: `已载入 ${states.length} 名人物的最新状态（截至第 ${chapter.position - 1} 章）${states
            .filter((item) => item.physical || item.appearance)
            .slice(0, 2)
            .map(
              (item) =>
                `；注意：${item.summary.split("，")[0]}${
                  item.physical ? `身体——${item.physical}` : ""
                }${item.appearance ? `外貌——${item.appearance}` : ""}`,
            )
            .join("")}`,
          data: {
            characters: states.map((item) => item.characterId),
            stateChapterIds: states.map((item) => item.chapterId),
          },
        });
      const chainJobs = (await this.database.listGenerationJobs(current.id))
          .filter((item) => item.position < job.position && item.candidateId)
          .slice(-2),
        candidateChain = (
          await Promise.all(
            chainJobs.map(async (item) => {
              const base = chapters.find(
                  (chapterItem) => chapterItem.id === item.chapterId,
                ),
                candidate = item.candidateId
                  ? await this.database.getChapterCandidate(item.candidateId)
                  : null;
              return base && candidate
                ? {
                    ...base,
                    content: `【本批次候选稿，尚未进入正史】\n${candidate.content}`,
                  }
                : null;
            }),
          )
        ).filter((item): item is NonNullable<typeof item> => item !== null);
      const output = Math.min(
        Math.ceil(current.policy.chapterWords * 1.5),
        profile.contextWindow - 4000,
        current.policy.outputTokenBudget - current.outputTokensUsed,
      );
      if (output < 500) {
        await this.database.setBatchStatus(current.id, "paused");
        return;
      }
      // AN-038 上下文瘦身：开放伏笔按「本章提及优先、埋设最久优先」限量注入，
      // 时间线只带最近发生的事件，防止上下文随章节数线性膨胀。
      const scenes = structure.scenes.filter(
          (item) => item.chapterId === chapter.id,
        ),
        foreshadowContext = selectForeshadowThreads(
          foreshadow,
          positionById,
          chapter.position,
          `${chapter.title}\n${chapter.outline}\n${scenes.map((s) => `${s.title}${s.summary}`).join("\n")}`,
        ),
        timelineContext = selectTimelineEvents(
          timeline,
          positionById,
          chapter.position,
        );
      const pack = buildContextPack({
        novel,
        chapter,
        volume: structure.volumes.find((item) => item.id === chapter.volumeId),
        scenes,
        bible,
        entities,
        timeline: timelineContext,
        foreshadow: foreshadowContext,
        characterStates: states,
        recentChapters: selectRecentChapters(
          chapters,
          chapter.position,
          candidateChain,
        ),
        inputBudget: Math.max(4000, profile.contextWindow - output),
        outputTokensReserved: output,
        namePoolHint: pool.usedNames.length ? namePoolText(pool) : undefined,
        revisionNotes: job.revisionNotes,
      });
      await this.database.saveContextSnapshot(current.novelId, pack);
      await this.emit({
        ...base,
        chapterId: chapter.id,
        stage: "context_build",
        level: "success",
        message: `上下文就绪：约 ${pack.inputTokens.toLocaleString()} tokens（含人物约束与正史状态）`,
        data: {
          position: chapter.position,
          inputTokens: pack.inputTokens,
          durationMs: Date.now() - contextStartAt,
          sources: pack.sources.length,
        },
      });
      await this.database.updateGenerationJob(job.id, "generating");
      await this.emit({
        ...base,
        chapterId: chapter.id,
        stage: "generating",
        level: "info",
        message: `正在生成第 ${chapter.position} 章正文（第 ${job.attempt + 1} 次尝试），目标 ${chapter.targetWords} 字`,
        data: {
          position: chapter.position,
          attempt: job.attempt + 1,
          maxOutputTokens: output,
          model: profile.modelId,
        },
      });
      const generationStartAt = Date.now();
      const styleTemplate = current.policy.styleTemplateId
          ? await this.database.getStyleTemplate(current.policy.styleTemplateId)
          : null;
      if (current.policy.styleTemplateId && !styleTemplate)
        throw new Error("批次使用的文风模板已被删除，请重新创建批次");
      const generationPrompt = applyStyleTemplate(pack.renderedText, styleTemplate),
        result = await streamOpenAICompatible(
        profile,
        apiKey,
        generationPrompt,
        output,
        0.8,
        () => {},
        fetch,
        signal,
        current.policy.deepThinking ? "enabled" : "disabled",
      );
      let inputTokens = result.inputTokens || estimateTokens(generationPrompt),
        outputTokens = result.outputTokens || estimateTokens(result.content);
      let content = result.content;
      // 字数不足（多为 max_tokens 截断）：同一上下文补写一次，不整章重写。
      const wordCount = countCjkWords(content);
      if (content.trim() && wordCount < chapter.targetWords * 0.6) {
        await this.emit({
          ...base,
          chapterId: chapter.id,
          stage: "generating",
          level: "warning",
          message: `字数不足（${wordCount} 字 / 目标 ${chapter.targetWords} 字），正在补写`,
          data: { wordCount, target: chapter.targetWords },
        });
        try {
          const continuation = await streamOpenAICompatible(
            profile,
            apiKey,
            continuationPrompt(
              generationPrompt,
              content,
              chapter.targetWords,
            ),
            output,
            0.8,
            () => {},
            fetch,
            signal,
            "disabled",
          );
          content = mergeContinuation(content, continuation.content);
          inputTokens +=
            continuation.inputTokens || estimateTokens(continuation.content);
          outputTokens +=
            continuation.outputTokens || estimateTokens(continuation.content);
          await this.emit({
            ...base,
            chapterId: chapter.id,
            stage: "candidate_saved",
            level: "success",
            message: `补写完成，本章共 ${countCjkWords(content)} 字`,
            data: {
              wordCount: countCjkWords(content),
              outputTokens:
                continuation.outputTokens ||
                estimateTokens(continuation.content),
            },
          });
        } catch (continueError) {
          if (signal.aborted) throw continueError;
          await this.emit({
            ...base,
            chapterId: chapter.id,
            stage: "generating",
            level: "warning",
            message: `补写失败，保留已生成部分：${continueError instanceof Error ? continueError.message : "未知错误"}`,
            data: {},
          });
        }
      }
      const candidate = await this.database.createChapterCandidate({
        novelId: current.novelId,
        chapterId: chapter.id,
        profileId: profile.id,
        contextHash: pack.contentHash,
        content,
        inputTokens,
        outputTokens,
        cachedTokens: result.cachedTokens,
      });
      await this.emit({
        ...base,
        chapterId: chapter.id,
        stage: "candidate_saved",
        level: "success",
        message: `第 ${chapter.position} 章候选稿已保存：${candidate.wordCount} 字，输出 ${outputTokens.toLocaleString()} tokens`,
        data: {
          candidateId: candidate.id,
          wordCount: candidate.wordCount,
          inputTokens,
          outputTokens,
          cachedTokens: result.cachedTokens,
          durationMs: Date.now() - generationStartAt,
          model: profile.modelId,
        },
      });
      const qualityFindings = checkCandidateQuality({
        chapter,
        content: candidate.content,
        scenes: structure.scenes.filter(
          (item) => item.chapterId === chapter.id,
        ),
        entities,
        foreshadow,
      });
      await this.database.saveFindings(
        candidate.id,
        chapter.id,
        qualityFindings,
      );
      await this.emit({
        ...base,
        chapterId: chapter.id,
        stage: "quality_check",
        level: qualityFindings.length ? "warning" : "success",
        message: qualityFindings.length
          ? `发现 ${qualityFindings.length} 项可能的质量/连续性问题（${qualityFindings
              .slice(0, 2)
              .map((item) => item.message)
              .join("；")}）`
          : "质量检查通过，未发现问题",
        data: {
          findings: qualityFindings.map((item) => ({
            severity: item.severity,
            category: item.category,
            message: item.message,
          })),
        },
      });
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
          const counts = proposals
            ? {
                timeline: proposals.filter(
                  (item) => item.kind === "timeline",
                ).length,
                character_state: proposals.filter(
                  (item) => item.kind === "character_state",
                ).length,
                foreshadow: proposals.filter(
                  (item) => item.kind === "foreshadow",
                ).length,
              }
            : null;
          await this.emit({
            ...base,
            chapterId: chapter.id,
            stage: "fact_extraction",
            level: proposals ? "success" : "warning",
            message: proposals
              ? `已提取 ${proposals.length} 条正史建议（时间线 ${counts!.timeline}、角色状态 ${counts!.character_state}、伏笔 ${counts!.foreshadow}），请在审阅候选稿时一并处理`
              : "正史建议提取失败（模型未返回合法 JSON），不影响候选稿",
            data: { proposals: proposals?.length ?? 0 },
          });
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
          await this.emit({
            ...base,
            chapterId: chapter.id,
            stage: "chapter_review",
            level: reviewFindings.length ? "warning" : "success",
            message: reviewFindings.length
              ? `AI 审查发现 ${reviewFindings.length} 项问题`
              : "AI 审查通过，未发现问题",
            data: {
              findings: reviewFindings.map((item) => item.message),
            },
          });
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
      await this.emit({
        ...base,
        chapterId: chapter.id,
        stage: "awaiting_review",
        level: "info",
        message: `第 ${chapter.position} 章已可浏览/编辑。接受候选稿并处理正史建议后，点击“继续生成下一章”`,
        data: { position: chapter.position, candidateId: candidate.id },
      });
    } catch (error) {
      if (signal.aborted) {
        await this.database.updateGenerationJob(job.id, "paused", {
          error: "用户暂停",
        });
        return;
      }
      const attempt = job.attempt + 1,
        retryable =
          !(error instanceof ModelRequestError) || error.retryable === true,
        status =
          retryable && attempt <= current.policy.maxRetries
            ? "waiting_retry"
            : "failed";
      const message = error instanceof Error ? error.message : "生成失败";
      await this.database.updateGenerationJob(job.id, status, {
        attempt,
        error: message,
      });
      await this.emit({
        ...base,
        chapterId: job.chapterId,
        stage: status === "waiting_retry" ? "retry" : "failed",
        level: status === "waiting_retry" ? "warning" : "error",
        message:
          status === "waiting_retry"
            ? `第 ${attempt} 次尝试失败，稍后自动重试：${message}`
            : `生成失败（已重试 ${attempt - 1} 次）：${message}`,
        data: {
          attempt,
          error: message,
          code: error instanceof ModelRequestError ? error.status : null,
        },
      });
      if (status === "waiting_retry") {
        const retryAfter =
            error instanceof ModelRequestError ? error.retryAfterMs : null,
          resumed = await waitForRetry(
            retryDelayMs(attempt, retryAfter),
            signal,
          );
        await this.database.updateGenerationJob(job.id, resumed ? "queued" : "paused", resumed ? {} : { error: "用户暂停" });
      }
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

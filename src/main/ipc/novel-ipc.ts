import { app, BrowserWindow, type IpcMain } from "electron";
import type {
  CreateChapterInput,
  CreateNovelInput,
  SaveChapterInput,
  UpdateChapterPlanInput,
} from "@domain/novel";
import type { SaveSceneInput, SaveVolumeInput } from "@domain/story-structure";
import type { ContextPack } from "@domain/context-pack";
import type { SaveUsageInput } from "@domain/usage";
import type { SaveModelProfileInput } from "@domain/model-profile";
import type { SecretVault } from "../security/secret-vault";
import { testOpenAICompatible } from "../model/openai-compatible";
import { streamOpenAICompatible } from "../model/openai-compatible";
import type {
  ContinueChapterInput,
  GenerateChapterInput,
  GenerationProgress,
} from "@domain/chapter-generation";
import { estimateTokens } from "@domain/context-pack";
import { BatchRunner } from "../generation/batch-runner";
import type { FactProposal, StoredFinding } from "@domain/quality-check";
import type {
  GenerationBatch,
  GenerationEvent,
  GenerationJob,
  GenerationJobStatus,
  GenerationPolicy,
} from "@domain/generation";
import {
  candidateReviewComplete,
  pendingFactProposalCount,
} from "@domain/generation";
import { IPC_CHANNELS } from "@shared/ipc-contract";
import type { NovelDatabase } from "../db/database";
import type {
  SaveBibleSectionInput,
  SaveStoryEntityInput,
  StoryEntityType,
} from "@domain/story-bible";
import type {
  SaveCharacterStateInput,
  SaveForeshadowInput,
  SaveTimelineEventInput,
} from "@domain/continuity";
import { parseNovelProject } from "@domain/project-export";
import {
  novelPlanningPrompt,
  planningMaxOutputTokens,
  type PlanRange,
  type PlanPhase,
} from "@domain/planning";
import type { SavePlanningCycleInput } from "@domain/planning-cycle";
import { namePoolText } from "@domain/name-pool";
import {
  parseScopeAdvice,
  scopeAdvisoryMaxOutputTokens,
  scopeAdvisoryPrompt,
} from "@domain/scope-advisor";
import {
  briefDraftingMaxOutputTokens,
  briefDraftingPrompt,
  parseBriefDraft,
} from "@domain/brief-drafting";
import type { PlanningWorkflow } from "@domain/planning-workflow";
import {
  applyNovelPlan,
  validateNovelPlanContent,
} from "@application/apply-novel-plan";
import { repairPlanningContentOnce } from "@application/repair-planning-content";
import { reviewPlanningProposal } from "@application/review-planning-proposal";
import type { PlanningProposalStatus } from "@domain/planning-proposal";
import {
  GLOBAL_REVIEW_CYCLE_ID,
  globalReviewPrompt,
  parseGlobalReview,
  type GlobalFinding,
} from "@domain/global-consistency";
import { runWholeBookReview } from "@application/whole-book-review-runner";
import type {
  CreateWorkflowRunInput,
  UpdateWorkflowRunInput,
} from "@domain/workflow-run";
import {
  applyStyleTemplate,
  parseStyleAnalysis,
  styleAnalysisPrompt,
  type AnalyzeStyleTemplateInput,
  type SaveStyleTemplateInput,
} from "@domain/style-template";
import {
  parsePersonaRecommendation,
  personaRecommendationMaxOutputTokens,
  personaRecommendationPrompt,
} from "@domain/persona-recommendation";
import { validateIpcArgs } from "./ipc-guard";
import { IPC_WRITE_GUARDS } from "./ipc-write-guards";

export function registerNovelIpc(
  rawIpc: IpcMain,
  database: NovelDatabase,
  secrets: SecretVault,
): void {
  // AN-012 信任边界：所有 invoke 参数先过写通道守卫表，再进 handler。
  // 校验失败以 rejected promise 返回渲染层；不记录参数值（可能含密钥）。
  const ipc = {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      rawIpc.handle(channel, (_event, ...args: unknown[]) => {
        const guards = IPC_WRITE_GUARDS[channel];
        if (guards) validateIpcArgs(channel, guards, args);
        return handler(_event, ...args);
      }),
  } as unknown as IpcMain;
  const activeGenerations = new Map<string, AbortController>();
  // 生成过程事件：先落库（harness 可回溯），再广播给所有渲染窗口。
  const broadcastEvent = (event: GenerationEvent) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(IPC_CHANNELS.generationEvent, event);
  };
  const batchRunner = new BatchRunner(database, secrets, broadcastEvent);
  const finalizeAcceptedCandidate = async (candidateId: string) => {
    const candidate = await database.getChapterCandidate(candidateId),
      proposals = await database.listFactProposals(candidateId),
      pending = pendingFactProposalCount(proposals),
      job = await findJobByCandidate(database, candidateId);
    if (
      candidate &&
      candidateReviewComplete(candidate.status, proposals) &&
      job?.status === "candidate_ready"
    )
      await database.completeJobByCandidate(candidateId);
    return { candidate, pending, job };
  };
  ipc.handle(IPC_CHANNELS.listNovels, () => database.listNovels());
  ipc.handle(IPC_CHANNELS.deleteNovel, (_event, id: string) =>
    database.deleteNovel(id),
  );
  ipc.handle(IPC_CHANNELS.getDiagnostics, async () => ({
    generatedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    host: "electron" as const,
    platform: `${process.platform}-${process.arch}`,
    runtime: {
      electron: process.versions.electron,
      node: process.versions.node,
      chrome: process.versions.chrome,
    },
    database: "ok" as const,
    novelCount: (await database.listNovels()).length,
  }));
  ipc.handle(IPC_CHANNELS.suggestNovelScope, async (_event, input: {
    title: string;
    genre: string;
    premise: string;
    notes?: string;
  }) => {
    const profiles = await database.listModelProfiles(),
      profile = profiles.find((item) => item.isDefault) ?? profiles[0];
    if (!profile) throw new Error("请先在设置页配置默认写作模型");
    const prompt = scopeAdvisoryPrompt(input);
    const result = await streamOpenAICompatible(
      profile,
      await secrets.get(profile.id),
      prompt,
      scopeAdvisoryMaxOutputTokens(),
      0.5,
      () => {},
      fetch,
      AbortSignal.timeout(120_000),
      "disabled",
    );
    return parseScopeAdvice(result.content);
  });
  ipc.handle(IPC_CHANNELS.suggestPlanningBrief, async (_event, input: {
    title: string;
    genre: string;
    premise: string;
    notes?: string;
  }) => {
    const profiles = await database.listModelProfiles(),
      profile = profiles.find((item) => item.isDefault) ?? profiles[0];
    if (!profile) throw new Error("请先在设置页配置默认写作模型");
    const prompt = briefDraftingPrompt(input);
    const result = await streamOpenAICompatible(
      profile,
      await secrets.get(profile.id),
      prompt,
      briefDraftingMaxOutputTokens(),
      0.7,
      () => {},
      fetch,
      AbortSignal.timeout(120_000),
      "disabled",
    );
    return parseBriefDraft(result.content);
  });
  ipc.handle(IPC_CHANNELS.suggestPersonaLineup, async (_event, novelId: string) => {
    const novel = await database.getNovel(novelId);
    if (!novel) throw new Error("作品不存在");
    const profiles = await database.listModelProfiles(),
      profile = profiles.find((item) => item.isDefault) ?? profiles[0];
    if (!profile) throw new Error("请先在设置页配置默认写作模型");
    const [bible, characters] = await Promise.all([
      database.listBibleSections(novelId),
      database.listStoryEntities(novelId),
    ]);
    const prompt = personaRecommendationPrompt({ novel, bible, characters });
    const result = await streamOpenAICompatible(
      profile,
      await secrets.get(profile.id),
      prompt,
      personaRecommendationMaxOutputTokens(),
      0.6,
      () => {},
      fetch,
      AbortSignal.timeout(180_000),
      "disabled",
    );
    return parsePersonaRecommendation(result.content, characters);
  });
  ipc.handle(IPC_CHANNELS.importNovelProject, (_event, value: unknown) =>
    database.importNovelProject(parseNovelProject(value)),
  );
  ipc.handle(IPC_CHANNELS.createNovel, (_event, input: CreateNovelInput) =>
    database.createNovel(input),
  );
  ipc.handle(
    IPC_CHANNELS.updateNovelSettings,
    (_event, novelId: string, patch: { cycleSize: number }) =>
      database.updateCycleSize(novelId, patch.cycleSize),
  );
  ipc.handle(IPC_CHANNELS.getPlanningWorkflow, (_event, novelId: string) =>
    database.getPlanningWorkflow(novelId),
  );
  ipc.handle(
    IPC_CHANNELS.savePlanningWorkflow,
    (_event, workflow: PlanningWorkflow) =>
      database.savePlanningWorkflow(workflow),
  );
  ipc.handle(
    IPC_CHANNELS.generateNovelPlan,
    async (
      _event,
      novelId: string,
      phase: PlanPhase,
      range?: PlanRange,
    ) => {
      const novel = await database.getNovel(novelId);
      if (!novel) throw new Error("作品不存在");
      const profiles = await database.listModelProfiles(),
        profile = profiles.find((item) => item.isDefault) ?? profiles[0];
      if (!profile) throw new Error("请先在设置页配置默认写作模型");
      const apiKey = await secrets.get(profile.id);
      const bible = await database.listBibleSections(novelId);
      const workflow = await database.getPlanningWorkflow(novelId);
      const entities = await database.listStoryEntities(novelId);
      const chapters = await database.listChapters(novelId);
      const namePool = await database.getNamePool(novelId, novel.genre);
      const rollingMemory =
        phase === "structure" && range
          ? await Promise.all([
              database.listPlanningCycles(novelId),
              database.listCharacterStates(novelId),
              database.listTimelineEvents(novelId),
              database.listForeshadowThreads(novelId),
            ]).then(([cycles, characterStates, timeline, foreshadow]) => ({
              cycles,
              characterStates,
              timeline,
              foreshadow,
            }))
          : undefined;
      // 规划过程事件走同一通道：向导页忙碌弹层实时显示 Amy 正在做什么。
      const planEventId = `planning:${novelId}`;
      const emitPlan = async (
        stage: "plan_started" | "context_build" | "generating" | "plan_received" | "plan_applied" | "retry" | "failed" | "batch_completed",
        level: "info" | "success" | "warning" | "error",
        message: string,
        data: Record<string, unknown> = {},
      ) => {
        try {
          broadcastEvent(
            await database.saveGenerationEvent({
              batchId: planEventId,
              novelId,
              chapterId: null,
              stage,
              level,
              message,
              data: { phase, ...data },
            }),
          );
        } catch {
          // 过程事件失败不影响规划本体。
        }
      };
      const phaseLabel: Record<PlanPhase, string> = {
        bible: "故事圣经",
        structure: "当前批次策划包",
        cast: "人物体系",
        scenes: "场景与实体",
      };
      await emitPlan(
        "plan_started",
        "info",
        `开始生成${phaseLabel[phase]}：读取设定（圣经 ${bible.filter((item) => item.content.trim()).length} 份、实体 ${entities.length} 张、章节 ${chapters.length} 章）`,
      );
      const prompt = novelPlanningPrompt({
        phase,
        novel,
        bible,
        brief: workflow.brief,
        entities,
        chapters,
        range,
        rollingMemory,
        namePoolText: namePoolText(namePool),
      });
      const run = await database.startPlanningRun({
        novelId,
        phase,
        startChapter: range?.startChapter,
        endChapter: range?.endChapter,
        profileId: profile.id,
        provider: profile.provider,
        model: profile.modelId,
        prompt,
      });
      try {
        await emitPlan(
          "context_build",
          "info",
          `提示已构建（约 ${estimateTokens(prompt).toLocaleString()} tokens，模型 ${profile.modelId}）`,
          { inputTokens: estimateTokens(prompt), model: profile.modelId },
        );
        // 规划是结构化输出任务，关闭思考以获得稳定 JSON 并节省 token。
        const result = await streamOpenAICompatible(
            profile,
            apiKey,
            prompt,
            planningMaxOutputTokens(phase),
            0.7,
            () => {},
            fetch,
            AbortSignal.timeout(300_000),
            "disabled",
          ),
          inputTokens = result.inputTokens || estimateTokens(prompt),
          outputTokens = result.outputTokens || estimateTokens(result.content);
        await emitPlan(
          "plan_received",
          "info",
          `模型已返回 ${result.content.length.toLocaleString()} 字，正在解析并写入`,
          { outputTokens },
        );
        // 原始响应先落库，后续解析失败也能检查并重新解析，无需再次调用模型。
        await database.recordPlanningResponse(run.id, {
          rawResponse: result.content,
          inputTokens,
          outputTokens,
          cachedTokens: result.cachedTokens,
        });
        await database.saveUsage({
          novelId,
          chapterId: null,
          operation: "planning",
          provider: profile.provider,
          model: profile.modelId,
          inputTokens,
          outputTokens,
          cachedTokens: result.cachedTokens,
          cost: null,
          measurement:
            result.inputTokens || result.outputTokens ? "provider" : "estimated",
        });
        const resolved = await repairPlanningContentOnce({
          phase,
          content: result.content,
          validate: (content) =>
            validateNovelPlanContent({
              phase,
              content,
              targetChapters: novel.targetChapters,
              range,
            }),
          repair: async (repairPrompt) => {
            await emitPlan(
              "retry",
              "warning",
              "规划 JSON 解析失败，正在执行一次低温结构修复",
            );
            const repaired = await streamOpenAICompatible(
                profile,
                apiKey,
                repairPrompt,
                planningMaxOutputTokens(phase),
                0.1,
                () => {},
                fetch,
                AbortSignal.timeout(300_000),
                "disabled",
              ),
              repairInputTokens =
                repaired.inputTokens || estimateTokens(repairPrompt),
              repairOutputTokens =
                repaired.outputTokens || estimateTokens(repaired.content);
            await database.recordPlanningRepair(run.id, {
              repairResponse: repaired.content,
              inputTokens: repairInputTokens,
              outputTokens: repairOutputTokens,
              cachedTokens: repaired.cachedTokens,
            });
            await database.saveUsage({
              novelId,
              chapterId: null,
              operation: "planning",
              provider: profile.provider,
              model: profile.modelId,
              inputTokens: repairInputTokens,
              outputTokens: repairOutputTokens,
              cachedTokens: repaired.cachedTokens,
              cost: null,
              measurement:
                repaired.inputTokens || repaired.outputTokens
                  ? "provider"
                  : "estimated",
            });
            return repaired.content;
          },
        });
        const summary = await applyNovelPlan({
          novel,
          phase,
          content: resolved.content,
          entities,
          namePool,
          range,
          store: database,
        });
        await database.completePlanningRun(run.id);
        await emitPlan(
          "plan_applied",
          "success",
          `已写入正史草稿：${summary.sections} 份文档、${summary.entities} 张实体卡、${summary.chapters} 个章节策划`,
          { sections: summary.sections, entities: summary.entities, chapters: summary.chapters },
        );
        await emitPlan("batch_completed", "success", `${phaseLabel[phase]}生成完成，请回到页面审核`, {});
        return summary;
      } catch (error) {
        await database.failPlanningRun(
          run.id,
          error instanceof Error ? error.message : "规划生成失败",
        );
        await emitPlan(
          "failed",
          "error",
          `生成失败：${error instanceof Error ? error.message : "未知错误"}`,
          { error: error instanceof Error ? error.message : "unknown" },
        );
        throw error;
      }
    },
  );
  ipc.handle(IPC_CHANNELS.listPlanningRuns, (_event, novelId: string) =>
    database.listPlanningRuns(novelId),
  );
  ipc.handle(IPC_CHANNELS.listPlanningCycles, (_event, novelId: string) =>
    database.listPlanningCycles(novelId),
  );
  ipc.handle(
    IPC_CHANNELS.savePlanningCycle,
    (_event, input: SavePlanningCycleInput) => database.savePlanningCycle(input),
  );
  ipc.handle(IPC_CHANNELS.listPlanningProposals, (_event, novelId: string) =>
    database.listPlanningProposals(novelId),
  );
  ipc.handle(
    IPC_CHANNELS.createWorkflowRun,
    (_event, input: CreateWorkflowRunInput) => database.createWorkflowRun(input),
  );
  ipc.handle(
    IPC_CHANNELS.updateWorkflowRun,
    (_event, input: UpdateWorkflowRunInput) => database.updateWorkflowRun(input),
  );
  ipc.handle(IPC_CHANNELS.listWorkflowRuns, (_event, novelId: string) =>
    database.listWorkflowRuns(novelId),
  );
  ipc.handle(
    IPC_CHANNELS.reviewPlanningProposal,
    (
      _event,
      novelId: string,
      proposalId: string,
      status: Exclude<PlanningProposalStatus, "pending">,
    ) => reviewPlanningProposal(database, novelId, proposalId, status),
  );
  ipc.handle(IPC_CHANNELS.listGlobalFindings, (_event, novelId: string) =>
    database.listGlobalFindings(novelId),
  );
  ipc.handle(
    IPC_CHANNELS.saveGlobalFindings,
    (_event, novelId: string, findings: GlobalFinding[]) =>
      database.saveGlobalFindings(novelId, findings),
  );
  ipc.handle(
    IPC_CHANNELS.reviewGlobalConsistency,
    async (_event, novelId: string) => {
      const novel = await database.getNovel(novelId);
      if (!novel) throw new Error("作品不存在");
      const profiles = await database.listModelProfiles(),
        profile = profiles.find((item) => item.isDefault) ?? profiles[0];
      if (!profile) throw new Error("请先在设置页配置默认写作模型");
      const batchId = `global-review:${novelId}`;
      const emitReview = async (
        level: "info" | "success" | "warning" | "error",
        message: string,
        data: Record<string, unknown> = {},
      ) => {
        try {
          broadcastEvent(
            await database.saveGenerationEvent({
              batchId,
              novelId,
              chapterId: null,
              stage: "global_review",
              level,
              message,
              data,
            }),
          );
        } catch {
          // 过程事件失败不影响审查本体。
        }
      };
      try {
        const [bible, entities, chapters, characterStates, timeline, foreshadow] =
          await Promise.all([
            database.listBibleSections(novelId),
            database.listStoryEntities(novelId),
            database.listChapters(novelId),
            database.listCharacterStates(novelId),
            database.listTimelineEvents(novelId),
            database.listForeshadowThreads(novelId),
          ]);
        const accepted = chapters
          .filter((item) => item.status === "accepted" && item.content.trim())
          .sort((a, b) => a.position - b.position);
        const prompt = globalReviewPrompt({
          novelTitle: novel.title,
          genre: novel.genre,
          bible: bible.map((item) => ({
            title: item.title,
            content: item.content,
          })),
          entities,
          chapters: accepted,
          characterStates,
          timeline,
          foreshadow,
          recentContents: accepted.slice(-2).map((item) => ({
            position: item.position,
            title: item.title,
            content: item.content,
          })),
          inputBudget: Math.max(4000, profile.contextWindow - 4000),
        });
        await emitReview(
          "info",
          `全局一致性审查开始（约 ${estimateTokens(prompt).toLocaleString()} tokens，模型 ${profile.modelId}）`,
          { inputTokens: estimateTokens(prompt), model: profile.modelId },
        );
        const result = await streamOpenAICompatible(
          profile,
          await secrets.get(profile.id),
          prompt,
          4000,
          0.3,
          () => {},
          fetch,
          AbortSignal.timeout(300_000),
          "disabled",
        );
        const outcome = parseGlobalReview(result.content, { novelId });
        // AI 发现替换上一轮；忽略状态按稳定 id 延续，规则发现原样保留。
        const previous = await database.listGlobalFindings(novelId),
          dismissed = new Set(
            previous
              .filter(
                (item) => item.source === "ai" && item.status === "dismissed",
              )
              .map((item) => item.id),
          ),
          aiFindings = outcome.findings.map((item) => ({
            ...item,
            status: dismissed.has(item.id)
              ? ("dismissed" as const)
              : item.status,
          })),
          merged = [
            // AI 发现替换上一轮 AI 发现；作者疑点标记（source=author）与规则发现保留。
            ...previous.filter((item) => item.source !== "ai"),
            ...aiFindings,
          ];
        await database.saveGlobalFindings(novelId, merged);
        const proposals = await database.addPlanningProposals(
          novelId,
          GLOBAL_REVIEW_CYCLE_ID,
          1,
          accepted.at(-1)?.position ?? 1,
          outcome.proposals,
        );
        await database.saveUsage({
          novelId,
          chapterId: null,
          operation: "global_review",
          provider: profile.provider,
          model: profile.modelId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cachedTokens: result.cachedTokens,
          cost: null,
          measurement: result.inputTokens ? "provider" : "estimated",
        });
        await emitReview(
          outcome.findings.some((item) => item.severity === "error")
            ? "warning"
            : "success",
          outcome.findings.length
            ? `全局审查发现 ${outcome.findings.length} 项问题，${proposals.length} 项设定修复提案`
            : "全局审查通过，未发现问题",
          {
            summary: outcome.summary,
            findings: outcome.findings.map((item) => item.message),
            proposals: proposals.length,
          },
        );
        return { summary: outcome.summary, findings: aiFindings, proposals };
      } catch (error) {
        await emitReview(
          "error",
          `全局一致性审查失败：${error instanceof Error ? error.message : "未知错误"}`,
        );
        throw error;
      }
    },
  );
  // AN-032：全书分窗口通读审稿（顺序窗口 + 滚动摘要），编排共享
  // Application runner（whole-book-review-runner），与 Web 端同一装配语义。
  ipc.handle(
    IPC_CHANNELS.reviewWholeBook,
    async (_event, novelId: string, windowSize?: number) => {
      const novel = await database.getNovel(novelId);
      if (!novel) throw new Error("作品不存在");
      const profiles = await database.listModelProfiles(),
        profile = profiles.find((item) => item.isDefault) ?? profiles[0];
      if (!profile) throw new Error("请先在设置页配置默认写作模型");
      return runWholeBookReview(
        novelId,
        windowSize ? { windowSize } : undefined,
        {
          novel,
          profile,
          listChapters: (id) => database.listChapters(id),
          listStoryEntities: (id) => database.listStoryEntities(id),
          listCharacterStates: (id) => database.listCharacterStates(id),
          listTimelineEvents: (id) => database.listTimelineEvents(id),
          listForeshadowThreads: (id) => database.listForeshadowThreads(id),
          listGlobalFindings: (id) => database.listGlobalFindings(id),
          saveGlobalFindings: (id, findings) =>
            database.saveGlobalFindings(id, findings),
          saveUsage: (input) => database.saveUsage(input),
          saveGenerationEvent: async (event) => {
            broadcastEvent(await database.saveGenerationEvent(event));
          },
          callModel: async (prompt) => {
            const result = await streamOpenAICompatible(
              profile,
              await secrets.get(profile.id),
              prompt,
              3000,
              0.2,
              () => {},
              fetch,
              AbortSignal.timeout(300_000),
              "disabled",
            );
            return {
              content: result.content,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
              cachedTokens: result.cachedTokens,
            };
          },
        },
      );
    },
  );
  ipc.handle(IPC_CHANNELS.listChapters, (_event, novelId: string) =>
    database.listChapters(novelId),
  );
  ipc.handle(IPC_CHANNELS.getChapter, (_event, chapterId: string) =>
    database.getChapter(chapterId),
  );
  ipc.handle(IPC_CHANNELS.saveChapter, (_event, input: SaveChapterInput) =>
    database.saveChapter(input),
  );
  ipc.handle(IPC_CHANNELS.createChapter, (_event, input: CreateChapterInput) =>
    database.createChapter(input),
  );
  ipc.handle(
    IPC_CHANNELS.updateChapterPlan,
    (_event, input: UpdateChapterPlanInput) =>
      database.updateChapterPlan(input),
  );
  ipc.handle(IPC_CHANNELS.deleteChapter, (_event, id: string) =>
    database.deleteChapter(id),
  );
  ipc.handle(
    IPC_CHANNELS.reorderChapters,
    (_event, novelId: string, ids: string[]) =>
      database.reorderChapters(novelId, ids),
  );
  ipc.handle(IPC_CHANNELS.listStoryStructure, (_event, novelId: string) =>
    database.listStoryStructure(novelId),
  );
  ipc.handle(IPC_CHANNELS.saveVolume, (_event, input: SaveVolumeInput) =>
    database.saveVolume(input),
  );
  ipc.handle(IPC_CHANNELS.deleteVolume, (_event, id: string) =>
    database.deleteVolume(id),
  );
  ipc.handle(
    IPC_CHANNELS.reorderVolumes,
    (_event, novelId: string, ids: string[]) =>
      database.reorderVolumes(novelId, ids),
  );
  ipc.handle(IPC_CHANNELS.saveScene, (_event, input: SaveSceneInput) =>
    database.saveScene(input),
  );
  ipc.handle(IPC_CHANNELS.deleteScene, (_event, id: string) =>
    database.deleteScene(id),
  );
  ipc.handle(
    IPC_CHANNELS.reorderScenes,
    (_event, chapterId: string, ids: string[]) =>
      database.reorderScenes(chapterId, ids),
  );
  ipc.handle(
    IPC_CHANNELS.saveContextSnapshot,
    (_event, novelId: string, pack: ContextPack) =>
      database.saveContextSnapshot(novelId, pack),
  );
  ipc.handle(
    IPC_CHANNELS.listContextSnapshots,
    (_event, novelId: string, chapterId?: string) =>
      database.listContextSnapshots(novelId, chapterId),
  );
  ipc.handle(IPC_CHANNELS.saveUsage, (_event, input: SaveUsageInput) =>
    database.saveUsage(input),
  );
  ipc.handle(IPC_CHANNELS.listUsage, (_event, novelId?: string) =>
    database.listUsage(novelId),
  );
  ipc.handle(IPC_CHANNELS.listModelProfiles, () =>
    database.listModelProfiles(),
  );
  ipc.handle(
    IPC_CHANNELS.saveModelProfile,
    async (_event, input: SaveModelProfileInput) => {
      const secret = input.apiKey?.trim();
      const existing = input.id
        ? await database.getModelProfile(input.id)
        : null;
      const profile = await database.saveModelProfile(
        { ...input, apiKey: undefined },
        Boolean(secret) || Boolean(existing?.hasSecret),
      );
      if (secret) await secrets.set(profile.id, secret);
      return profile;
    },
  );
  ipc.handle(IPC_CHANNELS.deleteModelProfile, async (_event, id: string) => {
    await secrets.delete(id);
    await database.deleteModelProfile(id);
  });
  ipc.handle(
    IPC_CHANNELS.testModelConnection,
    async (_event, id: string, temporaryKey?: string) => {
      const profile = await database.getModelProfile(id);
      if (!profile) throw new Error("Model profile not found");
      const key = temporaryKey?.trim() || (await secrets.get(id));
      return testOpenAICompatible(profile, key);
    },
  );
  ipc.handle(IPC_CHANNELS.listStyleTemplates, () =>
    database.listStyleTemplates(),
  );
  ipc.handle(
    IPC_CHANNELS.analyzeStyleTemplate,
    async (_event, input: AnalyzeStyleTemplateInput) => {
      if (input.sampleText.trim().length < 200)
        throw new Error("样章至少需要 200 字，才能可靠提炼文风");
      const profile = await database.getModelProfile(input.profileId);
      if (!profile) throw new Error("Model profile not found");
      const result = await streamOpenAICompatible(
          profile,
          await secrets.get(profile.id),
          styleAnalysisPrompt(input),
          3000,
          0.3,
          () => {},
          fetch,
          AbortSignal.timeout(180_000),
          "disabled",
        ),
        analysis = parseStyleAnalysis(result.content);
      return database.saveStyleTemplate({
        name: input.name?.trim() || analysis.name,
        authorAlias: input.authorAlias?.trim() || analysis.authorAlias,
        sourceTitle: input.sourceTitle?.trim() || "",
        sampleText: input.sampleText,
        contentSummary: analysis.contentSummary,
        styleSummary: analysis.styleSummary,
        styleGuide: analysis.styleGuide,
      });
    },
  );
  ipc.handle(
    IPC_CHANNELS.saveStyleTemplate,
    (_event, input: SaveStyleTemplateInput) => database.saveStyleTemplate(input),
  );
  ipc.handle(IPC_CHANNELS.deleteStyleTemplate, (_event, id: string) =>
    database.deleteStyleTemplate(id),
  );
  ipc.handle(
    IPC_CHANNELS.generateChapter,
    async (event, input: GenerateChapterInput) => {
      const profile = await database.getModelProfile(input.profileId);
      if (!profile) throw new Error("Model profile not found");
      const template = input.styleTemplateId
          ? await database.getStyleTemplate(input.styleTemplateId)
          : null,
        prompt = applyStyleTemplate(input.contextText, template),
        key = await secrets.get(profile.id),
        controller = new AbortController();
      if (input.styleTemplateId && !template)
        throw new Error("所选文风模板已不存在，请重新选择");
      activeGenerations.set(input.requestId, controller);
      const emit = (data: Omit<GenerationProgress, "requestId">) =>
        event.sender.send(IPC_CHANNELS.generationProgress, {
          requestId: input.requestId,
          ...data,
        });
      try {
        emit({ type: "started" });
        const result = await streamOpenAICompatible(
          profile,
          key,
          prompt,
          input.maxOutputTokens,
          input.temperature,
          (delta) => emit({ type: "delta", delta }),
          fetch,
          controller.signal,
          "disabled",
        );
        const inputTokens =
            result.inputTokens || estimateTokens(prompt),
          outputTokens = result.outputTokens || estimateTokens(result.content);
        emit({
          type: "usage",
          inputTokens,
          outputTokens,
          cachedTokens: result.cachedTokens,
        });
        const candidate = await database.createChapterCandidate({
          novelId: input.novelId,
          chapterId: input.chapterId,
          profileId: profile.id,
          contextHash: input.contextHash,
          content: result.content,
          inputTokens,
          outputTokens,
          cachedTokens: result.cachedTokens,
        });
        const cost =
          profile.inputPricePerMillion === null ||
          profile.outputPricePerMillion === null
            ? null
            : ((inputTokens - result.cachedTokens) *
                profile.inputPricePerMillion +
                outputTokens * profile.outputPricePerMillion) /
              1_000_000;
        await database.saveUsage({
          novelId: input.novelId,
          chapterId: input.chapterId,
          operation: "generation",
          provider: profile.provider,
          model: profile.modelId,
          inputTokens,
          outputTokens,
          cachedTokens: result.cachedTokens,
          cost,
          measurement:
            result.inputTokens || result.outputTokens
              ? "provider"
              : "estimated",
        });
        return candidate;
      } finally {
        activeGenerations.delete(input.requestId);
      }
    },
  );
  ipc.handle(IPC_CHANNELS.cancelGeneration, (_event, requestId: string) => {
    activeGenerations.get(requestId)?.abort();
  });
  ipc.handle(
    IPC_CHANNELS.continueChapter,
    async (_event, input: ContinueChapterInput) => {
      const profile = await database.getModelProfile(input.profileId);
      if (!profile) throw new Error("Model profile not found");
      const result = await streamOpenAICompatible(
        profile,
        await secrets.get(profile.id),
        input.prompt,
        input.maxOutputTokens,
        input.temperature,
        () => {},
        fetch,
        AbortSignal.timeout(300_000),
        "disabled",
      );
      const inputTokens = result.inputTokens || estimateTokens(input.prompt),
        outputTokens =
          result.outputTokens || estimateTokens(result.content);
      await database.saveUsage({
        novelId: input.novelId,
        chapterId: input.chapterId,
        operation: "generation",
        provider: profile.provider,
        model: profile.modelId,
        inputTokens,
        outputTokens,
        cachedTokens: result.cachedTokens,
        cost:
          profile.inputPricePerMillion === null ||
          profile.outputPricePerMillion === null
            ? null
            : ((inputTokens - result.cachedTokens) *
                profile.inputPricePerMillion +
                outputTokens * profile.outputPricePerMillion) /
              1_000_000,
        measurement:
          result.inputTokens || result.outputTokens ? "provider" : "estimated",
      });
      return {
        content: result.content,
        inputTokens,
        outputTokens,
        cachedTokens: result.cachedTokens,
      };
    },
  );
  ipc.handle(IPC_CHANNELS.listChapterCandidates, (_event, chapterId: string) =>
    database.listChapterCandidates(chapterId),
  );
  ipc.handle(
    IPC_CHANNELS.updateChapterCandidateContent,
    (_event, id: string, content: string) =>
      database.updateChapterCandidateContent(id, content),
  );
  ipc.handle(
    IPC_CHANNELS.acceptChapterCandidate,
    async (_event, id: string) => {
      const candidate = await database.setCandidateStatus(id, "accepted");
      const { pending, job: batchJob } = await finalizeAcceptedCandidate(id);
      if (batchJob) {
        const event = await database.saveGenerationEvent({
          batchId: batchJob.batchId,
          novelId: candidate.novelId,
          chapterId: candidate.chapterId,
          stage: "chapter_accepted",
          level: "success",
          message: pending
            ? `候选稿已写入正史；处理完 ${pending} 条正史建议后才能继续下一章`
            : "候选稿及正史建议均已处理，可以继续生成下一章",
          data: { candidateId: id, position: batchJob.position, pendingProposals: pending },
        });
        broadcastEvent(event);
      }
      return candidate;
    },
  );
  ipc.handle(IPC_CHANNELS.rejectChapterCandidate, (_event, id: string) =>
    database.setCandidateStatus(id, "rejected"),
  );
  ipc.handle(IPC_CHANNELS.listFindings, (_event, id: string) =>
    database.listFindings(id),
  );
  ipc.handle(
    IPC_CHANNELS.updateFinding,
    (_event, id: string, status: StoredFinding["status"]) =>
      database.updateFinding(id, status),
  );
  ipc.handle(IPC_CHANNELS.listFactProposals, (_event, id: string) =>
    database.listFactProposals(id),
  );
  ipc.handle(
    IPC_CHANNELS.updateFactProposal,
    async (_event, id: string, status: FactProposal["status"]) => {
      const proposal = await database.updateFactProposal(id, status),
        { candidate, pending, job } = await finalizeAcceptedCandidate(
          proposal.candidateId,
        );
      if (
        candidate?.status === "accepted" &&
        !pending &&
        job?.status === "candidate_ready"
      ) {
        const event = await database.saveGenerationEvent({
          batchId: job.batchId,
          novelId: candidate.novelId,
          chapterId: proposal.chapterId,
          stage: "chapter_accepted",
          level: "success",
          message: "本章正史建议已全部处理，可以继续生成下一章",
          data: { candidateId: proposal.candidateId, position: job.position },
        });
        broadcastEvent(event);
      }
      return proposal;
    },
  );
  ipc.handle(IPC_CHANNELS.listChapterVersions, (_event, chapterId: string) =>
    database.listChapterVersions(chapterId),
  );
  ipc.handle(IPC_CHANNELS.createChapterSnapshot, (_event, chapterId: string) =>
    database.createChapterSnapshot(chapterId),
  );
  ipc.handle(IPC_CHANNELS.listBibleSections, (_event, novelId: string) =>
    database.listBibleSections(novelId),
  );
  ipc.handle(
    IPC_CHANNELS.saveBibleSection,
    (_event, input: SaveBibleSectionInput) => database.saveBibleSection(input),
  );
  ipc.handle(
    IPC_CHANNELS.listStoryEntities,
    (_event, novelId: string, type?: StoryEntityType) =>
      database.listStoryEntities(novelId, type),
  );
  ipc.handle(
    IPC_CHANNELS.saveStoryEntity,
    (_event, input: SaveStoryEntityInput) => database.saveStoryEntity(input),
  );
  ipc.handle(IPC_CHANNELS.deleteStoryEntity, (_event, entityId: string) =>
    database.deleteStoryEntity(entityId),
  );
  ipc.handle(IPC_CHANNELS.listTimelineEvents, (_event, novelId: string) =>
    database.listTimelineEvents(novelId),
  );
  ipc.handle(
    IPC_CHANNELS.saveTimelineEvent,
    (_event, input: SaveTimelineEventInput) =>
      database.saveTimelineEvent(input),
  );
  ipc.handle(IPC_CHANNELS.deleteTimelineEvent, (_event, id: string) =>
    database.deleteTimelineEvent(id),
  );
  ipc.handle(IPC_CHANNELS.listForeshadowThreads, (_event, novelId: string) =>
    database.listForeshadowThreads(novelId),
  );
  ipc.handle(
    IPC_CHANNELS.saveForeshadowThread,
    (_event, input: SaveForeshadowInput) =>
      database.saveForeshadowThread(input),
  );
  ipc.handle(IPC_CHANNELS.deleteForeshadowThread, (_event, id: string) =>
    database.deleteForeshadowThread(id),
  );
  ipc.handle(
    IPC_CHANNELS.listCharacterStates,
    (_event, novelId: string, characterId?: string) =>
      database.listCharacterStates(novelId, characterId),
  );
  ipc.handle(
    IPC_CHANNELS.saveCharacterState,
    (_event, input: SaveCharacterStateInput) =>
      database.saveCharacterState(input),
  );
  ipc.handle(IPC_CHANNELS.deleteCharacterState, (_event, id: string) =>
    database.deleteCharacterState(id),
  );
  ipc.handle(
    IPC_CHANNELS.createGenerationDraft,
    (_event, novelId: string, policy: GenerationPolicy) =>
      database.createGenerationBatch(novelId, policy),
  );
  ipc.handle(IPC_CHANNELS.listGenerationBatches, () =>
    database.listGenerationBatches(),
  );
  ipc.handle(IPC_CHANNELS.listGenerationJobs, (_event, id: string) =>
    database.listGenerationJobs(id),
  );
  ipc.handle(
    IPC_CHANNELS.setBatchStatus,
    (
      _event,
      id: string,
      status: GenerationBatch["status"],
      patch?: { awaitingReview?: boolean },
    ) => database.setBatchStatus(id, status, patch),
  );
  ipc.handle(IPC_CHANNELS.deleteGenerationBatch, (_event, id: string) =>
    database.deleteGenerationBatch(id),
  );
  ipc.handle(IPC_CHANNELS.listGenerationEvents, (_event, id: string) =>
    database.listGenerationEvents(id),
  );
  ipc.handle(
    IPC_CHANNELS.updateGenerationJob,
    (
      _event,
      id: string,
      status: GenerationJobStatus,
      patch?: Partial<GenerationJob>,
    ) => database.updateGenerationJob(id, status, patch),
  );
  ipc.handle(IPC_CHANNELS.startBackgroundBatch, (_event, id: string) =>
    batchRunner.start(id),
  );
  ipc.handle(IPC_CHANNELS.pauseBackgroundBatch, (_event, id: string) =>
    batchRunner.pause(id),
  );
}

async function findJobByCandidate(
  database: NovelDatabase,
  candidateId: string,
): Promise<GenerationJob | null> {
  return database.getJobByCandidate(candidateId);
}

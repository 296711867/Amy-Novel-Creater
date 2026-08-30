import { create } from "zustand";
import type {
  Chapter,
  ChapterVersion,
  CreateNovelInput,
  Novel,
  SaveChapterInput,
} from "@domain/novel";
import {
  nextRunnableJob,
  retryDelayMs,
  waitForRetry,
  type GenerationBatch,
  type GenerationJob,
  type GenerationPolicy,
} from "@domain/generation";
import { nanoid } from "nanoid";
import { platform } from "@renderer/platform/web-platform";
import type {
  BibleSection,
  SaveBibleSectionInput,
  SaveStoryEntityInput,
  StoryEntity,
  StoryEntityType,
} from "@domain/story-bible";
import type {
  CharacterState,
  ForeshadowThread,
  SaveCharacterStateInput,
  SaveForeshadowInput,
  SaveTimelineEventInput,
  TimelineEvent,
} from "@domain/continuity";
import type {
  SaveSceneInput,
  SaveVolumeInput,
  StoryScene,
  StoryVolume,
} from "@domain/story-structure";
import type { CreateChapterInput, UpdateChapterPlanInput } from "@domain/novel";
import {
  buildContextPack,
  selectRecentChapters,
  type ContextPack,
} from "@domain/context-pack";
import type { UsageRecord } from "@domain/usage";
import type {
  ModelConnectionResult,
  ModelProfile,
  SaveModelProfileInput,
} from "@domain/model-profile";
import { ModelRequestError } from "@domain/model-profile";
import type {
  ChapterCandidate,
  GenerateChapterInput,
  GenerationProgress,
} from "@domain/chapter-generation";
import type { FactProposal, StoredFinding } from "@domain/quality-check";
import { assertCandidateAcceptedForCanon } from "@domain/quality-check";
import { parseProposalPayload } from "@domain/fact-extraction";
import {
  parseNovelProject,
  type NovelProjectBundle,
} from "@domain/project-export";
import type { ScopeAdvice } from "@domain/scope-advisor";
import type {
  NovelPlanSummary,
  PlanPhase,
  PlanRange,
} from "@domain/planning";
import type { PlanningRun } from "@domain/planning-run";
import type {
  PlanningCycle,
  SavePlanningCycleInput,
} from "@domain/planning-cycle";
import type { PlanningProposal } from "@domain/planning-proposal";
import {
  confirmPlanningStep as confirmWorkflowStep,
  defaultPlanningWorkflow,
  invalidatePlanningFrom as invalidateWorkflowFrom,
  type PlanningBrief,
  type PlanningReviewStep,
  type PlanningWorkflow,
} from "@domain/planning-workflow";

interface NovelState {
  novels: Novel[];
  chapters: Record<string, Chapter[]>;
  versions: Record<string, ChapterVersion[]>;
  bibleSections: Record<string, BibleSection[]>;
  entities: Record<string, StoryEntity[]>;
  timelineEvents: Record<string, TimelineEvent[]>;
  foreshadowThreads: Record<string, ForeshadowThread[]>;
  characterStates: Record<string, CharacterState[]>;
  volumes: Record<string, StoryVolume[]>;
  scenes: Record<string, StoryScene[]>;
  contextPacks: Record<string, ContextPack[]>;
  usage: UsageRecord[];
  modelProfiles: ModelProfile[];
  candidates: Record<string, ChapterCandidate[]>;
  batches: GenerationBatch[];
  jobs: Record<string, GenerationJob[]>;
  findings: Record<string, StoredFinding[]>;
  factProposals: Record<string, FactProposal[]>;
  planningWorkflows: Record<string, PlanningWorkflow>;
  planningRuns: Record<string, PlanningRun[]>;
  planningCycles: Record<string, PlanningCycle[]>;
  planningProposals: Record<string, PlanningProposal[]>;
  /** 进行中的规划阶段（novelId -> phase）；挂在 store 上，切换页面不丢失。 */
  planningBusy: Record<string, PlanPhase | null>;
  /** 最近一次规划的结果或错误文案，供页面重新挂载后回显。 */
  planningMessage: Record<string, string>;
  /** 单章生成中的请求（chapterId -> 请求信息）；防止切页回来重复发起。 */
  activeRequests: Record<string, { requestId: string; startedAt: number }>;
  /** 开书前的篇幅建议（创建页使用，不落库）。 */
  scopeAdvice: ScopeAdvice | null;
  scopeAdviceBusy: boolean;
  scopeAdviceError: string;
  /** 第 1–2 步七项简报的 AI 草稿：切页不丢，作者确认后写入工作流。 */
  draftedBrief: PlanningBrief | null;
  briefDraftBusy: boolean;
  briefDraftError: string;
  suggestScope(input: {
    title: string;
    genre: string;
    premise: string;
    notes?: string;
  }): Promise<ScopeAdvice | null>;
  clearScopeAdvice(): void;
  suggestBrief(input: {
    title: string;
    genre: string;
    premise: string;
    notes?: string;
  }): Promise<PlanningBrief | null>;
  clearDraftedBrief(): void;
  setPlanningMessage(novelId: string, message: string): void;
  loading: boolean;
  initialized: boolean;
  loadNovels(): Promise<void>;
  deleteNovel(novelId: string): Promise<void>;
  createNovel(input: CreateNovelInput): Promise<Novel>;
  updateNovelSettings(
    novelId: string,
    patch: { cycleSize: number },
  ): Promise<Novel>;
  loadPlanningWorkflow(novelId: string): Promise<PlanningWorkflow>;
  savePlanningBrief(
    novelId: string,
    brief: PlanningBrief,
    step: 1 | 2,
  ): Promise<PlanningWorkflow>;
  confirmPlanningReview(
    novelId: string,
    step: PlanningReviewStep,
  ): Promise<PlanningWorkflow>;
  invalidatePlanning(
    novelId: string,
    step: PlanningReviewStep,
  ): Promise<PlanningWorkflow>;
  generateNovelPlan(
    novelId: string,
    phase: PlanPhase,
    range?: PlanRange,
  ): Promise<NovelPlanSummary>;
  loadPlanningRuns(novelId: string): Promise<PlanningRun[]>;
  loadPlanningCycles(novelId: string): Promise<PlanningCycle[]>;
  savePlanningCycle(input: SavePlanningCycleInput): Promise<PlanningCycle>;
  loadPlanningProposals(novelId: string): Promise<PlanningProposal[]>;
  reviewPlanningProposal(
    novelId: string,
    proposalId: string,
    accept: boolean,
  ): Promise<PlanningProposal>;
  loadChapters(novelId: string): Promise<Chapter[]>;
  getChapter(chapterId: string): Promise<Chapter | null>;
  saveChapter(input: SaveChapterInput): Promise<Chapter>;
  loadVersions(chapterId: string): Promise<ChapterVersion[]>;
  createSnapshot(chapterId: string): Promise<ChapterVersion>;
  loadStructure(novelId: string): Promise<void>;
  createChapter(input: CreateChapterInput): Promise<Chapter>;
  updateChapterPlan(input: UpdateChapterPlanInput): Promise<Chapter>;
  deleteChapter(novelId: string, id: string): Promise<void>;
  reorderChapters(novelId: string, ids: string[]): Promise<void>;
  saveVolume(input: SaveVolumeInput): Promise<StoryVolume>;
  deleteVolume(novelId: string, id: string): Promise<void>;
  reorderVolumes(novelId: string, ids: string[]): Promise<void>;
  saveScene(novelId: string, input: SaveSceneInput): Promise<StoryScene>;
  deleteScene(novelId: string, id: string): Promise<void>;
  reorderScenes(
    novelId: string,
    chapterId: string,
    ids: string[],
  ): Promise<void>;
  buildContext(
    novelId: string,
    chapterId: string,
    inputBudget: number,
    outputReserved: number,
    candidateChain?: Chapter[],
  ): Promise<ContextPack>;
  loadUsage(novelId?: string): Promise<UsageRecord[]>;
  loadModelProfiles(): Promise<ModelProfile[]>;
  saveModelProfile(input: SaveModelProfileInput): Promise<ModelProfile>;
  deleteModelProfile(id: string): Promise<void>;
  testModelConnection(id: string, key?: string): Promise<ModelConnectionResult>;
  generateChapter(
    input: GenerateChapterInput,
    onProgress: (event: GenerationProgress) => void,
  ): Promise<ChapterCandidate>;
  loadCandidates(chapterId: string): Promise<ChapterCandidate[]>;
  reviewCandidate(
    candidateId: string,
    accept: boolean,
  ): Promise<ChapterCandidate>;
  loadBatches(): Promise<GenerationBatch[]>;
  loadJobs(batchId: string): Promise<GenerationJob[]>;
  setBatchStatus(
    batchId: string,
    status: GenerationBatch["status"],
  ): Promise<void>;
  runBatch(
    batchId: string,
    onDelta?: (chapterId: string, delta: string) => void,
  ): Promise<void>;
  dispatchBatch(batchId: string): Promise<void>;
  loadQuality(candidateId: string): Promise<void>;
  updateFinding(
    candidateId: string,
    findingId: string,
    status: StoredFinding["status"],
  ): Promise<void>;
  reviewFactProposal(
    candidateId: string,
    proposalId: string,
    accept: boolean,
  ): Promise<void>;
  buildProjectBundle(novelId: string): Promise<NovelProjectBundle>;
  importProject(value: unknown): Promise<Novel>;
  loadBible(novelId: string): Promise<BibleSection[]>;
  saveBibleSection(input: SaveBibleSectionInput): Promise<BibleSection>;
  loadEntities(novelId: string, type?: StoryEntityType): Promise<StoryEntity[]>;
  saveEntity(input: SaveStoryEntityInput): Promise<StoryEntity>;
  deleteEntity(novelId: string, entityId: string): Promise<void>;
  loadContinuity(novelId: string): Promise<void>;
  saveTimeline(input: SaveTimelineEventInput): Promise<TimelineEvent>;
  deleteTimeline(novelId: string, id: string): Promise<void>;
  saveForeshadow(input: SaveForeshadowInput): Promise<ForeshadowThread>;
  deleteForeshadow(novelId: string, id: string): Promise<void>;
  saveCharacterState(input: SaveCharacterStateInput): Promise<CharacterState>;
  deleteCharacterState(novelId: string, id: string): Promise<void>;
  createGenerationDraft(
    novelId: string,
    policy: GenerationPolicy,
  ): ReturnType<typeof platform.createGenerationDraft>;
}
const activeChapterRequests = new Map<string, string>();
const activeBatchRequests = new Set<string>();
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export const useNovelStore = create<NovelState>((set, get) => ({
  novels: [],
  chapters: {},
  versions: {},
  bibleSections: {},
  entities: {},
  timelineEvents: {},
  foreshadowThreads: {},
  characterStates: {},
  volumes: {},
  scenes: {},
  contextPacks: {},
  usage: [],
  modelProfiles: [],
  candidates: {},
  batches: [],
  jobs: {},
  findings: {},
  factProposals: {},
  planningWorkflows: {},
  planningRuns: {},
  planningCycles: {},
  planningProposals: {},
  planningBusy: {},
  planningMessage: {},
  activeRequests: {},
  scopeAdvice: null,
  scopeAdviceBusy: false,
  scopeAdviceError: "",
  draftedBrief: null,
  briefDraftBusy: false,
  briefDraftError: "",
  async suggestScope(input) {
    set({ scopeAdviceBusy: true, scopeAdviceError: "" });
    try {
      const advice = await platform.suggestNovelScope(input);
      set({ scopeAdvice: advice, scopeAdviceBusy: false });
      return advice;
    } catch (error) {
      set({
        scopeAdviceBusy: false,
        scopeAdviceError:
          error instanceof Error ? error.message : "篇幅建议生成失败",
      });
      return null;
    }
  },
  clearScopeAdvice() {
    set({ scopeAdvice: null, scopeAdviceError: "" });
  },
  async suggestBrief(input) {
    set({ briefDraftBusy: true, briefDraftError: "" });
    try {
      const brief = await platform.suggestPlanningBrief(input);
      set({ draftedBrief: brief, briefDraftBusy: false });
      return brief;
    } catch (error) {
      set({
        briefDraftBusy: false,
        briefDraftError:
          error instanceof Error ? error.message : "简报起草失败",
      });
      return null;
    }
  },
  clearDraftedBrief() {
    set({ draftedBrief: null, briefDraftError: "" });
  },
  setPlanningMessage(novelId, message) {
    set({
      planningMessage: { ...get().planningMessage, [novelId]: message },
    });
  },
  loading: false,
  initialized: false,
  async loadNovels() {
    set({ loading: true });
    try {
      set({ novels: await platform.listNovels() });
    } finally {
      set({ loading: false, initialized: true });
    }
  },
  async deleteNovel(id) {
    await platform.deleteNovel(id);
    const state = get();
    set({
      novels: state.novels.filter((item) => item.id !== id),
      batches: state.batches.filter((item) => item.novelId !== id),
      chapters: omitKey(state.chapters, id),
      bibleSections: omitKey(state.bibleSections, id),
      entities: omitKey(state.entities, id),
      timelineEvents: omitKey(state.timelineEvents, id),
      foreshadowThreads: omitKey(state.foreshadowThreads, id),
      characterStates: omitKey(state.characterStates, id),
      volumes: omitKey(state.volumes, id),
      scenes: omitKey(state.scenes, id),
      contextPacks: omitKey(state.contextPacks, id),
      planningWorkflows: omitKey(state.planningWorkflows, id),
      planningRuns: omitKey(state.planningRuns, id),
      planningCycles: omitKey(state.planningCycles, id),
      planningProposals: omitKey(state.planningProposals, id),
      planningBusy: omitKey(state.planningBusy, id),
      planningMessage: omitKey(state.planningMessage, id),
      usage: state.usage.filter((item) => item.novelId !== id),
    });
  },
  async createNovel(input) {
    const result = await platform.createNovel(input);
    set({
      novels: [result.novel, ...get().novels],
      chapters: { ...get().chapters, [result.novel.id]: result.chapters },
      planningWorkflows: {
        ...get().planningWorkflows,
        [result.novel.id]: defaultPlanningWorkflow(result.novel.id),
      },
    });
    return result.novel;
  },
  async updateNovelSettings(novelId, patch) {
    const updated = await platform.updateNovelSettings(novelId, patch);
    set({
      novels: get().novels.map((item) =>
        item.id === novelId ? updated : item,
      ),
    });
    return updated;
  },
  async loadPlanningWorkflow(novelId) {
    const workflow = await platform.getPlanningWorkflow(novelId);
    set({
      planningWorkflows: {
        ...get().planningWorkflows,
        [novelId]: workflow,
      },
    });
    return workflow;
  },
  async savePlanningBrief(novelId, brief, step) {
    const current =
        get().planningWorkflows[novelId] ??
        (await get().loadPlanningWorkflow(novelId)),
      workflow = confirmWorkflowStep(
        { ...invalidateWorkflowFrom(current, step), brief },
        step,
      ),
      saved = await platform.savePlanningWorkflow(workflow);
    set({
      planningWorkflows: {
        ...get().planningWorkflows,
        [novelId]: saved,
      },
    });
    return saved;
  },
  async confirmPlanningReview(novelId, step) {
    const current =
        get().planningWorkflows[novelId] ??
        (await get().loadPlanningWorkflow(novelId)),
      saved = await platform.savePlanningWorkflow(
        confirmWorkflowStep(current, step),
      );
    set({
      planningWorkflows: {
        ...get().planningWorkflows,
        [novelId]: saved,
      },
    });
    return saved;
  },
  async invalidatePlanning(novelId, step) {
    const current =
        get().planningWorkflows[novelId] ??
        (await get().loadPlanningWorkflow(novelId)),
      invalidated = invalidateWorkflowFrom(current, step);
    if (invalidated.confirmedSteps.length === current.confirmedSteps.length)
      return current;
    const saved = await platform.savePlanningWorkflow(invalidated);
    set({
      planningWorkflows: {
        ...get().planningWorkflows,
        [novelId]: saved,
      },
    });
    return saved;
  },
  async generateNovelPlan(novelId, phase, range) {
    // busy/结果文案挂在 store 上：规划耗时以分钟计，作者切页回来仍能看到进行中状态。
    set({
      planningBusy: { ...get().planningBusy, [novelId]: phase },
      planningMessage: { ...get().planningMessage, [novelId]: "" },
    });
    try {
      const summary = await platform.generateNovelPlan(novelId, phase, range);
      await get().invalidatePlanning(
        novelId,
        phase === "bible" ? 3 : phase === "cast" ? 5 : phase === "scenes" ? 6 : 7,
      );
      await Promise.all([
        get().loadChapters(novelId),
        get().loadBible(novelId),
        get().loadEntities(novelId),
        get().loadStructure(novelId),
        get().loadPlanningRuns(novelId),
        get().loadPlanningCycles(novelId),
        get().loadPlanningProposals(novelId),
      ]);
      set({
        planningMessage: {
          ...get().planningMessage,
          [novelId]:
            phase === "bible"
              ? `Amy 已生成 ${summary.sections} 份核心文档和 ${summary.entities} 张设定卡，请审核后确认。`
              : phase === "cast"
                ? `Amy 已生成 ${summary.entities} 名分层人物，并补充 ${summary.extras} 个龙套名称。`
                : phase === "scenes"
                  ? `Amy 已生成 ${summary.entities} 张可复用场景卡。`
                  : `Amy 已完成第 ${range?.startChapter}–${range?.endChapter} 章策划包：${summary.chapters} 个标题与章纲，并同步整理宏观分卷路线。`,
        },
      });
      return summary;
    } catch (error) {
      set({
        planningMessage: {
          ...get().planningMessage,
          [novelId]: `生成失败：${error instanceof Error ? error.message : "未知错误"}`,
        },
      });
      throw error;
    } finally {
      set({ planningBusy: { ...get().planningBusy, [novelId]: null } });
    }
  },
  async loadPlanningRuns(novelId) {
    const runs = await platform.listPlanningRuns(novelId);
    set({ planningRuns: { ...get().planningRuns, [novelId]: runs } });
    return runs;
  },
  async loadPlanningCycles(novelId) {
    const cycles = await platform.listPlanningCycles(novelId);
    set({ planningCycles: { ...get().planningCycles, [novelId]: cycles } });
    return cycles;
  },
  async savePlanningCycle(input) {
    const cycle = await platform.savePlanningCycle(input),
      list = get().planningCycles[cycle.novelId] ?? [],
      next = [cycle, ...list.filter((item) => item.id !== cycle.id)].sort(
        (a, b) => a.startChapter - b.startChapter,
      );
    set({
      planningCycles: {
        ...get().planningCycles,
        [cycle.novelId]: next,
      },
    });
    return cycle;
  },
  async loadPlanningProposals(novelId) {
    const proposals = await platform.listPlanningProposals(novelId);
    set({
      planningProposals: {
        ...get().planningProposals,
        [novelId]: proposals,
      },
    });
    return proposals;
  },
  async reviewPlanningProposal(novelId, proposalId, accept) {
    const proposal = await platform.reviewPlanningProposal(
      novelId,
      proposalId,
      accept ? "accepted" : "rejected",
    );
    await Promise.all([
      get().loadPlanningProposals(novelId),
      get().loadEntities(novelId),
    ]);
    return proposal;
  },
  async loadChapters(novelId) {
    const cached = get().chapters[novelId];
    if (cached) return cached;
    const chapters = await platform.listChapters(novelId);
    set({ chapters: { ...get().chapters, [novelId]: chapters } });
    return chapters;
  },
  async getChapter(chapterId) {
    for (const list of Object.values(get().chapters)) {
      const chapter = list.find((item) => item.id === chapterId);
      if (chapter) return chapter;
    }
    return platform.getChapter(chapterId);
  },
  async saveChapter(input) {
    const chapter = await platform.saveChapter(input);
    const list = get().chapters[chapter.novelId] ?? [];
    set({
      chapters: {
        ...get().chapters,
        [chapter.novelId]: list.map((item) =>
          item.id === chapter.id ? chapter : item,
        ),
      },
    });
    return chapter;
  },
  async loadVersions(chapterId) {
    const versions = await platform.listChapterVersions(chapterId);
    set({ versions: { ...get().versions, [chapterId]: versions } });
    return versions;
  },
  async createSnapshot(chapterId) {
    const version = await platform.createChapterSnapshot(chapterId);
    set({
      versions: {
        ...get().versions,
        [chapterId]: [version, ...(get().versions[chapterId] ?? [])],
      },
    });
    return version;
  },
  async loadStructure(novelId) {
    const structure = await platform.listStoryStructure(novelId),
      chapters = await platform.listChapters(novelId);
    set({
      volumes: { ...get().volumes, [novelId]: structure.volumes },
      scenes: { ...get().scenes, [novelId]: structure.scenes },
      chapters: { ...get().chapters, [novelId]: chapters },
    });
  },
  async createChapter(input) {
    const item = await platform.createChapter(input);
    await get().invalidatePlanning(input.novelId, 8);
    set({
      chapters: {
        ...get().chapters,
        [input.novelId]: [...(get().chapters[input.novelId] ?? []), item],
      },
    });
    return item;
  },
  async updateChapterPlan(input) {
    const item = await platform.updateChapterPlan(input),
      list = get().chapters[item.novelId] ?? [];
    await get().invalidatePlanning(item.novelId, 8);
    set({
      chapters: {
        ...get().chapters,
        [item.novelId]: list.map((value) =>
          value.id === item.id ? item : value,
        ),
      },
    });
    return item;
  },
  async deleteChapter(novelId, id) {
    await platform.deleteChapter(id);
    await get().invalidatePlanning(novelId, 8);
    set({
      chapters: {
        ...get().chapters,
        [novelId]: (get().chapters[novelId] ?? [])
          .filter((item) => item.id !== id)
          .map((item, index) => ({ ...item, position: index + 1 })),
      },
      scenes: {
        ...get().scenes,
        [novelId]: (get().scenes[novelId] ?? []).filter(
          (item) => item.chapterId !== id,
        ),
      },
    });
  },
  async reorderChapters(novelId, ids) {
    const list = await platform.reorderChapters(novelId, ids);
    await get().invalidatePlanning(novelId, 8);
    set({ chapters: { ...get().chapters, [novelId]: list } });
  },
  async saveVolume(input) {
    const item = await platform.saveVolume(input),
      list = get().volumes[input.novelId] ?? [],
      next = list.some((value) => value.id === item.id)
        ? list.map((value) => (value.id === item.id ? item : value))
        : [...list, item];
    await get().invalidatePlanning(input.novelId, 7);
    set({ volumes: { ...get().volumes, [input.novelId]: next } });
    return item;
  },
  async deleteVolume(novelId, id) {
    await platform.deleteVolume(id);
    await get().invalidatePlanning(novelId, 7);
    set({
      volumes: {
        ...get().volumes,
        [novelId]: (get().volumes[novelId] ?? []).filter(
          (item) => item.id !== id,
        ),
      },
      chapters: {
        ...get().chapters,
        [novelId]: (get().chapters[novelId] ?? []).map((item) =>
          item.volumeId === id ? { ...item, volumeId: null } : item,
        ),
      },
    });
  },
  async reorderVolumes(novelId, ids) {
    const list = await platform.reorderVolumes(novelId, ids);
    await get().invalidatePlanning(novelId, 7);
    set({ volumes: { ...get().volumes, [novelId]: list } });
  },
  async saveScene(novelId, input) {
    const item = await platform.saveScene(input),
      list = get().scenes[novelId] ?? [],
      next = list.some((value) => value.id === item.id)
        ? list.map((value) => (value.id === item.id ? item : value))
        : [...list, item];
    await get().invalidatePlanning(novelId, 8);
    set({ scenes: { ...get().scenes, [novelId]: next } });
    return item;
  },
  async deleteScene(novelId, id) {
    await platform.deleteScene(id);
    await get().invalidatePlanning(novelId, 8);
    set({
      scenes: {
        ...get().scenes,
        [novelId]: (get().scenes[novelId] ?? []).filter(
          (item) => item.id !== id,
        ),
      },
    });
  },
  async reorderScenes(novelId, chapterId, ids) {
    const siblings = await platform.reorderScenes(chapterId, ids),
      other = (get().scenes[novelId] ?? []).filter(
        (item) => item.chapterId !== chapterId,
      );
    await get().invalidatePlanning(novelId, 8);
    set({ scenes: { ...get().scenes, [novelId]: [...other, ...siblings] } });
  },
  async buildContext(
    novelId,
    chapterId,
    inputBudget,
    outputReserved,
    candidateChain = [],
  ) {
    await Promise.all([
      get().loadChapters(novelId),
      get().loadBible(novelId),
      get().loadEntities(novelId),
      get().loadContinuity(novelId),
      get().loadStructure(novelId),
    ]);
    const state = get(),
      novel = state.novels.find((item) => item.id === novelId),
      chapters = state.chapters[novelId] ?? [],
      chapter = chapters.find((item) => item.id === chapterId);
    if (!novel || !chapter) throw new Error("Novel or chapter not found");
    const volume = state.volumes[novelId]?.find(
        (item) => item.id === chapter.volumeId,
      ),
      recent = selectRecentChapters(
        chapters,
        chapter.position,
        candidateChain,
      );
    const pack = buildContextPack({
      novel,
      chapter,
      volume,
      scenes: (state.scenes[novelId] ?? []).filter(
        (item) => item.chapterId === chapterId,
      ),
      bible: state.bibleSections[novelId] ?? [],
      entities: state.entities[novelId] ?? [],
      timeline: (state.timelineEvents[novelId] ?? []).filter((item) => {
        const linked = chapters.find((ch) => ch.id === item.chapterId);
        return (
          !item.chapterId ||
          Boolean(linked && linked.position <= chapter.position)
        );
      }),
      foreshadow: state.foreshadowThreads[novelId] ?? [],
      characterStates: state.characterStates[novelId] ?? [],
      recentChapters: recent,
      inputBudget,
      outputTokensReserved: outputReserved,
    });
    await platform.saveContextSnapshot(novelId, pack);
    const usage = await platform.saveUsage({
      novelId,
      chapterId,
      operation: "context_build",
      provider: "local",
      model: "token-estimator-v1",
      inputTokens: pack.inputTokens,
      outputTokens: pack.outputTokensReserved,
      cachedTokens: 0,
      cost: null,
      measurement: "estimated",
    });
    set({
      contextPacks: {
        ...get().contextPacks,
        [novelId]: [pack, ...(get().contextPacks[novelId] ?? [])],
      },
      usage: [usage, ...get().usage],
    });
    return pack;
  },
  async loadUsage(novelId) {
    const usage = await platform.listUsage(novelId);
    set({ usage });
    return usage;
  },
  async loadModelProfiles() {
    const modelProfiles = await platform.listModelProfiles();
    set({ modelProfiles });
    return modelProfiles;
  },
  async saveModelProfile(input) {
    const item = await platform.saveModelProfile(input),
      list = get().modelProfiles,
      next = list.some((value) => value.id === item.id)
        ? list.map((value) =>
            value.id === item.id
              ? item
              : item.isDefault
                ? { ...value, isDefault: false }
                : value,
          )
        : [
            item,
            ...(item.isDefault
              ? list.map((value) => ({ ...value, isDefault: false }))
              : list),
          ];
    set({ modelProfiles: next });
    return item;
  },
  async deleteModelProfile(id) {
    await platform.deleteModelProfile(id);
    set({
      modelProfiles: get().modelProfiles.filter((item) => item.id !== id),
    });
  },
  testModelConnection: (id, key) => platform.testModelConnection(id, key),
  async generateChapter(input, onProgress) {
    activeChapterRequests.set(input.chapterId, input.requestId);
    set({
      activeRequests: {
        ...get().activeRequests,
        [input.chapterId]: {
          requestId: input.requestId,
          startedAt: Date.now(),
        },
      },
    });
    try {
      const item = await platform.generateChapter(input, onProgress);
      set({
        candidates: {
          ...get().candidates,
          [input.chapterId]: [
            item,
            ...(get().candidates[input.chapterId] ?? []),
          ],
        },
      });
      return item;
    } finally {
      activeChapterRequests.delete(input.chapterId);
      set({ activeRequests: omitKey(get().activeRequests, input.chapterId) });
    }
  },
  async loadCandidates(chapterId) {
    const items = await platform.listChapterCandidates(chapterId);
    set({ candidates: { ...get().candidates, [chapterId]: items } });
    return items;
  },
  async reviewCandidate(id, accept) {
    const item = accept
        ? await platform.acceptChapterCandidate(id)
        : await platform.rejectChapterCandidate(id),
      list = get().candidates[item.chapterId] ?? [];
    set({
      candidates: {
        ...get().candidates,
        [item.chapterId]: list.map((value) => (value.id === id ? item : value)),
      },
    });
    if (accept) {
      const chapter = await platform.getChapter(item.chapterId);
      if (chapter) {
        const chapters = get().chapters[chapter.novelId] ?? [];
        set({
          chapters: {
            ...get().chapters,
            [chapter.novelId]: chapters.map((value) =>
              value.id === chapter.id ? chapter : value,
            ),
          },
        });
      }
    }
    return item;
  },
  async loadBatches() {
    const batches = await platform.listGenerationBatches();
    set({ batches });
    return batches;
  },
  async loadJobs(batchId) {
    const items = await platform.listGenerationJobs(batchId);
    set({ jobs: { ...get().jobs, [batchId]: items } });
    return items;
  },
  async setBatchStatus(id, status) {
    if (status === "paused" && platform.host === "electron")
      await platform.pauseBackgroundBatch(id);
    else {
      if (status === "paused") {
        const current = (get().jobs[id] ?? []).find(
            (item) => item.status === "generating",
          ),
          requestId = current
            ? activeChapterRequests.get(current.chapterId)
            : undefined;
        if (requestId) await platform.cancelGeneration(requestId);
      }
      await platform.setBatchStatus(id, status);
    }
    await get().loadBatches();
  },
  async dispatchBatch(id) {
    if (platform.host === "electron") {
      await platform.startBackgroundBatch(id);
      await get().loadBatches();
    } else {
      if (activeBatchRequests.has(id)) return;
      activeBatchRequests.add(id);
      try {
        await get().runBatch(id);
      } finally {
        activeBatchRequests.delete(id);
      }
    }
  },
  async loadQuality(id) {
    const [findings, proposals] = await Promise.all([
      platform.listFindings(id),
      platform.listFactProposals(id),
    ]);
    set({
      findings: { ...get().findings, [id]: findings },
      factProposals: { ...get().factProposals, [id]: proposals },
    });
  },
  async updateFinding(candidateId, id, status) {
    const item = await platform.updateFinding(id, status);
    set({
      findings: {
        ...get().findings,
        [candidateId]: (get().findings[candidateId] ?? []).map((value) =>
          value.id === id ? item : value,
        ),
      },
    });
  },
  async reviewFactProposal(candidateId, id, accept) {
    const proposal = (get().factProposals[candidateId] ?? []).find(
      (item) => item.id === id,
    );
    if (!proposal) throw new Error("事实建议不存在");
    if (accept) {
      const cachedCandidate = Object.values(get().candidates)
          .flat()
          .find((item) => item.id === candidateId),
        candidate =
          cachedCandidate ??
          (await platform.listChapterCandidates(proposal.chapterId)).find(
            (item) => item.id === candidateId,
          );
      assertCandidateAcceptedForCanon(candidate);
      const chapter = await get().getChapter(proposal.chapterId);
      if (!chapter) throw new Error("建议对应章节不存在");
      const parsed = parseProposalPayload(proposal);
      if (parsed.kind === "timeline") {
        const entities = await platform.listStoryEntities(chapter.novelId),
          names = parsed.payload.participants.map((name) => name.trim()),
          participantIds = entities
            .filter((entity) =>
              names.some(
                (name) => entity.name === name || entity.aliases.includes(name),
              ),
            )
            .map((entity) => entity.id);
        await platform.saveTimelineEvent({
          novelId: chapter.novelId,
          chapterId: chapter.id,
          storyTime: parsed.payload.storyTime,
          title: proposal.title,
          detail: parsed.payload.detail,
          participantIds,
          source: "ai_candidate",
        });
      } else if (parsed.kind === "character_state") {
        const entities = await platform.listStoryEntities(
            chapter.novelId,
            "character",
          ),
          character = entities.find(
            (entity) =>
              entity.name === parsed.payload.characterName ||
              entity.aliases.includes(parsed.payload.characterName),
          );
        if (!character)
          throw new Error(
            `未找到角色“${parsed.payload.characterName}”，请先在故事圣经中建立或补充别名`,
          );
        await platform.saveCharacterState({
          novelId: chapter.novelId,
          characterId: character.id,
          chapterId: chapter.id,
          summary: parsed.payload.summary,
          location: parsed.payload.location,
          physical: parsed.payload.physical,
          emotional: parsed.payload.emotional,
          knowledge: parsed.payload.knowledge,
          goals: parsed.payload.goals,
          inventory: parsed.payload.inventory,
          skills: parsed.payload.skills,
          source: "ai_candidate",
        });
      } else
        await platform.saveForeshadowThread({
          novelId: chapter.novelId,
          title: proposal.title,
          detail: parsed.payload.detail,
          setupChapterId:
            parsed.payload.status === "planned" ? null : chapter.id,
          payoffChapterId:
            parsed.payload.status === "resolved" ? chapter.id : null,
          status: parsed.payload.status,
          source: "ai_candidate",
        });
      await get().loadContinuity(chapter.novelId);
    }
    const item = await platform.updateFactProposal(
      id,
      accept ? "accepted" : "rejected",
    );
    set({
      factProposals: {
        ...get().factProposals,
        [candidateId]: (get().factProposals[candidateId] ?? []).map((value) =>
          value.id === id ? item : value,
        ),
      },
    });
  },
  async buildProjectBundle(novelId) {
    const novel = get().novels.find((item) => item.id === novelId);
    if (!novel) throw new Error("作品不存在");
    const [
      chapters,
      bible,
      entities,
      structure,
      timeline,
      foreshadow,
      characterStates,
      usage,
      workflow,
      planningRuns,
      planningCycles,
      planningProposals,
    ] = await Promise.all([
      platform.listChapters(novelId),
      platform.listBibleSections(novelId),
      platform.listStoryEntities(novelId),
      platform.listStoryStructure(novelId),
      platform.listTimelineEvents(novelId),
      platform.listForeshadowThreads(novelId),
      platform.listCharacterStates(novelId),
      platform.listUsage(novelId),
      platform.getPlanningWorkflow(novelId),
      platform.listPlanningRuns(novelId),
      platform.listPlanningCycles(novelId),
      platform.listPlanningProposals(novelId),
    ]);
    const [versionGroups, candidateGroups] = await Promise.all([
      Promise.all(
        chapters.map((item) => platform.listChapterVersions(item.id)),
      ),
      Promise.all(
        chapters.map((item) => platform.listChapterCandidates(item.id)),
      ),
    ]);
    return {
      format: "amy-novel-project",
      version: 1,
      exportedAt: new Date().toISOString(),
      novel,
      chapters,
      versions: versionGroups.flat(),
      bible,
      entities,
      volumes: structure.volumes,
      scenes: structure.scenes,
      timeline,
      foreshadow,
      characterStates,
      usage,
      candidates: candidateGroups.flat(),
      workflow,
      planningRuns,
      planningCycles,
      planningProposals,
    };
  },
  async importProject(value) {
    const novel = await platform.importNovelProject(parseNovelProject(value));
    set({ novels: [novel, ...get().novels] });
    return novel;
  },
  async runBatch(batchId, onDelta) {
    let batch = get().batches.find((item) => item.id === batchId);
    if (!batch) {
      await get().loadBatches();
      batch = get().batches.find((item) => item.id === batchId);
    }
    if (!batch) throw new Error("Batch not found");
    const profiles = get().modelProfiles.length
        ? get().modelProfiles
        : await get().loadModelProfiles(),
      profile = profiles.find((item) => item.isDefault) ?? profiles[0];
    if (!profile) throw new Error("请先在设置中配置默认模型");
    await get().setBatchStatus(batchId, "running");
    let jobs = await get().loadJobs(batchId);
    while (true) {
      const currentBatch = get().batches.find((item) => item.id === batchId);
      if (
        currentBatch?.status === "paused" ||
        currentBatch?.status === "cancelled"
      )
        return;
      const job = nextRunnableJob(jobs);
      if (!job) break;
      if (
        currentBatch &&
        currentBatch.outputTokensUsed >= currentBatch.policy.outputTokenBudget
      ) {
        await get().setBatchStatus(batchId, "paused");
        return;
      }
      try {
        await platform.updateGenerationJob(job.id, "building_context", {
          attempt: job.attempt + 1,
          error: "",
        });
        jobs = await get().loadJobs(batchId);
        const chapterList = (get().chapters[batch.novelId] ?? []).length
            ? get().chapters[batch.novelId]
            : await get().loadChapters(batch.novelId),
          candidateChain = jobs
            .filter((item) => item.position < job.position && item.candidateId)
            .flatMap((item) => {
              const chapter = chapterList.find(
                  (value) => value.id === item.chapterId,
                ),
                candidate = Object.values(get().candidates)
                  .flat()
                  .find((value) => value.id === item.candidateId);
              return chapter && candidate
                ? [
                    {
                      ...chapter,
                      content: `【本批次候选稿，尚未进入正史】\n${candidate.content}`,
                    },
                  ]
                : [];
            }),
          remaining = currentBatch
            ? currentBatch.policy.outputTokenBudget -
              currentBatch.outputTokensUsed
            : 0,
          output = Math.min(
            Math.ceil(batch.policy.chapterWords * 1.5),
            profile.contextWindow - 4000,
            remaining,
          );
        if (output < 500) {
          await get().setBatchStatus(batchId, "paused");
          return;
        }
        const pack = await get().buildContext(
          batch.novelId,
          job.chapterId,
          Math.max(4000, profile.contextWindow - output),
          output,
          candidateChain,
        );
        await platform.updateGenerationJob(job.id, "generating");
        const candidate = await get().generateChapter(
          {
            requestId: nanoid(),
            novelId: batch.novelId,
            chapterId: job.chapterId,
            profileId: profile.id,
            contextText: pack.renderedText,
            contextHash: pack.contentHash,
            maxOutputTokens: output,
            temperature: 0.8,
          },
          (event) => {
            if (event.delta) onDelta?.(job.chapterId, event.delta);
          },
        );
        await platform.updateGenerationJob(job.id, "candidate_ready", {
          candidateId: candidate.id,
          inputTokens: candidate.inputTokens,
          outputTokens: candidate.outputTokens,
        });
        await get().loadBatches();
        jobs = await get().loadJobs(batchId);
      } catch (error) {
        const attempt = job.attempt + 1,
          retryable =
            !(error instanceof ModelRequestError) || error.retryable === true,
          status =
            retryable && attempt <= batch.policy.maxRetries
              ? "waiting_retry"
              : "failed";
        await platform.updateGenerationJob(job.id, status, {
          attempt,
          error: error instanceof Error ? error.message : "生成失败",
        });
        if (status === "waiting_retry") {
          const retryAfter =
            error instanceof ModelRequestError ? error.retryAfterMs : null;
          await waitForRetry(retryDelayMs(attempt, retryAfter));
          await platform.updateGenerationJob(job.id, "queued");
        }
        jobs = await get().loadJobs(batchId);
        if (status === "failed") {
          await get().setBatchStatus(batchId, "failed");
          return;
        }
      }
    }
    await get().setBatchStatus(
      batchId,
      jobs.some((item) => item.status === "failed") ? "failed" : "completed",
    );
  },
  async loadBible(novelId) {
    const sections = await platform.listBibleSections(novelId);
    set({ bibleSections: { ...get().bibleSections, [novelId]: sections } });
    return sections;
  },
  async saveBibleSection(input) {
    const section = await platform.saveBibleSection(input);
    await get().invalidatePlanning(input.novelId, 3);
    const sections = get().bibleSections[input.novelId] ?? [];
    set({
      bibleSections: {
        ...get().bibleSections,
        [input.novelId]: sections.map((item) =>
          item.kind === section.kind ? section : item,
        ),
      },
    });
    return section;
  },
  async loadEntities(novelId, type) {
    const entities = await platform.listStoryEntities(novelId, type);
    if (type) {
      const other = (get().entities[novelId] ?? []).filter(
        (item) => item.type !== type,
      );
      set({
        entities: { ...get().entities, [novelId]: [...other, ...entities] },
      });
    } else set({ entities: { ...get().entities, [novelId]: entities } });
    return entities;
  },
  async saveEntity(input) {
    const entity = await platform.saveStoryEntity(input);
    await get().invalidatePlanning(
      input.novelId,
      input.type === "character" ? 4 : 6,
    );
    const list = get().entities[input.novelId] ?? [],
      index = list.findIndex((item) => item.id === entity.id),
      next =
        index >= 0
          ? list.map((item) => (item.id === entity.id ? entity : item))
          : [entity, ...list];
    set({ entities: { ...get().entities, [input.novelId]: next } });
    return entity;
  },
  async deleteEntity(novelId, entityId) {
    const entity = (get().entities[novelId] ?? []).find(
      (item) => item.id === entityId,
    );
    await platform.deleteStoryEntity(entityId);
    await get().invalidatePlanning(
      novelId,
      entity?.type === "character" ? 4 : 6,
    );
    set({
      entities: {
        ...get().entities,
        [novelId]: (get().entities[novelId] ?? []).filter(
          (item) => item.id !== entityId,
        ),
      },
    });
  },
  async loadContinuity(novelId) {
    const [timeline, foreshadow, states] = await Promise.all([
      platform.listTimelineEvents(novelId),
      platform.listForeshadowThreads(novelId),
      platform.listCharacterStates(novelId),
    ]);
    set({
      timelineEvents: { ...get().timelineEvents, [novelId]: timeline },
      foreshadowThreads: { ...get().foreshadowThreads, [novelId]: foreshadow },
      characterStates: { ...get().characterStates, [novelId]: states },
    });
  },
  async saveTimeline(input) {
    const item = await platform.saveTimelineEvent(input),
      list = get().timelineEvents[input.novelId] ?? [],
      found = list.some((value) => value.id === item.id),
      next = (
        found
          ? list.map((value) => (value.id === item.id ? item : value))
          : [...list, item]
      ).sort((a, b) => a.storyTime.localeCompare(b.storyTime));
    set({ timelineEvents: { ...get().timelineEvents, [input.novelId]: next } });
    return item;
  },
  async deleteTimeline(novelId, id) {
    await platform.deleteTimelineEvent(id);
    set({
      timelineEvents: {
        ...get().timelineEvents,
        [novelId]: (get().timelineEvents[novelId] ?? []).filter(
          (item) => item.id !== id,
        ),
      },
    });
  },
  async saveForeshadow(input) {
    const item = await platform.saveForeshadowThread(input),
      list = get().foreshadowThreads[input.novelId] ?? [],
      next = list.some((value) => value.id === item.id)
        ? list.map((value) => (value.id === item.id ? item : value))
        : [item, ...list];
    set({
      foreshadowThreads: { ...get().foreshadowThreads, [input.novelId]: next },
    });
    return item;
  },
  async deleteForeshadow(novelId, id) {
    await platform.deleteForeshadowThread(id);
    set({
      foreshadowThreads: {
        ...get().foreshadowThreads,
        [novelId]: (get().foreshadowThreads[novelId] ?? []).filter(
          (item) => item.id !== id,
        ),
      },
    });
  },
  async saveCharacterState(input) {
    const item = await platform.saveCharacterState(input),
      list = get().characterStates[input.novelId] ?? [],
      next = list.some((value) => value.id === item.id)
        ? list.map((value) => (value.id === item.id ? item : value))
        : [item, ...list];
    set({
      characterStates: { ...get().characterStates, [input.novelId]: next },
    });
    return item;
  },
  async deleteCharacterState(novelId, id) {
    await platform.deleteCharacterState(id);
    set({
      characterStates: {
        ...get().characterStates,
        [novelId]: (get().characterStates[novelId] ?? []).filter(
          (item) => item.id !== id,
        ),
      },
    });
  },
  createGenerationDraft: (novelId, policy) =>
    platform.createGenerationDraft(novelId, policy),
}));

import { create } from "zustand";
import type {
  Chapter,
  ChapterVersion,
  CreateNovelInput,
  Novel,
  SaveChapterInput,
} from "@domain/novel";
import {
  approvalGateEnabled,
  nextRunnableJob,
  retryDelayMs,
  waitForRetry,
  type GenerationBatch,
  type GenerationEvent,
  type GenerationJob,
  type GenerationPolicy,
  type NewGenerationEvent,
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
  selectCharacterStates,
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
import {
  continuationPrompt,
  mergeContinuation,
} from "@domain/chapter-generation";
import { countCjkWords } from "@domain/novel";
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
import type {
  AnalyzeStyleTemplateInput,
  SaveStyleTemplateInput,
  StyleTemplate,
} from "@domain/style-template";
import { applyStyleTemplate } from "@domain/style-template";
import type { PersonaSuggestion } from "@domain/persona-recommendation";
import type {
  WorkflowMode,
  WorkflowRun,
} from "@domain/workflow-run";
import { workflowRunUpdateFromBatch, WORKFLOW_PHASE_LABELS } from "@domain/workflow-run";
import {
  cruisePolicy,
  draftClosingState,
  nextCycleRange,
  type CruiseState,
} from "@domain/workflow-cruise";
import { checkGlobalConsistency, type GlobalFinding } from "@domain/global-consistency";
import { replaceAllInContent } from "@domain/revision";
import { resumeWorkflowRun } from "@application/run-workflow";

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
  styleTemplates: StyleTemplate[];
  candidates: Record<string, ChapterCandidate[]>;
  batches: GenerationBatch[];
  jobs: Record<string, GenerationJob[]>;
  /** 批次运行日志（作者视图）：batchId -> 事件流。 */
  activityEvents: Record<string, GenerationEvent[]>;
  findings: Record<string, StoredFinding[]>;
  factProposals: Record<string, FactProposal[]>;
  planningWorkflows: Record<string, PlanningWorkflow>;
  planningRuns: Record<string, PlanningRun[]>;
  planningCycles: Record<string, PlanningCycle[]>;
  planningProposals: Record<string, PlanningProposal[]>;
  workflowRuns: Record<string, WorkflowRun[]>;
  /** 人格推荐草稿（novelId -> 全阵容建议）：确认前不写正式设定。 */
  personaDrafts: Record<string, PersonaSuggestion[]>;
  personaBusy: Record<string, boolean>;
  personaMessage: Record<string, string>;
  /** 进行中的规划阶段（novelId -> phase）；挂在 store 上，切换页面不丢失。 */
  planningBusy: Record<string, PlanPhase | null>;
  /** 最近一次规划的结果或错误文案，供页面重新挂载后回显。 */
  planningMessage: Record<string, string>;
  /** 自动审阅（novelId -> 开关与提示文案）；不持久化，重启后默认关闭。 */
  autoReview: Record<string, { enabled: boolean; message: string }>;
  /** AN-035 全自动巡航：跨周期无人值守连跑（进度在库里，开关持久化）。 */
  cruise: Record<string, CruiseState>;
  /** 全局一致性发现（novelId -> 规则 + AI 审查），AN-027。 */
  globalFindings: Record<string, GlobalFinding[]>;
  /** 单章生成中的请求（chapterId -> 请求信息）；防止切页回来重复发起。 */
  activeRequests: Record<string, { requestId: string; startedAt: number }>;
  /** 第 1–2 步七项简报的 AI 草稿：切页不丢，作者确认后写入工作流。 */
  draftedBrief: PlanningBrief | null;
  briefDraftBusy: boolean;
  briefDraftError: string;
  suggestScope(input: {
    title: string;
    genre: string;
    premise: string;
    notes?: string;
  }): Promise<ScopeAdvice>;
  /** Amy 一次推荐整个人物阵容的人格；结果进草稿，作者批量确认后写入。 */
  suggestPersonas(novelId: string): Promise<PersonaSuggestion[] | null>;
  confirmPersonas(
    novelId: string,
    suggestions: PersonaSuggestion[],
  ): Promise<number>;
  /** 订阅主进程推送的生成事件（Electron）；Web 端为空操作。 */
  ensureActivityListener(): void;
  loadActivity(batchId: string): Promise<GenerationEvent[]>;
  appendActivity(event: GenerationEvent): void;
  updatePersonaDraft(
    novelId: string,
    entityName: string,
    patch: Partial<PersonaSuggestion>,
  ): void;
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
  createNovel(input: CreateNovelInput, scopeAdvice?: ScopeAdvice): Promise<Novel>;
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
  loadWorkflowRuns(novelId: string): Promise<WorkflowRun[]>;
  startWorkflowRun(
    novelId: string,
    mode: WorkflowMode,
    policy: GenerationPolicy,
  ): Promise<WorkflowRun>;
  resumeWorkflowRun(runId: string): Promise<WorkflowRun>;
  syncWorkflowRunFromBatch(batchId: string): Promise<void>;
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
    revisionNotes?: string,
  ): Promise<ContextPack>;
  loadUsage(novelId?: string): Promise<UsageRecord[]>;
  loadModelProfiles(): Promise<ModelProfile[]>;
  saveModelProfile(input: SaveModelProfileInput): Promise<ModelProfile>;
  deleteModelProfile(id: string): Promise<void>;
  testModelConnection(id: string, key?: string): Promise<ModelConnectionResult>;
  loadStyleTemplates(): Promise<StyleTemplate[]>;
  analyzeStyleTemplate(input: AnalyzeStyleTemplateInput): Promise<StyleTemplate>;
  saveStyleTemplate(input: SaveStyleTemplateInput): Promise<StyleTemplate>;
  deleteStyleTemplate(id: string): Promise<void>;
  generateChapter(
    input: GenerateChapterInput,
    onProgress: (event: GenerationProgress) => void,
  ): Promise<ChapterCandidate>;
  loadCandidates(chapterId: string): Promise<ChapterCandidate[]>;
  /** 作者改稿：候选态下保存修改，接受时写入改后版本。 */
  editCandidateContent(
    candidateId: string,
    content: string,
  ): Promise<ChapterCandidate>;
  /** 失败任务重新排队并恢复批次。 */
  retryGenerationJob(batchId: string, jobId: string): Promise<void>;
  retryFailedJobs(batchId: string): Promise<number>;
  /** 前文变化后作废当前候选稿并重写本章。 */
  regenerateGenerationJob(
    batchId: string,
    jobId: string,
    revisionNotes?: string,
  ): Promise<void>;
  reviewCandidate(
    candidateId: string,
    accept: boolean,
  ): Promise<ChapterCandidate>;
  loadBatches(): Promise<GenerationBatch[]>;
  loadJobs(batchId: string): Promise<GenerationJob[]>;
  setBatchStatus(
    batchId: string,
    status: GenerationBatch["status"],
    patch?: { awaitingReview?: boolean },
  ): Promise<void>;
  /** AN-029：删除已完结批次的记录（平台层保证仅 completed/cancelled 可删）。 */
  deleteBatch(batchId: string): Promise<void>;
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
    options?: { autoCreateCharacter?: boolean },
  ): Promise<void>;
  /**
   * 自动审阅（作者显式开启的委托审阅）：开启后自动接受当前批次的候选稿与
   * 全部正史建议并继续下一章，直到本批完成或连续失败自动关闭。
   * 仍走 reviewCandidate / reviewFactProposal 同一套正史门禁，只是触发方变为定时器。
   */
  setAutoReview(novelId: string, enabled: boolean, message?: string): void;
  /**
   * AN-035 全自动巡航：跨周期无人值守连跑。循环体：周期规划（提案自动
   * 处理）→ 建批次 → 正文连写与正史建议自动接受（复用自动审阅）→
   * 封存（门禁照跑）→ 下一周期，直到目标章数；报错/批次预算耗尽/
   * 质量门触发转为 paused 并记录原因，处理后可续跑；重启自动重挂载。
   */
  startCruise(novelId: string, targetChapter: number): void;
  stopCruise(novelId: string, message?: string): void;
  resumeCruise(novelId: string): void;
  tickCruise(novelId: string): Promise<void>;
  tickAutoReview(novelId: string): Promise<void>;
  /** 内部：加载缺失的正史数据并返回 error 级全局发现的消息列表。 */
  collectGlobalErrors(novelId: string): Promise<string[]>;
  /** AN-027 全局一致性：确定性校验（零 token）与 AI 语义审查。 */
  loadGlobalFindings(novelId: string): Promise<GlobalFinding[]>;
  /** AN-031：作者连读疑点标记（source=author，跨校验/审查轮保留）。 */
  addAuthorFinding(
    novelId: string,
    position: number,
    message: string,
  ): Promise<void>;
  /** AN-034：全局修订单章应用（确定性替换 + 版本快照，origin=manual）。 */
  reviseChapterContent(
    chapterId: string,
    query: string,
    replacement: string,
  ): Promise<{ count: number }>;
  runGlobalConsistencyCheck(novelId: string): Promise<GlobalFinding[]>;
  runGlobalReview(novelId: string): Promise<void>;
  /** AN-032：全书分窗口 AI 通读审稿（逐窗口留痕，结果进全局审查台账）。 */
  runWholeBookReview(novelId: string, windowSize?: number): Promise<void>;
  dismissGlobalFinding(novelId: string, id: string): Promise<void>;
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
let activityListenerBound = false;
/** 自动审阅：每个作品的轮询定时器、防重入锁与连续失败计数。 */
const autoReviewTimers = new Map<string, number>();
const autoReviewTicking = new Set<string>();
const autoReviewFailures = new Map<string, number>();
const AUTO_REVIEW_INTERVAL_MS = 2000;
const AUTO_REVIEW_MAX_FAILURES = 3;
/** 任务状态超过该时长无更新视为运行器丢失（应用重启等），自动重新接管。 */
const AUTO_REVIEW_STALE_MS = 5 * 60_000;
const AUTO_REVIEW_STORAGE_KEY = "amy-novel:auto-review";

/** 读取持久化的自动审阅作品列表（刷新/重启后断点续跑，AN-028）。 */
function readPersistedAutoReview(): string[] {
  try {
    const raw = window.localStorage.getItem(AUTO_REVIEW_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function persistAutoReviewIds(ids: string[]) {
  try {
    window.localStorage.setItem(AUTO_REVIEW_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // 持久化失败不阻断开关本身（隐身模式/配额满）。
  }
}

/** 仅更新横幅文案（不重建定时器）；内容不变时跳过，避免 2 秒一次的重渲染。 */
function noteAutoReview(novelId: string, message: string) {
  const state = useNovelStore.getState();
  const current = state.autoReview[novelId];
  if (!current?.enabled || current.message === message) return;
  useNovelStore.setState({
    autoReview: {
      ...state.autoReview,
      [novelId]: { ...current, message },
    },
  });
}

/** AN-035 巡航：定时器、防重入锁、失败计数与持久化。 */
const CRUISE_INTERVAL_MS = 3000;
const CRUISE_STORAGE_KEY = "amy-novel:cruise";
const cruiseTimers = new Map<string, number>();
const cruiseTicking = new Set<string>();
const cruiseFailures = new Map<string, number>();

function readPersistedCruise(): Record<string, CruiseState> {
  try {
    const raw = window.localStorage.getItem(CRUISE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, CruiseState>)
      : {};
  } catch {
    return {};
  }
}

function persistCruiseStates(states: Record<string, CruiseState>) {
  try {
    window.localStorage.setItem(CRUISE_STORAGE_KEY, JSON.stringify(states));
  } catch {
    // 持久化失败不阻断巡航本身。
  }
}

function armCruiseTimer(novelId: string) {
  const timer = cruiseTimers.get(novelId);
  if (timer !== undefined) window.clearInterval(timer);
  cruiseTimers.set(
    novelId,
    window.setInterval(
      () => void useNovelStore.getState().tickCruise(novelId),
      CRUISE_INTERVAL_MS,
    ),
  );
}

function noteCruise(novelId: string, message: string) {
  const state = useNovelStore.getState();
  const current = state.cruise[novelId];
  if (!current?.enabled || current.message === message) return;
  const next = { ...current, message, updatedAt: new Date().toISOString() };
  useNovelStore.setState({
    cruise: { ...state.cruise, [novelId]: next },
  });
}

/** 巡航暂停：停在原地、记录原因、等待作者「继续巡航」。 */
function pauseCruise(novelId: string, message: string) {
  const state = useNovelStore.getState();
  const current = state.cruise[novelId];
  if (!current?.enabled || current.status === "paused") return;
  const next = {
    ...current,
    status: "paused" as const,
    message,
    updatedAt: new Date().toISOString(),
  };
  useNovelStore.setState({ cruise: { ...state.cruise, [novelId]: next } });
  persistCruiseStates(useNovelStore.getState().cruise);
}
function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function modelErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : "";
  return /timeout|timed out|aborted|超时/i.test(message)
    ? "模型等待超时，请检查连接或更换模型后重试"
    : message || fallback;
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
  styleTemplates: [],
  candidates: {},
  batches: [],
  jobs: {},
  activityEvents: {},
  findings: {},
  factProposals: {},
  planningWorkflows: {},
  planningRuns: {},
  planningCycles: {},
  planningProposals: {},
  workflowRuns: {},
  personaDrafts: {},
  personaBusy: {},
  personaMessage: {},
  planningBusy: {},
  planningMessage: {},
    autoReview: {},
    cruise: {},
  globalFindings: {},
  activeRequests: {},
  draftedBrief: null,
  briefDraftBusy: false,
  briefDraftError: "",
  async suggestScope(input) {
    return platform.suggestNovelScope(input);
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
        briefDraftError: modelErrorMessage(error, "简报起草失败"),
      });
      return null;
    }
  },
  clearDraftedBrief() {
    set({ draftedBrief: null, briefDraftError: "" });
  },
  async suggestPersonas(novelId) {
    set({
      personaBusy: { ...get().personaBusy, [novelId]: true },
      personaMessage: { ...get().personaMessage, [novelId]: "" },
    });
    try {
      const suggestions = await platform.suggestPersonaLineup(novelId);
      set({
        personaDrafts: { ...get().personaDrafts, [novelId]: suggestions },
        personaBusy: { ...get().personaBusy, [novelId]: false },
      });
      return suggestions;
    } catch (error) {
      set({
        personaBusy: { ...get().personaBusy, [novelId]: false },
        personaMessage: {
          ...get().personaMessage,
          [novelId]: `人格推荐失败：${modelErrorMessage(error, "未知错误")}`,
        },
      });
      return null;
    }
  },
  updatePersonaDraft(novelId, entityName, patch) {
    const list = get().personaDrafts[novelId] ?? [];
    set({
      personaDrafts: {
        ...get().personaDrafts,
        [novelId]: list.map((item) =>
          item.entityName === entityName ? { ...item, ...patch } : item,
        ),
      },
    });
  },
  async confirmPersonas(novelId, suggestions) {
    const entities = await platform.listStoryEntities(novelId);
    let written = 0;
    for (const suggestion of suggestions) {
      const entity = entities.find(
        (item) =>
          item.type === "character" &&
          (item.name === suggestion.entityName ||
            item.aliases.includes(suggestion.entityName)),
      );
      if (!entity) continue;
      await platform.saveStoryEntity({
        id: entity.id,
        novelId,
        type: "character",
        name: entity.name,
        summary: entity.summary,
        aliases: entity.aliases,
        profile: {
          ...entity.profile,
          人格: suggestion.personaType,
          人格推荐理由: suggestion.reason,
          写作约束: suggestion.writingConstraints,
          ...(suggestion.speechHabit.trim()
            ? { 语言习惯: suggestion.speechHabit }
            : {}),
        },
      });
      written++;
    }
    await get().loadEntities(novelId);
    set({ personaDrafts: { ...get().personaDrafts, [novelId]: [] } });
    return written;
  },
  ensureActivityListener() {
    if (activityListenerBound || !platform.onGenerationEvent) return;
    activityListenerBound = true;
    platform.onGenerationEvent((event) => get().appendActivity(event));
  },
  async loadActivity(batchId) {
    const events = await platform.listGenerationEvents(batchId);
    set({ activityEvents: { ...get().activityEvents, [batchId]: events } });
    return events;
  },
  appendActivity(event) {
    const list = get().activityEvents[event.batchId] ?? [];
    if (list.some((item) => item.id === event.id)) return;
    set({
      activityEvents: {
        ...get().activityEvents,
        [event.batchId]: [...list, event].slice(-300),
      },
    });
    // 批次级停点/终点事件到达时，同步收敛挂在该批次上的 workflow run。
    if (
      event.stage === "batch_completed" ||
      event.stage === "batch_paused" ||
      event.stage === "awaiting_review"
    )
      void get().syncWorkflowRunFromBatch(event.batchId);
  },
  setPlanningMessage(novelId, message) {
    set({
      planningMessage: { ...get().planningMessage, [novelId]: message },
    });
  },
  loading: false,
  initialized: false,
  async loadNovels() {
    // Web 端首屏读取前必须等 IndexedDB 装载/迁移完成（Electron 端立即返回）。
    await platform.ready();
    set({ loading: true });
    try {
      set({ novels: await platform.listNovels() });
    } finally {
      set({ loading: false, initialized: true });
    }
  },
  async deleteNovel(id) {
    await platform.deleteNovel(id);
    const state = get(),
      removedBatchIds = state.batches
        .filter((item) => item.novelId === id)
        .map((item) => item.id),
      activityEvents = { ...state.activityEvents };
    for (const batchId of removedBatchIds) delete activityEvents[batchId];
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
      workflowRuns: omitKey(state.workflowRuns, id),
      planningBusy: omitKey(state.planningBusy, id),
      planningMessage: omitKey(state.planningMessage, id),
      personaDrafts: omitKey(state.personaDrafts, id),
      personaBusy: omitKey(state.personaBusy, id),
      personaMessage: omitKey(state.personaMessage, id),
      activityEvents,
      usage: state.usage.filter((item) => item.novelId !== id),
    });
  },
  async createNovel(input, scopeAdvice) {
    const result = await platform.createNovel(input);
    const workflow = scopeAdvice
      ? await platform.savePlanningWorkflow({
          ...defaultPlanningWorkflow(result.novel.id),
          scopeAdvice,
        })
      : defaultPlanningWorkflow(result.novel.id);
    set({
      novels: [result.novel, ...get().novels],
      chapters: { ...get().chapters, [result.novel.id]: result.chapters },
      planningWorkflows: {
        ...get().planningWorkflows,
        [result.novel.id]: workflow,
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
          [novelId]: `生成失败：${modelErrorMessage(error, "未知错误")}`,
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
  async loadWorkflowRuns(novelId) {
    const runs = await platform.listWorkflowRuns(novelId);
    set({ workflowRuns: { ...get().workflowRuns, [novelId]: runs } });
    return runs;
  },
  async startWorkflowRun(novelId, mode, policy) {
    const run = await platform.createWorkflowRun({
      novelId,
      mode,
      config: { generationPolicy: policy, maxPhaseRetries: 2 },
    });
    set({
      workflowRuns: {
        ...get().workflowRuns,
        [novelId]: [run, ...(get().workflowRuns[novelId] ?? [])],
      },
    });
    return get().resumeWorkflowRun(run.id);
  },
  async resumeWorkflowRun(runId) {
    const run = Object.values(get().workflowRuns)
      .flat()
      .find((item) => item.id === runId);
    if (!run) throw new Error("Workflow run 不存在");
    const running = { ...run, status: "running" as const, error: "" };
    set({
      workflowRuns: {
        ...get().workflowRuns,
        [run.novelId]: (get().workflowRuns[run.novelId] ?? []).map((item) =>
          item.id === run.id ? running : item,
        ),
      },
    });
    const result = await resumeWorkflowRun(
      {
        ...platform,
        startBackgroundBatch: (batchId) => get().dispatchBatch(batchId),
      },
      run,
    );
    await Promise.all([
      get().loadWorkflowRuns(run.novelId),
      get().loadPlanningWorkflow(run.novelId),
      get().loadPlanningRuns(run.novelId),
      get().loadPlanningCycles(run.novelId),
      get().loadPlanningProposals(run.novelId),
      get().loadChapters(run.novelId),
      get().loadBible(run.novelId),
      get().loadEntities(run.novelId),
      get().loadStructure(run.novelId),
      get().loadBatches(),
    ]);
    return result;
  },
  /** 批次事件到达时把后台批次状态收敛回运行中的 workflow run（Electron 后台执行路径）。 */
  async syncWorkflowRunFromBatch(batchId) {
    const run = Object.values(get().workflowRuns)
      .flat()
      .find((item) => item.batchId === batchId && item.status === "running");
    if (!run) return;
    const batches = await platform.listGenerationBatches();
    const batch = batches.find((item) => item.id === batchId);
    const update = batch ? workflowRunUpdateFromBatch(batch) : null;
    if (!update) return;
    const next = await platform.updateWorkflowRun({ id: run.id, ...update });
    set({
      workflowRuns: {
        ...get().workflowRuns,
        [run.novelId]: (get().workflowRuns[run.novelId] ?? []).map((item) =>
          item.id === run.id ? next : item,
        ),
      },
    });
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
    revisionNotes,
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
      characterStates: selectCharacterStates(
        state.characterStates[novelId] ?? [],
        new Map(chapters.map((item) => [item.id, item.position])),
        chapter.position,
      ),
      recentChapters: recent,
      inputBudget,
      outputTokensReserved: outputReserved,
      ...(revisionNotes?.trim() ? { revisionNotes: revisionNotes.trim() } : {}),
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
  async loadStyleTemplates() {
    const styleTemplates = await platform.listStyleTemplates();
    set({ styleTemplates });
    return styleTemplates;
  },
  async analyzeStyleTemplate(input) {
    const item = await platform.analyzeStyleTemplate(input);
    set({ styleTemplates: [item, ...get().styleTemplates] });
    return item;
  },
  async saveStyleTemplate(input) {
    const item = await platform.saveStyleTemplate(input),
      list = get().styleTemplates;
    set({
      styleTemplates: list.some((value) => value.id === item.id)
        ? list.map((value) => (value.id === item.id ? item : value))
        : [item, ...list],
    });
    return item;
  },
  async deleteStyleTemplate(id) {
    await platform.deleteStyleTemplate(id);
    set({ styleTemplates: get().styleTemplates.filter((item) => item.id !== id) });
  },
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
  async editCandidateContent(candidateId, content) {
    const item = await platform.updateChapterCandidateContent(
      candidateId,
      content,
    );
    const list = get().candidates[item.chapterId] ?? [];
    set({
      candidates: {
        ...get().candidates,
        [item.chapterId]: list.map((value) =>
          value.id === item.id ? item : value,
        ),
      },
    });
    return item;
  },
  async retryGenerationJob(batchId, jobId) {
    await platform.updateGenerationJob(jobId, "queued", {
      attempt: 0,
      error: "",
    });
    await get().setBatchStatus(batchId, "queued");
    await get().dispatchBatch(batchId);
  },
  async retryFailedJobs(batchId) {
    const jobs = get().jobs[batchId] ?? (await get().loadJobs(batchId));
    const failed = jobs.filter((item) => item.status === "failed");
    for (const job of failed)
      await platform.updateGenerationJob(job.id, "queued", {
        attempt: 0,
        error: "",
      });
    if (failed.length) {
      await get().setBatchStatus(batchId, "queued");
      await get().dispatchBatch(batchId);
    }
    return failed.length;
  },
  async regenerateGenerationJob(batchId, jobId, revisionNotes) {
    // 旧候选稿保留在历史里用于追溯；清空任务指向后按最新正史重写本章。
    // 带审查反馈时，重写上下文会注入“审查修订要求”（AN-023/AN-027）。
    await platform.updateGenerationJob(jobId, "queued", {
      candidateId: null,
      attempt: 0,
      error: "",
      ...(revisionNotes?.trim() ? { revisionNotes: revisionNotes.trim() } : {}),
    });
    await get().setBatchStatus(batchId, "queued");
    await get().dispatchBatch(batchId);
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
  async setBatchStatus(id, status, patch) {
    if (
      (status === "paused" || status === "cancelled") &&
      platform.host === "electron"
    ) {
      // 先中断运行器（会写入 paused），再落最终状态。
      await platform.pauseBackgroundBatch(id);
      if (status === "cancelled")
        await platform.setBatchStatus(id, "cancelled");
    } else {
      if (status === "paused" || status === "cancelled") {
        const current = (get().jobs[id] ?? []).find(
            (item) => item.status === "generating",
          ),
          requestId = current
            ? activeChapterRequests.get(current.chapterId)
            : undefined;
        if (requestId) await platform.cancelGeneration(requestId);
      }
      await platform.setBatchStatus(id, status, patch);
    }
    await get().loadBatches();
  },
  async deleteBatch(id) {
    await platform.deleteGenerationBatch(id);
    set({
      batches: get().batches.filter((item) => item.id !== id),
      jobs: omitKey(get().jobs, id),
    });
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
  async reviewFactProposal(candidateId, id, accept, options) {
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
          characterName = parsed.payload.characterName;
        let character = entities.find(
          (entity) =>
            entity.name === characterName ||
            entity.aliases.includes(characterName),
        );
        // 全自动模式（AN-028）：新出场角色先建最小实体卡再写状态，
        // 否则每遇到一个圣经外角色都会打断自动审阅。人工路径保持
        // 原有报错，避免悄悄扩员。
        if (
          !character &&
          options?.autoCreateCharacter &&
          characterName.trim()
        ) {
          character = await platform.saveStoryEntity({
            novelId: chapter.novelId,
            type: "character",
            name: characterName.trim(),
            summary: `由正史建议自动建档：首次出场于第 ${chapter.position} 章，资料待补。`,
            aliases: [],
            profile: {},
          });
          await get().loadEntities(chapter.novelId);
        }
        if (!character)
          throw new Error(
            `未找到角色“${characterName}”，请先在故事圣经中建立或补充别名`,
          );
        await platform.saveCharacterState({
          novelId: chapter.novelId,
          characterId: character.id,
          chapterId: chapter.id,
          summary: parsed.payload.summary,
          location: parsed.payload.location,
          appearance: parsed.payload.appearance,
          outfit: parsed.payload.outfit,
          identity: parsed.payload.identity,
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
      // AN-027：正史记忆变化后增量跑一次确定性全局校验（不阻塞审核操作）。
      void get()
        .runGlobalConsistencyCheck(chapter.novelId)
        .catch(() => undefined);
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
  setAutoReview(novelId, enabled, message = "") {
    set({
      autoReview: {
        ...get().autoReview,
        [novelId]: { enabled, message },
      },
    });
    // AN-028：开关持久化到 localStorage——刷新/重启不再静默丢掉全自动模式；
    // 关闭（含各类自动停用）时同步清除，重启后不会复活已停用的模式。
    const persisted = new Set(readPersistedAutoReview());
    if (enabled) persisted.add(novelId);
    else persisted.delete(novelId);
    persistAutoReviewIds([...persisted]);
    autoReviewFailures.delete(novelId);
    const timer = autoReviewTimers.get(novelId);
    if (timer !== undefined) {
      window.clearInterval(timer);
      autoReviewTimers.delete(novelId);
    }
    if (!enabled) return;
    void get().tickAutoReview(novelId);
    autoReviewTimers.set(
      novelId,
      window.setInterval(
        () => void get().tickAutoReview(novelId),
        AUTO_REVIEW_INTERVAL_MS,
      ),
    );
  },
  async tickAutoReview(novelId) {
    if (!get().autoReview[novelId]?.enabled || autoReviewTicking.has(novelId))
      return;
    autoReviewTicking.add(novelId);
    try {
      const batches = await get().loadBatches();
      const active =
        batches.find(
          (item) => item.novelId === novelId && item.awaitingReview,
        ) ??
        batches.find(
          (item) =>
            item.novelId === novelId &&
            item.status !== "completed" &&
            item.status !== "cancelled",
        );
      if (!active) {
        // 没有进行中的批次：本批已完成则自动收工，否则保持待命等新批次。
        if (
          batches.some(
            (item) =>
              item.novelId === novelId &&
              item.status === "completed" &&
              item.outputTokensUsed > 0,
          )
        )
          get().setAutoReview(
            novelId,
            false,
            "本批次已全部完成，自动接受已自动关闭。",
          );
        return;
      }
      const jobs = await get().loadJobs(active.id);
      const ready = [...jobs]
        .filter((item) => item.status === "candidate_ready")
        .sort((a, b) => a.position - b.position)[0];
      const emit = async (chapterId: string | null, message: string) => {
        const event = await platform.appendGenerationEvent?.({
          batchId: active.id,
          novelId,
          chapterId,
          stage: "auto_review",
          level: "info",
          message,
          data: { auto: true },
        });
        if (event) get().appendActivity(event);
      };
      const candidate =
        ready?.candidateId === null || ready?.candidateId === undefined
          ? null
          : Object.values(get().candidates)
                .flat()
                .find((item) => item.id === ready.candidateId) ??
            (
              await platform.listChapterCandidates(ready.chapterId)
            ).find((item) => item.id === ready.candidateId);
      if (candidate?.status === "candidate") {
        // 质量安全门（AUTOPILOT_WORKFLOW.md §6）：存在未解决的 error 级检查
        // 问题时不得自动接受，交还作者人工处理。
        if (!get().findings[candidate.id])
          await get().loadQuality(candidate.id);
        const blocking = (get().findings[candidate.id] ?? []).filter(
          (item) => item.severity === "error" && item.status === "open",
        );
        // AN-027 全局门：确定性校验发现 error（引用悬空等数据完整性问题）同样阻断。
        const globalBlocking = await get()
          .collectGlobalErrors(novelId)
          .catch(() => [] as string[]);
        if (blocking.length || globalBlocking.length) {
          get().setAutoReview(
            novelId,
            false,
            blocking.length
              ? `本章有 ${blocking.length} 项未解决的 error 级检查问题，自动接受已暂停；请人工处理后再重新开启。`
              : `全局一致性校验发现 ${globalBlocking.length} 项 error（${globalBlocking[0]}），自动接受已暂停。`,
          );
          return;
        }
        // 第一步：接受候选稿（与作者点击“接受并写入正文”同一门禁）。
        await get().reviewCandidate(candidate.id, true);
        await emit(
          candidate.chapterId,
          "自动审阅：已接受本章候选稿并写入正史。",
        );
        await get().loadQuality(candidate.id);
        noteAutoReview(novelId, "");
        autoReviewFailures.delete(novelId);
        return;
      }
      if (candidate?.status === "accepted") {
        if (!get().factProposals[candidate.id])
          await get().loadQuality(candidate.id);
        const pending = (get().factProposals[candidate.id] ?? []).filter(
          (item) => item.status === "proposed",
        );
        if (pending.length) {
          // 第二步：逐条接受正史建议（timeline / 角色状态 / 伏笔，
          // source=ai_candidate）。AN-028：单条失败不再打断整批——新角色
          // 提案自动建档，其余建议照常处理；只有全部失败才计入
          // 自动模式的连续失败次数。
          let accepted = 0;
          const failures: string[] = [];
          for (const proposal of pending) {
            try {
              await get().reviewFactProposal(candidate.id, proposal.id, true, {
                autoCreateCharacter: true,
              });
              accepted++;
            } catch (error) {
              failures.push(
                `「${proposal.title}」${
                  error instanceof Error ? error.message : "处理失败"
                }`,
              );
            }
          }
          await emit(
            candidate.chapterId,
            failures.length
              ? `自动审阅：已接受 ${accepted} 条正史建议，${failures.length} 条待人工处理（${failures[0]}）。`
              : `自动审阅：已接受 ${accepted} 条正史建议。`,
          );
          if (accepted > 0) {
            noteAutoReview(novelId, "");
            autoReviewFailures.delete(novelId);
            return;
          }
          throw new Error(failures[0] ?? "正史建议处理失败");
        }
      }
      if (candidate?.status === "rejected") {
        // 候选稿被拒绝过（含人工拒绝）：自动模式让位给人工处理。
        get().setAutoReview(
          novelId,
          false,
          "本章候选稿此前被拒绝，等待人工“重试本章”后再重新开启自动接受。",
        );
        return;
      }
      // 第三步：没有待处理的候选与建议时，若批次在等待审核则恢复写下一章
      // （相当于点击“继续生成下一章”；全部写完由运行器收敛为 completed）。
      if (active.awaitingReview) {
        await get().dispatchBatch(active.id);
        await emit(null, "自动审阅：继续生成下一章。");
        noteAutoReview(novelId, "");
        return;
      }
      // AN-028：批次存在但既无待审内容也不在等待审核——把状态写进横幅，
      // 消灭“开关亮着却毫无动静”的静默假死。
      if (active.status === "paused")
        noteAutoReview(
          novelId,
          "批次已暂停（手动暂停或预算耗尽）。到生成工作台恢复批次后，自动接受会立即继续。",
        );
      else if (active.status === "queued")
        noteAutoReview(
          novelId,
          "该批次仍在排队、尚未开始生成。若存在多个批次，请到生成工作台选择要运行的批次，并停止多余的批次。",
        );
      else if (active.status === "running") {
        // 应用重启会让批次状态停在 running 但运行器已丢失（任务卡在
        // generating 或无人推进）。BatchRunner.start 有单例守卫，误判时
        // 重复接管是安全的空操作。
        const generating = jobs.filter((item) => item.status === "generating"),
          runnerLost =
            generating.length === 0 ||
            generating.every(
              (item) =>
                Date.now() - new Date(item.updatedAt).getTime() >
                AUTO_REVIEW_STALE_MS,
            );
        if (runnerLost) {
          await get().dispatchBatch(active.id);
          await emit(
            null,
            "自动审阅：检测到批次中断（应用重启或运行器丢失），已重新接管继续。",
          );
        } else
          noteAutoReview(novelId, "正在生成章节正文，完成后自动审阅。");
      }
      return;
    } catch (error) {
      const failures = (autoReviewFailures.get(novelId) ?? 0) + 1;
      autoReviewFailures.set(novelId, failures);
      if (failures >= AUTO_REVIEW_MAX_FAILURES) {
        const message =
          error instanceof Error ? error.message : "自动审阅连续失败";
        get().setAutoReview(
          novelId,
          false,
          `自动接受已停止：连续 ${failures} 次失败（${message}）。请人工处理后重新开启。`,
        );
      }
    } finally {
      autoReviewTicking.delete(novelId);
    }
  },
  startCruise(novelId, targetChapter) {
    const entry: CruiseState = {
      enabled: true,
      status: "active",
      targetChapter,
      message: "巡航已开启：正在检查当前进度…",
      updatedAt: new Date().toISOString(),
    };
    set({ cruise: { ...get().cruise, [novelId]: entry } });
    persistCruiseStates(get().cruise);
    get().setAutoReview(novelId, true, "巡航模式：自动接受已联动开启。");
    cruiseFailures.delete(novelId);
    armCruiseTimer(novelId);
    void get().tickCruise(novelId);
  },
  stopCruise(novelId, message = "") {
    set({ cruise: omitKey(get().cruise, novelId) });
    persistCruiseStates(get().cruise);
    const timer = cruiseTimers.get(novelId);
    if (timer !== undefined) {
      window.clearInterval(timer);
      cruiseTimers.delete(novelId);
    }
    cruiseFailures.delete(novelId);
    if (message) get().setAutoReview(novelId, false, message);
  },
  resumeCruise(novelId) {
    const current = get().cruise[novelId];
    if (!current?.enabled) return;
    set({
      cruise: {
        ...get().cruise,
        [novelId]: {
          ...current,
          status: "active",
          message: "已继续巡航：正在检查进度…",
          updatedAt: new Date().toISOString(),
        },
      },
    });
    persistCruiseStates(get().cruise);
    get().setAutoReview(novelId, true, "巡航模式：自动接受已联动开启。");
    cruiseFailures.delete(novelId);
    armCruiseTimer(novelId);
    void get().tickCruise(novelId);
  },
  async tickCruise(novelId) {
    const cruise = get().cruise[novelId];
    if (!cruise?.enabled || cruise.status !== "active" || cruiseTicking.has(novelId))
      return;
    // 巡航的正文段依赖自动审阅（候选稿 + 正史建议 + 续写下一章）。
    if (!get().autoReview[novelId]?.enabled)
      get().setAutoReview(novelId, true, "巡航模式：自动接受已联动开启。");
    cruiseTicking.add(novelId);
    try {
      const novel =
        get().novels.find((item) => item.id === novelId) ??
        (await platform.listNovels()).find((item) => item.id === novelId);
      if (!novel) throw new Error("作品不存在");
      const runs =
        get().workflowRuns[novelId] ??
        (await get().loadWorkflowRuns(novelId), get().workflowRuns[novelId] ?? []);
      const run = runs[0];
      if (!run) {
        // 没有运行记录：从已封存进度推起始周期并启动规划。
        const cycles =
          get().planningCycles[novelId] ??
          ((await get().loadPlanningCycles(novelId)),
          get().planningCycles[novelId] ?? []);
        const lastSealedEnd = cycles
          .filter((item) => item.status === "completed")
          .reduce((max, item) => Math.max(max, item.endChapter), 0);
        const totalCeiling = Math.min(
          cruise.targetChapter,
          novel.targetChapters,
        );
        const startChapter = lastSealedEnd + 1;
        if (startChapter > totalCeiling) {
          get().stopCruise(
            novelId,
            `巡航目标已达成（第 ${totalCeiling} 章），自动接受已收工。`,
          );
          return;
        }
        const endChapter = Math.min(
          startChapter + novel.cycleSize - 1,
          totalCeiling,
        );
        await get().startWorkflowRun(novelId, "autopilot", {
          startChapter,
          endChapter,
          chapterWords: novel.chapterWords,
          continuityCheck: true,
          maxRetries: 2,
          approvalMode: "candidate",
          outputTokenBudget: 120000,
          concurrency: 1,
          deepThinking: false,
        });
        noteCruise(novelId, `开始规划第 ${startChapter}–${endChapter} 章…`);
        return;
      }
      if (run.status === "running") {
        noteCruise(
          novelId,
          `推进中：${WORKFLOW_PHASE_LABELS[run.currentPhase]}（目标第 ${cruise.targetChapter} 章）`,
        );
        return;
      }
      if (run.status === "failed") {
        pauseCruise(
          novelId,
          `运行失败已暂停：${run.error || "未知错误"}。排查后点「继续巡航」从中断处续跑。`,
        );
        return;
      }
      if (run.status === "paused") {
        if (run.checkpoint === "proposal_review") {
          // 巡航核心授权：设定提案由作者委托自动接受（与正文建议同一语义）。
          const proposals =
            get().planningProposals[novelId] ??
            ((await get().loadPlanningProposals(novelId)),
            get().planningProposals[novelId] ?? []);
          const pending = proposals.filter((item) => item.status === "pending");
          for (const item of pending)
            await get().reviewPlanningProposal(novelId, item.id, true);
          await get().resumeWorkflowRun(run.id);
          noteCruise(
            novelId,
            `已自动接受 ${pending.length} 条设定提案，继续规划。`,
          );
          return;
        }
        if (run.checkpoint === "phase_review") {
          // 非巡航创建的检查点运行：直接代点「继续运行」。
          await get().resumeWorkflowRun(run.id);
          return;
        }
        if (run.checkpoint === "chapter_review") {
          noteCruise(novelId, "正文审阅中：自动接受正在处理候选稿与正史建议。");
          return;
        }
        // 无检查点的暂停：批次被暂停（预算耗尽或手动）。
        const batch = (await get().loadBatches()).find(
          (item) => item.id === run.batchId,
        );
        if (!batch) {
          pauseCruise(novelId, "运行对应的批次不存在，请人工检查。");
          return;
        }
        if (batch.outputTokensUsed >= batch.policy.outputTokenBudget) {
          pauseCruise(
            novelId,
            `批次 Token 预算耗尽（${batch.outputTokensUsed.toLocaleString()} / ${batch.policy.outputTokenBudget.toLocaleString()}）。续费或调高预算后点「继续巡航」。`,
          );
          return;
        }
        await get().dispatchBatch(batch.id);
        return;
      }
      // run.status === "completed"：本周期批次已写完，收尾入正史 → 封存 → 下一周期。
      const policy = run.config.generationPolicy;
      const allChapters =
        get().chapters[novelId] ??
        ((await get().loadChapters(novelId)), get().chapters[novelId] ?? []);
      const rangeChapters = allChapters.filter(
        (item) =>
          item.position >= policy.startChapter && item.position <= policy.endChapter,
      );
      if (!rangeChapters.length) {
        pauseCruise(novelId, "周期范围内没有章节，请人工检查章节目录。");
        return;
      }
      const acceptedCount = rangeChapters.filter(
        (item) => item.status === "accepted",
      ).length;
      if (acceptedCount < rangeChapters.length) {
        const auto = get().autoReview[novelId];
        if (!auto?.enabled) {
          pauseCruise(
            novelId,
            `自动接受已停止（${auto?.message ?? "原因未知"}），第 ${policy.startChapter}–${policy.endChapter} 章还有 ${rangeChapters.length - acceptedCount} 章未入正史。处理后续跑。`,
          );
          return;
        }
        noteCruise(
          novelId,
          `正文入正史中：${acceptedCount}/${rangeChapters.length} 章（第 ${policy.startChapter}–${policy.endChapter} 章）。`,
        );
        return;
      }
      // AN-027 封存门禁：全局校验 error 阻断（含悬空引用等数据完整性问题）。
      const globalErrors = await get().collectGlobalErrors(novelId);
      if (globalErrors.length) {
        pauseCruise(
          novelId,
          `全局一致性校验发现 ${globalErrors.length} 项 error（${globalErrors[0]}）。到「连续性 → 故事总览/全局审查」处理后续跑。`,
        );
        return;
      }
      const cycles =
        get().planningCycles[novelId] ??
        ((await get().loadPlanningCycles(novelId)),
        get().planningCycles[novelId] ?? []);
      const cycle = cycles.find(
        (item) =>
          policy.startChapter >= item.startChapter &&
          policy.endChapter <= item.endChapter &&
          ["ready", "generating", "memory_review"].includes(item.status),
      );
      if (!cycle) {
        pauseCruise(novelId, "未找到本周期策划包，请人工检查。");
        return;
      }
      // 封存：实际结束状态从最新正史记忆确定性起草（作者可事后改写）。
      await get().loadContinuity(novelId);
      if (!get().entities[novelId]) await get().loadEntities(novelId);
      const draft = draftClosingState({
        cycle,
        chapters: rangeChapters,
        entities: get().entities[novelId] ?? [],
        timeline: get().timelineEvents[novelId] ?? [],
        characterStates: get().characterStates[novelId] ?? [],
        foreshadow: get().foreshadowThreads[novelId] ?? [],
      });
      await get().savePlanningCycle({
        ...cycle,
        status: "completed",
        actualClosingState: draft,
      });
      await get().invalidatePlanning(novelId, 7);
      const totalCeiling = Math.min(cruise.targetChapter, novel.targetChapters);
      const next = nextCycleRange({
        sealedEndChapter: policy.endChapter,
        targetChapter: cruise.targetChapter,
        cycleSize: novel.cycleSize,
        totalChapters: novel.targetChapters,
      });
      if (!next || next.startChapter > totalCeiling) {
        get().stopCruise(
          novelId,
          `巡航完成：已写到第 ${Math.min(policy.endChapter, totalCeiling)} 章（目标 ${cruise.targetChapter} 章），本批已封存。`,
        );
        return;
      }
      await get().startWorkflowRun(novelId, "autopilot", {
        ...cruisePolicy(policy, next),
      });
      noteCruise(
        novelId,
        `第 ${policy.startChapter}–${policy.endChapter} 章已封存，开始规划第 ${next.startChapter}–${next.endChapter} 章。`,
      );
      cruiseFailures.delete(novelId);
    } catch (error) {
      const failures = (cruiseFailures.get(novelId) ?? 0) + 1;
      cruiseFailures.set(novelId, failures);
      if (failures >= 3) {
        pauseCruise(
          novelId,
          `巡航连续 ${failures} 次失败（${
            error instanceof Error ? error.message : "未知错误"
          }）。排查后点「继续巡航」从中断处续跑。`,
        );
      }
    } finally {
      cruiseTicking.delete(novelId);
    }
  },
  async collectGlobalErrors(novelId) {
    if (!get().chapters[novelId]) await get().loadChapters(novelId);
    if (!get().entities[novelId]) await get().loadEntities(novelId);
    if (!get().timelineEvents[novelId] || !get().foreshadowThreads[novelId] ||
        !get().characterStates[novelId])
      await get().loadContinuity(novelId);
    const findings = checkGlobalConsistency({
      chapters: get().chapters[novelId] ?? [],
      entities: get().entities[novelId] ?? [],
      timeline: get().timelineEvents[novelId] ?? [],
      foreshadow: get().foreshadowThreads[novelId] ?? [],
      characterStates: get().characterStates[novelId] ?? [],
    });
    return findings
      .filter((item) => item.severity === "error")
      .map((item) => item.message);
  },
  async loadGlobalFindings(novelId) {
    const findings = await platform.listGlobalFindings(novelId);
    set({ globalFindings: { ...get().globalFindings, [novelId]: findings } });
    return findings;
  },
  async runGlobalConsistencyCheck(novelId) {
    await get().collectGlobalErrors(novelId); // 确保数据已装载
    const ruleFindings = checkGlobalConsistency({
        chapters: get().chapters[novelId] ?? [],
        entities: get().entities[novelId] ?? [],
        timeline: get().timelineEvents[novelId] ?? [],
        foreshadow: get().foreshadowThreads[novelId] ?? [],
        characterStates: get().characterStates[novelId] ?? [],
      }),
      previous = get().globalFindings[novelId] ??
        (await platform.listGlobalFindings(novelId)),
      dismissed = new Set(
        previous
          .filter((item) => item.status === "dismissed")
          .map((item) => item.id),
      ),
      aiFindings = previous.filter((item) => item.source !== "rule"),
      merged = [
        ...ruleFindings.map((item) => ({
          ...item,
          status: dismissed.has(item.id)
            ? ("dismissed" as const)
            : item.status,
        })),
        ...aiFindings,
      ];
    const saved = await platform.saveGlobalFindings(novelId, merged);
    set({ globalFindings: { ...get().globalFindings, [novelId]: saved } });
    return saved;
  },
  async runGlobalReview(novelId) {
    await platform.reviewGlobalConsistency(novelId);
    // 审查会写入新的 AI 发现与设定修复提案，两处都刷新。
    await Promise.all([
      get().loadGlobalFindings(novelId),
      get().loadPlanningProposals(novelId),
    ]);
  },
  async runWholeBookReview(novelId, windowSize) {
    await platform.reviewWholeBook(novelId, windowSize ? { windowSize } : undefined);
    await get().loadGlobalFindings(novelId);
  },
  async dismissGlobalFinding(novelId, id) {
    const previous = get().globalFindings[novelId] ?? [],
      updated = previous.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "dismissed" as const,
            }
          : item,
      );
    const saved = await platform.saveGlobalFindings(novelId, updated);
    set({ globalFindings: { ...get().globalFindings, [novelId]: saved } });
  },
  async addAuthorFinding(novelId, position, message) {
    const text = message.trim();
    if (!text) throw new Error("疑点内容不能为空");
    const previous =
      get().globalFindings[novelId] ??
      (await platform.listGlobalFindings(novelId));
    const now = new Date().toISOString();
    const saved = await platform.saveGlobalFindings(novelId, [
      ...previous,
      {
        id: `author:${now}:${position}`,
        novelId,
        source: "author",
        severity: "warning",
        category: "consistency",
        message: text,
        evidence: `第 ${position} 章连读标记`,
        chapterPosition: position,
        status: "open",
        createdAt: now,
      },
    ]);
    set({ globalFindings: { ...get().globalFindings, [novelId]: saved } });
  },
  async reviseChapterContent(chapterId, query, replacement) {
    const chapter = await get().getChapter(chapterId);
    if (!chapter) throw new Error("章节不存在");
    const { content, count } = replaceAllInContent(
      chapter.content,
      query,
      replacement,
    );
    if (!count) return { count: 0 };
    await platform.saveChapter({
      chapterId,
      title: chapter.title,
      outline: chapter.outline,
      content,
      createSnapshot: true,
      origin: "manual",
    });
    await get().loadChapters(chapter.novelId);
    return { count };
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
    const gate = approvalGateEnabled(batch.policy),
      // Web 端批次在渲染进程执行：过程事件直接写本地并进入活动日志。
      emit = async (input: NewGenerationEvent) => {
        const event = await platform.appendGenerationEvent?.(input);
        if (event) get().appendActivity(event);
      };
    await get().setBatchStatus(batchId, "running");
    await emit({
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
    let jobs = await get().loadJobs(batchId);
    while (true) {
      const currentBatch = get().batches.find((item) => item.id === batchId);
      if (
        currentBatch?.status === "paused" ||
        currentBatch?.status === "cancelled"
      )
        return;
      // 审批门：前面的章节全部确认为正史后，才允许生成本章。
      const nextPosition = nextRunnableJob(jobs)?.position ?? Infinity,
        blocking = [...jobs]
          .sort((a, b) => a.position - b.position)
          .find(
            (item) =>
              item.position < nextPosition && item.status === "candidate_ready",
          );
      if (gate && blocking) {
        await get().setBatchStatus(batchId, "paused", {
          awaitingReview: true,
        });
        await emit({
          batchId,
          novelId: batch.novelId,
          chapterId: blocking.chapterId,
          stage: "awaiting_review",
          level: "info",
          message: "上一章候选稿尚未确认为正史，已暂停等待审核",
          data: { position: blocking.position },
        });
        return;
      }
      const job = nextRunnableJob(jobs);
      if (!job) break;
      if (
        currentBatch &&
        currentBatch.outputTokensUsed >= currentBatch.policy.outputTokenBudget
      ) {
        await get().setBatchStatus(batchId, "paused");
        await emit({
          batchId,
          novelId: batch.novelId,
          chapterId: null,
          stage: "batch_paused",
          level: "warning",
          message: `已达到单批输出预算 ${currentBatch.policy.outputTokenBudget.toLocaleString()} tokens，安全暂停`,
          data: { outputTokensUsed: currentBatch.outputTokensUsed },
        });
        return;
      }
      try {
        const chapterList = (get().chapters[batch.novelId] ?? []).length
            ? get().chapters[batch.novelId]
            : await get().loadChapters(batch.novelId),
          chapter = chapterList.find((item) => item.id === job.chapterId);
        if (chapter)
          await emit({
            batchId,
            novelId: batch.novelId,
            chapterId: chapter.id,
            stage: "context_build",
            level: "info",
            message: `正在整理第 ${chapter.position} 章上下文`,
            data: { position: chapter.position, attempt: job.attempt + 1 },
          });
        await platform.updateGenerationJob(job.id, "building_context", {
          attempt: job.attempt + 1,
          error: "",
        });
        jobs = await get().loadJobs(batchId);
        const candidateChain = jobs
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
          job.revisionNotes,
        );
        await emit({
          batchId,
          novelId: batch.novelId,
          chapterId: job.chapterId,
          stage: "context_build",
          level: "success",
          message: `上下文就绪：约 ${pack.inputTokens.toLocaleString()} tokens`,
          data: { inputTokens: pack.inputTokens, sources: pack.sources.length },
        });
        await platform.updateGenerationJob(job.id, "generating");
        if (chapter)
          await emit({
            batchId,
            novelId: batch.novelId,
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
        let candidate = await get().generateChapter(
          {
            requestId: nanoid(),
            novelId: batch.novelId,
            chapterId: job.chapterId,
            profileId: profile.id,
            contextText: pack.renderedText,
            contextHash: pack.contentHash,
            maxOutputTokens: output,
            temperature: 0.8,
            styleTemplateId: batch.policy.styleTemplateId,
          },
          (event) => {
            if (event.delta) onDelta?.(job.chapterId, event.delta);
          },
        );
        await emit({
          batchId,
          novelId: batch.novelId,
          chapterId: job.chapterId,
          stage: "candidate_saved",
          level: "success",
          message: `候选稿已保存：${candidate.wordCount} 字，输出 ${candidate.outputTokens.toLocaleString()} tokens`,
          data: {
            candidateId: candidate.id,
            wordCount: candidate.wordCount,
            inputTokens: candidate.inputTokens,
            outputTokens: candidate.outputTokens,
            durationMs: Date.now() - generationStartAt,
            model: profile.modelId,
          },
        });
        // 字数不足（多为 max_tokens 截断）：同一上下文补写一次，不整章重写。
        if (
          chapter &&
          countCjkWords(candidate.content) < chapter.targetWords * 0.6
        ) {
          await emit({
            batchId,
            novelId: batch.novelId,
            chapterId: chapter.id,
            stage: "generating",
            level: "warning",
            message: `字数不足（${candidate.wordCount} 字 / 目标 ${chapter.targetWords} 字），正在补写`,
            data: { wordCount: candidate.wordCount, target: chapter.targetWords },
          });
          try {
            const styledContext = applyStyleTemplate(
              pack.renderedText,
              batch.policy.styleTemplateId
                ? (get().styleTemplates.find(
                    (item) => item.id === batch.policy.styleTemplateId,
                  ) ?? null)
                : null,
            );
            const continuation = await platform.continueChapter({
              requestId: nanoid(),
              novelId: batch.novelId,
              chapterId: job.chapterId,
              profileId: profile.id,
              contextHash: pack.contentHash,
              prompt: continuationPrompt(
                styledContext,
                candidate.content,
                chapter.targetWords,
              ),
              maxOutputTokens: output,
              temperature: 0.8,
            });
            const merged = mergeContinuation(
              candidate.content,
              continuation.content,
            );
            candidate = await get().editCandidateContent(candidate.id, merged);
            candidate = {
              ...candidate,
              inputTokens: candidate.inputTokens + continuation.inputTokens,
              outputTokens: candidate.outputTokens + continuation.outputTokens,
            };
            await emit({
              batchId,
              novelId: batch.novelId,
              chapterId: chapter.id,
              stage: "candidate_saved",
              level: "success",
              message: `补写完成，本章共 ${candidate.wordCount} 字`,
              data: {
                wordCount: candidate.wordCount,
                outputTokens: continuation.outputTokens,
              },
            });
          } catch (continueError) {
            if ((continueError as Error)?.name === "AbortError") throw continueError;
            await emit({
              batchId,
              novelId: batch.novelId,
              chapterId: job.chapterId,
              stage: "generating",
              level: "warning",
              message: `补写失败，保留已生成的 ${candidate.wordCount} 字：${continueError instanceof Error ? continueError.message : "未知错误"}`,
              data: {},
            });
          }
        }
        await platform.updateGenerationJob(job.id, "candidate_ready", {
          candidateId: candidate.id,
          inputTokens: candidate.inputTokens,
          outputTokens: candidate.outputTokens,
        });
        await get().loadBatches();
        jobs = await get().loadJobs(batchId);
        // 单章审批制：一章就绪即暂停，等作者改稿、审正史建议再继续。
        if (gate && nextRunnableJob(jobs)) {
          await get().setBatchStatus(batchId, "paused", {
            awaitingReview: true,
          });
          await emit({
            batchId,
            novelId: batch.novelId,
            chapterId: job.chapterId,
            stage: "awaiting_review",
            level: "info",
            message: "本章已可浏览/编辑。接受候选稿并处理正史建议后，点击“继续生成下一章”",
            data: { position: job.position, candidateId: candidate.id },
          });
          return;
        }
      } catch (error) {
        const attempt = job.attempt + 1,
          retryable =
            !(error instanceof ModelRequestError) || error.retryable === true,
          status =
            retryable && attempt <= batch.policy.maxRetries
              ? "waiting_retry"
              : "failed",
          message = error instanceof Error ? error.message : "生成失败";
        await platform.updateGenerationJob(job.id, status, {
          attempt,
          error: message,
        });
        await emit({
          batchId,
          novelId: batch.novelId,
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
    await emit({
      batchId,
      novelId: batch.novelId,
      chapterId: null,
      stage: "batch_completed",
      level: "success",
      message: "本批任务全部完成",
      data: { chapters: jobs.length },
    });
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

// AN-028：启动时恢复上一次的全自动模式。开关在 localStorage、批次进度在
// 数据库里，二者合并即可断点续跑；批次早已完成时首轮 tick 会自动收工。
for (const novelId of readPersistedAutoReview()) {
  if (useNovelStore.getState().autoReview[novelId]?.enabled) continue;
  useNovelStore.getState().setAutoReview(
    novelId,
    true,
    "已恢复上次的全自动连续创作：正在检查批次进度…",
  );
}

// AN-035：启动时恢复巡航。运行与批次进度全部在库里（workflow_runs 检查点），
// 开关持久化在 localStorage；paused 状态保持暂停，作者点「继续巡航」再续跑。
const persistedCruise = readPersistedCruise();
if (Object.keys(persistedCruise).length) {
  useNovelStore.setState({ cruise: persistedCruise });
  for (const [novelId, cruise] of Object.entries(persistedCruise)) {
    if (cruise?.enabled && cruise.status === "active") armCruiseTimer(novelId);
  }
}

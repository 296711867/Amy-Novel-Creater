import type {
  Chapter,
  ChapterVersion,
  CreateChapterInput,
  CreateNovelInput,
  Novel,
  SaveChapterInput,
  UpdateChapterPlanInput,
} from "@domain/novel";
import type {
  SaveSceneInput,
  SaveVolumeInput,
  StoryScene,
  StoryStructure,
  StoryVolume,
} from "@domain/story-structure";
import type { ContextPack } from "@domain/context-pack";
import type { SaveUsageInput, UsageRecord } from "@domain/usage";
import type {
  ModelConnectionResult,
  ModelProfile,
  SaveModelProfileInput,
} from "@domain/model-profile";
import type {
  ChapterCandidate,
  ContinueChapterInput,
  ContinueChapterResult,
  GenerateChapterInput,
  GenerationProgress,
} from "@domain/chapter-generation";
import type { FactProposal, StoredFinding } from "@domain/quality-check";
import type {
  GenerationBatch,
  GenerationEstimate,
  GenerationEvent,
  GenerationJob,
  GenerationJobStatus,
  GenerationPolicy,
  NewGenerationEvent,
} from "@domain/generation";
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
import type { NovelProjectBundle } from "@domain/project-export";
import type { ScopeAdvice } from "@domain/scope-advisor";
import type { PlanningBrief } from "@domain/planning-workflow";
import type { DiagnosticReport } from "@domain/diagnostics";
import type { NovelPlanSummary, PlanPhase, PlanRange } from "@domain/planning";
import type { PlanningWorkflow } from "@domain/planning-workflow";
import type { PlanningRun } from "@domain/planning-run";
import type {
  PlanningCycle,
  SavePlanningCycleInput,
} from "@domain/planning-cycle";
import type {
  PlanningProposal,
  PlanningProposalStatus,
} from "@domain/planning-proposal";
import type {
  AnalyzeStyleTemplateInput,
  SaveStyleTemplateInput,
  StyleTemplate,
} from "@domain/style-template";
import type { PersonaSuggestion } from "@domain/persona-recommendation";
import type {
  CreateWorkflowRunInput,
  UpdateWorkflowRunInput,
  WorkflowRun,
} from "@domain/workflow-run";

export interface CreateNovelResult {
  novel: Novel;
  chapters: Chapter[];
}

export interface PlatformPort {
  readonly host: "electron" | "web";
  listNovels(): Promise<Novel[]>;
  deleteNovel(novelId: string): Promise<void>;
  importNovelProject(bundle: NovelProjectBundle): Promise<Novel>;
  getDiagnostics(): Promise<DiagnosticReport>;
  suggestNovelScope(input: {
    title: string;
    genre: string;
    premise: string;
    notes?: string;
  }): Promise<ScopeAdvice>;
  suggestPlanningBrief(input: {
    title: string;
    genre: string;
    premise: string;
    notes?: string;
  }): Promise<PlanningBrief>;
  /** Amy 一次推荐整个人物阵容的人格，供作者逐个调整后批量确认。 */
  suggestPersonaLineup(novelId: string): Promise<PersonaSuggestion[]>;
  createNovel(input: CreateNovelInput): Promise<CreateNovelResult>;
  updateNovelSettings(
    novelId: string,
    patch: { cycleSize: number },
  ): Promise<Novel>;
  getPlanningWorkflow(novelId: string): Promise<PlanningWorkflow>;
  savePlanningWorkflow(workflow: PlanningWorkflow): Promise<PlanningWorkflow>;
  generateNovelPlan(
    novelId: string,
    phase: PlanPhase,
    range?: PlanRange,
  ): Promise<NovelPlanSummary>;
  listPlanningRuns(novelId: string): Promise<PlanningRun[]>;
  listPlanningCycles(novelId: string): Promise<PlanningCycle[]>;
  savePlanningCycle(input: SavePlanningCycleInput): Promise<PlanningCycle>;
  listPlanningProposals(novelId: string): Promise<PlanningProposal[]>;
  reviewPlanningProposal(
    novelId: string,
    proposalId: string,
    status: Exclude<PlanningProposalStatus, "pending">,
  ): Promise<PlanningProposal>;
  createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRun>;
  updateWorkflowRun(input: UpdateWorkflowRunInput): Promise<WorkflowRun>;
  listWorkflowRuns(novelId: string): Promise<WorkflowRun[]>;
  listChapters(novelId: string): Promise<Chapter[]>;
  getChapter(chapterId: string): Promise<Chapter | null>;
  saveChapter(input: SaveChapterInput): Promise<Chapter>;
  createChapter(input: CreateChapterInput): Promise<Chapter>;
  updateChapterPlan(input: UpdateChapterPlanInput): Promise<Chapter>;
  deleteChapter(chapterId: string): Promise<void>;
  reorderChapters(novelId: string, chapterIds: string[]): Promise<Chapter[]>;
  listStoryStructure(novelId: string): Promise<StoryStructure>;
  saveVolume(input: SaveVolumeInput): Promise<StoryVolume>;
  deleteVolume(volumeId: string): Promise<void>;
  reorderVolumes(novelId: string, volumeIds: string[]): Promise<StoryVolume[]>;
  saveScene(input: SaveSceneInput): Promise<StoryScene>;
  deleteScene(sceneId: string): Promise<void>;
  reorderScenes(chapterId: string, sceneIds: string[]): Promise<StoryScene[]>;
  saveContextSnapshot(novelId: string, pack: ContextPack): Promise<ContextPack>;
  listContextSnapshots(
    novelId: string,
    chapterId?: string,
  ): Promise<ContextPack[]>;
  saveUsage(input: SaveUsageInput): Promise<UsageRecord>;
  listUsage(novelId?: string): Promise<UsageRecord[]>;
  listModelProfiles(): Promise<ModelProfile[]>;
  saveModelProfile(input: SaveModelProfileInput): Promise<ModelProfile>;
  deleteModelProfile(profileId: string): Promise<void>;
  listStyleTemplates(): Promise<StyleTemplate[]>;
  analyzeStyleTemplate(input: AnalyzeStyleTemplateInput): Promise<StyleTemplate>;
  saveStyleTemplate(input: SaveStyleTemplateInput): Promise<StyleTemplate>;
  deleteStyleTemplate(id: string): Promise<void>;
  testModelConnection(
    profileId: string,
    apiKey?: string,
  ): Promise<ModelConnectionResult>;
  generateChapter(
    input: GenerateChapterInput,
    onProgress: (event: GenerationProgress) => void,
  ): Promise<ChapterCandidate>;
  cancelGeneration(requestId: string): Promise<void>;
  /** 字数不足时基于同一上下文续写尾部；不产生新候选稿。 */
  continueChapter(input: ContinueChapterInput): Promise<ContinueChapterResult>;
  listChapterCandidates(chapterId: string): Promise<ChapterCandidate[]>;
  /** 作者改稿：仅候选态可改，接受时写入改后版本。 */
  updateChapterCandidateContent(
    candidateId: string,
    content: string,
  ): Promise<ChapterCandidate>;
  acceptChapterCandidate(candidateId: string): Promise<ChapterCandidate>;
  rejectChapterCandidate(candidateId: string): Promise<ChapterCandidate>;
  listFindings(candidateId: string): Promise<StoredFinding[]>;
  updateFinding(
    findingId: string,
    status: StoredFinding["status"],
  ): Promise<StoredFinding>;
  listFactProposals(candidateId: string): Promise<FactProposal[]>;
  updateFactProposal(
    proposalId: string,
    status: FactProposal["status"],
  ): Promise<FactProposal>;
  listChapterVersions(chapterId: string): Promise<ChapterVersion[]>;
  createChapterSnapshot(chapterId: string): Promise<ChapterVersion>;
  listBibleSections(novelId: string): Promise<BibleSection[]>;
  saveBibleSection(input: SaveBibleSectionInput): Promise<BibleSection>;
  listStoryEntities(
    novelId: string,
    type?: StoryEntityType,
  ): Promise<StoryEntity[]>;
  saveStoryEntity(input: SaveStoryEntityInput): Promise<StoryEntity>;
  deleteStoryEntity(entityId: string): Promise<void>;
  listTimelineEvents(novelId: string): Promise<TimelineEvent[]>;
  saveTimelineEvent(input: SaveTimelineEventInput): Promise<TimelineEvent>;
  deleteTimelineEvent(eventId: string): Promise<void>;
  listForeshadowThreads(novelId: string): Promise<ForeshadowThread[]>;
  saveForeshadowThread(input: SaveForeshadowInput): Promise<ForeshadowThread>;
  deleteForeshadowThread(threadId: string): Promise<void>;
  listCharacterStates(
    novelId: string,
    characterId?: string,
  ): Promise<CharacterState[]>;
  saveCharacterState(input: SaveCharacterStateInput): Promise<CharacterState>;
  deleteCharacterState(stateId: string): Promise<void>;
  createGenerationDraft(
    novelId: string,
    policy: GenerationPolicy,
  ): Promise<{ id: string; estimate: GenerationEstimate }>;
  listGenerationBatches(): Promise<GenerationBatch[]>;
  listGenerationJobs(batchId: string): Promise<GenerationJob[]>;
  listGenerationEvents(batchId: string): Promise<GenerationEvent[]>;
  /** Web 端批次在渲染进程执行，运行日志直接由 store 写入本地。 */
  appendGenerationEvent?(event: NewGenerationEvent): Promise<GenerationEvent>;
  /** Electron 主进程推送生成过程事件；Web 端无此通道。 */
  onGenerationEvent?(
    listener: (event: GenerationEvent) => void,
  ): () => void;
  setBatchStatus(
    batchId: string,
    status: GenerationBatch["status"],
    patch?: { awaitingReview?: boolean },
  ): Promise<GenerationBatch>;
  updateGenerationJob(
    jobId: string,
    status: GenerationJobStatus,
    patch?: Partial<
      Pick<
        GenerationJob,
        "candidateId" | "inputTokens" | "outputTokens" | "error" | "attempt"
      >
    >,
  ): Promise<GenerationJob>;
  startBackgroundBatch(batchId: string): Promise<void>;
  pauseBackgroundBatch(batchId: string): Promise<void>;
}

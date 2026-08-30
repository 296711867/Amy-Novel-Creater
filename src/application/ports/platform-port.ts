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
  GenerateChapterInput,
  GenerationProgress,
} from "@domain/chapter-generation";
import type { FactProposal, StoredFinding } from "@domain/quality-check";
import type {
  GenerationBatch,
  GenerationEstimate,
  GenerationJob,
  GenerationJobStatus,
  GenerationPolicy,
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
import type { DiagnosticReport } from "@domain/diagnostics";
import type { NovelPlanSummary, PlanPhase } from "@domain/planning";

export interface CreateNovelResult {
  novel: Novel;
  chapters: Chapter[];
}

export interface PlatformPort {
  readonly host: "electron" | "web";
  listNovels(): Promise<Novel[]>;
  importNovelProject(bundle: NovelProjectBundle): Promise<Novel>;
  getDiagnostics(): Promise<DiagnosticReport>;
  createNovel(input: CreateNovelInput): Promise<CreateNovelResult>;
  generateNovelPlan(
    novelId: string,
    phase: PlanPhase,
  ): Promise<NovelPlanSummary>;
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
  testModelConnection(
    profileId: string,
    apiKey?: string,
  ): Promise<ModelConnectionResult>;
  generateChapter(
    input: GenerateChapterInput,
    onProgress: (event: GenerationProgress) => void,
  ): Promise<ChapterCandidate>;
  cancelGeneration(requestId: string): Promise<void>;
  listChapterCandidates(chapterId: string): Promise<ChapterCandidate[]>;
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
  setBatchStatus(
    batchId: string,
    status: GenerationBatch["status"],
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

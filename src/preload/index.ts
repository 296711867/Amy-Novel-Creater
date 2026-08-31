import { contextBridge, ipcRenderer } from "electron";
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
import type { PlanPhase, PlanRange } from "@domain/planning";
import type {
  ContinueChapterInput,
  ContinueChapterResult,
  GenerateChapterInput,
  GenerationProgress,
} from "@domain/chapter-generation";
import type { FactProposal, StoredFinding } from "@domain/quality-check";
import type {
  GenerationBatch,
  GenerationEvent,
  GenerationJob,
  GenerationJobStatus,
  GenerationPolicy,
} from "@domain/generation";
import { IPC_CHANNELS, type AmyNovelApi } from "@shared/ipc-contract";
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
import type { NovelProjectBundle } from "@domain/project-export";
import type { PlanningWorkflow } from "@domain/planning-workflow";
import type { SavePlanningCycleInput } from "@domain/planning-cycle";
import type { PlanningProposalStatus } from "@domain/planning-proposal";
import type {
  AnalyzeStyleTemplateInput,
  SaveStyleTemplateInput,
} from "@domain/style-template";
import type {
  CreateWorkflowRunInput,
  UpdateWorkflowRunInput,
} from "@domain/workflow-run";

const api: AmyNovelApi = {
  host: "electron",
  /** Electron 主进程 SQLite 随 IPC 就绪，无需等待。 */
  ready: () => Promise.resolve(),
  getDiagnostics: () => ipcRenderer.invoke(IPC_CHANNELS.getDiagnostics),
  suggestNovelScope: (input: {
    title: string;
    genre: string;
    premise: string;
    notes?: string;
  }) => ipcRenderer.invoke(IPC_CHANNELS.suggestNovelScope, input),
  suggestPlanningBrief: (input: {
    title: string;
    genre: string;
    premise: string;
    notes?: string;
  }) => ipcRenderer.invoke(IPC_CHANNELS.suggestPlanningBrief, input),
  suggestPersonaLineup: (novelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.suggestPersonaLineup, novelId),
  importNovelProject: (bundle: NovelProjectBundle) =>
    ipcRenderer.invoke(IPC_CHANNELS.importNovelProject, bundle),
  listNovels: () => ipcRenderer.invoke(IPC_CHANNELS.listNovels),
  deleteNovel: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteNovel, id),
  createNovel: (input: CreateNovelInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.createNovel, input),
  updateNovelSettings: (novelId: string, patch: { cycleSize: number }) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateNovelSettings, novelId, patch),
  getPlanningWorkflow: (novelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getPlanningWorkflow, novelId),
  savePlanningWorkflow: (workflow: PlanningWorkflow) =>
    ipcRenderer.invoke(IPC_CHANNELS.savePlanningWorkflow, workflow),
  generateNovelPlan: (novelId: string, phase: PlanPhase, range?: PlanRange) =>
    ipcRenderer.invoke(IPC_CHANNELS.generateNovelPlan, novelId, phase, range),
  listPlanningRuns: (novelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listPlanningRuns, novelId),
  listPlanningCycles: (novelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listPlanningCycles, novelId),
  savePlanningCycle: (input: SavePlanningCycleInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.savePlanningCycle, input),
  listPlanningProposals: (novelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listPlanningProposals, novelId),
  reviewPlanningProposal: (
    novelId: string,
    proposalId: string,
    status: Exclude<PlanningProposalStatus, "pending">,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.reviewPlanningProposal,
      novelId,
      proposalId,
      status,
    ),
  createWorkflowRun: (input: CreateWorkflowRunInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.createWorkflowRun, input),
  updateWorkflowRun: (input: UpdateWorkflowRunInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateWorkflowRun, input),
  listWorkflowRuns: (novelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listWorkflowRuns, novelId),
  listChapters: (novelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listChapters, novelId),
  getChapter: (chapterId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getChapter, chapterId),
  saveChapter: (input: SaveChapterInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveChapter, input),
  createChapter: (input: CreateChapterInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.createChapter, input),
  updateChapterPlan: (input: UpdateChapterPlanInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateChapterPlan, input),
  deleteChapter: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteChapter, id),
  reorderChapters: (novelId: string, ids: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.reorderChapters, novelId, ids),
  listStoryStructure: (novelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listStoryStructure, novelId),
  saveVolume: (input: SaveVolumeInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveVolume, input),
  deleteVolume: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteVolume, id),
  reorderVolumes: (novelId: string, ids: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.reorderVolumes, novelId, ids),
  saveScene: (input: SaveSceneInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveScene, input),
  deleteScene: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.deleteScene, id),
  reorderScenes: (chapterId: string, ids: string[]) =>
    ipcRenderer.invoke(IPC_CHANNELS.reorderScenes, chapterId, ids),
  saveContextSnapshot: (novelId: string, pack: ContextPack) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveContextSnapshot, novelId, pack),
  listContextSnapshots: (novelId: string, chapterId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listContextSnapshots, novelId, chapterId),
  saveUsage: (input: SaveUsageInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveUsage, input),
  listUsage: (novelId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listUsage, novelId),
  listModelProfiles: () => ipcRenderer.invoke(IPC_CHANNELS.listModelProfiles),
  saveModelProfile: (input: SaveModelProfileInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveModelProfile, input),
  deleteModelProfile: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteModelProfile, id),
  testModelConnection: (id: string, key?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.testModelConnection, id, key),
  listStyleTemplates: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listStyleTemplates),
  analyzeStyleTemplate: (input: AnalyzeStyleTemplateInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.analyzeStyleTemplate, input),
  saveStyleTemplate: (input: SaveStyleTemplateInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveStyleTemplate, input),
  deleteStyleTemplate: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteStyleTemplate, id),
  generateChapter: (
    input: GenerateChapterInput,
    onProgress: (event: GenerationProgress) => void,
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: GenerationProgress,
    ) => {
      if (data.requestId === input.requestId) onProgress(data);
    };
    ipcRenderer.on(IPC_CHANNELS.generationProgress, listener);
    return ipcRenderer
      .invoke(IPC_CHANNELS.generateChapter, input)
      .finally(() =>
        ipcRenderer.removeListener(IPC_CHANNELS.generationProgress, listener),
      );
  },
  cancelGeneration: (requestId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelGeneration, requestId),
  continueChapter: (input: ContinueChapterInput): Promise<ContinueChapterResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.continueChapter, input),
  updateChapterCandidateContent: (id: string, content: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateChapterCandidateContent, id, content),
  listChapterCandidates: (chapterId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listChapterCandidates, chapterId),
  acceptChapterCandidate: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.acceptChapterCandidate, id),
  rejectChapterCandidate: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.rejectChapterCandidate, id),
  listFindings: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listFindings, id),
  updateFinding: (id: string, status: StoredFinding["status"]) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateFinding, id, status),
  listFactProposals: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listFactProposals, id),
  updateFactProposal: (id: string, status: FactProposal["status"]) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateFactProposal, id, status),
  listChapterVersions: (chapterId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listChapterVersions, chapterId),
  createChapterSnapshot: (chapterId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.createChapterSnapshot, chapterId),
  listBibleSections: (novelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listBibleSections, novelId),
  saveBibleSection: (input: SaveBibleSectionInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveBibleSection, input),
  listStoryEntities: (novelId: string, type?: StoryEntityType) =>
    ipcRenderer.invoke(IPC_CHANNELS.listStoryEntities, novelId, type),
  saveStoryEntity: (input: SaveStoryEntityInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveStoryEntity, input),
  deleteStoryEntity: (entityId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteStoryEntity, entityId),
  listTimelineEvents: (novelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listTimelineEvents, novelId),
  saveTimelineEvent: (input: SaveTimelineEventInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveTimelineEvent, input),
  deleteTimelineEvent: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteTimelineEvent, id),
  listForeshadowThreads: (novelId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listForeshadowThreads, novelId),
  saveForeshadowThread: (input: SaveForeshadowInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveForeshadowThread, input),
  deleteForeshadowThread: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteForeshadowThread, id),
  listCharacterStates: (novelId: string, characterId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listCharacterStates, novelId, characterId),
  saveCharacterState: (input: SaveCharacterStateInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveCharacterState, input),
  deleteCharacterState: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteCharacterState, id),
  createGenerationDraft: (novelId: string, policy: GenerationPolicy) =>
    ipcRenderer.invoke(IPC_CHANNELS.createGenerationDraft, novelId, policy),
  listGenerationBatches: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listGenerationBatches),
  listGenerationJobs: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listGenerationJobs, id),
  setBatchStatus: (
    id: string,
    status: GenerationBatch["status"],
    patch?: { awaitingReview?: boolean },
  ) => ipcRenderer.invoke(IPC_CHANNELS.setBatchStatus, id, status, patch),
  listGenerationEvents: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listGenerationEvents, id),
  onGenerationEvent: (listener: (event: GenerationEvent) => void) => {
    const subscription = (
      _event: Electron.IpcRendererEvent,
      data: GenerationEvent,
    ) => listener(data);
    ipcRenderer.on(IPC_CHANNELS.generationEvent, subscription);
    return () =>
      ipcRenderer.removeListener(
        IPC_CHANNELS.generationEvent,
        subscription,
      );
  },
  updateGenerationJob: (
    id: string,
    status: GenerationJobStatus,
    patch?: Partial<GenerationJob>,
  ) => ipcRenderer.invoke(IPC_CHANNELS.updateGenerationJob, id, status, patch),
  startBackgroundBatch: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.startBackgroundBatch, id),
  pauseBackgroundBatch: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.pauseBackgroundBatch, id),
};

contextBridge.exposeInMainWorld("amyNovel", api);

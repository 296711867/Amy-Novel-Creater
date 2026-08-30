import { app, type IpcMain } from "electron";
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
  GenerateChapterInput,
  GenerationProgress,
} from "@domain/chapter-generation";
import { estimateTokens } from "@domain/context-pack";
import { BatchRunner } from "../generation/batch-runner";
import type { FactProposal, StoredFinding } from "@domain/quality-check";
import type {
  GenerationBatch,
  GenerationJob,
  GenerationJobStatus,
  GenerationPolicy,
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

export function registerNovelIpc(
  ipc: IpcMain,
  database: NovelDatabase,
  secrets: SecretVault,
): void {
  const activeGenerations = new Map<string, AbortController>();
  const batchRunner = new BatchRunner(database, secrets);
  ipc.handle(IPC_CHANNELS.listNovels, () => database.listNovels());
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
  ipc.handle(IPC_CHANNELS.importNovelProject, (_event, value: unknown) =>
    database.importNovelProject(parseNovelProject(value)),
  );
  ipc.handle(IPC_CHANNELS.createNovel, (_event, input: CreateNovelInput) =>
    database.createNovel(input),
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
  ipc.handle(
    IPC_CHANNELS.generateChapter,
    async (event, input: GenerateChapterInput) => {
      const profile = await database.getModelProfile(input.profileId);
      if (!profile) throw new Error("Model profile not found");
      const key = await secrets.get(profile.id),
        controller = new AbortController();
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
          input.contextText,
          input.maxOutputTokens,
          input.temperature,
          (delta) => emit({ type: "delta", delta }),
          fetch,
          controller.signal,
          "disabled",
        );
        const inputTokens =
            result.inputTokens || estimateTokens(input.contextText),
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
  ipc.handle(IPC_CHANNELS.listChapterCandidates, (_event, chapterId: string) =>
    database.listChapterCandidates(chapterId),
  );
  ipc.handle(IPC_CHANNELS.acceptChapterCandidate, (_event, id: string) =>
    database.setCandidateStatus(id, "accepted"),
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
    (_event, id: string, status: FactProposal["status"]) =>
      database.updateFactProposal(id, status),
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
    (_event, id: string, status: GenerationBatch["status"]) =>
      database.setBatchStatus(id, status),
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

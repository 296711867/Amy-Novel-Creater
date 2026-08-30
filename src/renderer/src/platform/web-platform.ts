import { nanoid } from "nanoid";
import {
  buildInitialChapters,
  calculateTargetWords,
  countCjkWords,
  normalizeCycleSize,
  type Chapter,
  type ChapterVersion,
  type CreateNovelInput,
  type Novel,
  type SaveChapterInput,
} from "@domain/novel";
import type {
  SaveSceneInput,
  SaveVolumeInput,
  StoryScene,
  StoryVolume,
} from "@domain/story-structure";
import type { ContextPack } from "@domain/context-pack";
import type { SaveUsageInput, UsageRecord } from "@domain/usage";
import {
  chatCompletionsRequestBody,
  ModelRequestError,
  normalizeChatCompletionsUrl,
  parseRetryAfterMs,
  type ModelProfile,
  type SaveModelProfileInput,
} from "@domain/model-profile";
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
import type {
  ChapterCandidate,
  GenerateChapterInput,
  GenerationProgress,
} from "@domain/chapter-generation";
import type { FactProposal, StoredFinding } from "@domain/quality-check";
import { estimateTokens } from "@domain/context-pack";
import {
  novelPlanningPrompt,
  planningMaxOutputTokens,
} from "@domain/planning";
import {
  defaultNamePool,
  namePoolText,
  type NamePool,
} from "@domain/name-pool";
import type { PlanPhase, PlanRange } from "@domain/planning";
import {
  estimateGeneration,
  type GenerationBatch,
  type GenerationJob,
  type GenerationJobStatus,
  type GenerationPolicy,
} from "@domain/generation";
import type { PlatformPort } from "@application/ports/platform-port";
import {
  normalizeAliases,
  type BibleSection,
  type BibleSectionKind,
  type SaveBibleSectionInput,
  type SaveStoryEntityInput,
  type StoryEntity,
  type StoryEntityType,
} from "@domain/story-bible";
import {
  normalizeStateList,
  type CharacterState,
  type ForeshadowThread,
  type SaveCharacterStateInput,
  type SaveForeshadowInput,
  type SaveTimelineEventInput,
  type TimelineEvent,
} from "@domain/continuity";
import type { NovelProjectBundle } from "@domain/project-export";
import { applyNovelPlan } from "@application/apply-novel-plan";
import {
  defaultPlanningWorkflow,
  assertPlanningReady,
  normalizePlanningWorkflow,
  type PlanningWorkflow,
} from "@domain/planning-workflow";
import {
  planningPromptHash,
  type PlanningRun,
} from "@domain/planning-run";
import type {
  PlanningCycle,
  SavePlanningCycleInput,
} from "@domain/planning-cycle";
import type {
  NewPlanningProposal,
  PlanningProposal,
  PlanningProposalStatus,
} from "@domain/planning-proposal";
import { reviewPlanningProposal } from "@application/review-planning-proposal";

const NOVELS_KEY = "amy-novel:novels";
const chaptersKey = (novelId: string): string =>
  `amy-novel:chapters:${novelId}`;
const versionsKey = (chapterId: string): string =>
  `amy-novel:versions:${chapterId}`;
const bibleKey = (novelId: string): string => `amy-novel:bible:${novelId}`;
const entitiesKey = (novelId: string): string =>
  `amy-novel:entities:${novelId}`;
const timelineKey = (novelId: string): string =>
  `amy-novel:timeline:${novelId}`;
const foreshadowKey = (novelId: string): string =>
  `amy-novel:foreshadow:${novelId}`;
const characterStatesKey = (novelId: string): string =>
  `amy-novel:character-states:${novelId}`;
const volumesKey = (novelId: string): string => `amy-novel:volumes:${novelId}`;
const scenesKey = (novelId: string): string => `amy-novel:scenes:${novelId}`;
const contextKey = (novelId: string): string => `amy-novel:context:${novelId}`;
const USAGE_KEY = "amy-novel:usage";
const PROFILES_KEY = "amy-novel:model-profiles";
const candidatesKey = (chapterId: string) =>
  `amy-novel:candidates:${chapterId}`;
const findingsKey = (candidateId: string) =>
  `amy-novel:findings:${candidateId}`;
const proposalsKey = (candidateId: string) =>
  `amy-novel:proposals:${candidateId}`;
const BATCHES_KEY = "amy-novel:generation-batches";
const jobsKey = (id: string) => `amy-novel:generation-jobs:${id}`;
const workflowKey = (novelId: string) =>
  `amy-novel:planning-workflow:${novelId}`;
const planningRunsKey = (novelId: string) =>
  `amy-novel:planning-runs:${novelId}`;
const planningCyclesKey = (novelId: string) =>
  `amy-novel:planning-cycles:${novelId}`;
const planningPlanProposalsKey = (novelId: string) =>
  `amy-novel:planning-proposals:${novelId}`;

function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

/** 旧版本 localStorage 中的作品没有 cycleSize，读取时统一归一化。 */
function readNovels(): Novel[] {
  return read<Novel[]>(NOVELS_KEY, []).map((item) => ({
    ...item,
    cycleSize: normalizeCycleSize(item.cycleSize),
  }));
}

function replaceWebPlanningProposals(
  novelId: string,
  cycleId: string,
  startChapter: number,
  endChapter: number,
  proposals: NewPlanningProposal[],
): PlanningProposal[] {
  const now = new Date().toISOString(),
    kept = read<PlanningProposal[]>(planningPlanProposalsKey(novelId), []).filter(
      (item) =>
        item.status !== "pending" ||
        item.startChapter !== startChapter ||
        item.endChapter !== endChapter,
    ),
    created = proposals.map((item) => ({
      ...item,
      id: nanoid(),
      novelId,
      cycleId,
      startChapter,
      endChapter,
      status: "pending" as const,
      createdAt: now,
      updatedAt: now,
    }));
  write(planningPlanProposalsKey(novelId), [...kept, ...created]);
  return created;
}

function updateWebPlanningProposalStatus(
  novelId: string,
  id: string,
  status: PlanningProposalStatus,
): PlanningProposal {
  const list = read<PlanningProposal[]>(planningPlanProposalsKey(novelId), []),
    index = list.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("策划提案不存在");
  list[index] = { ...list[index], status, updatedAt: new Date().toISOString() };
  write(planningPlanProposalsKey(novelId), list);
  return list[index];
}

export const webPlatform: PlatformPort = {
  host: "web",
  async getDiagnostics() {
    return {
      generatedAt: new Date().toISOString(),
      appVersion: "0.1.0-web",
      host: "web",
      platform: navigator.platform,
      runtime: { browser: navigator.userAgent },
      database: "ok",
      novelCount: readNovels().length,
    };
  },
  async suggestNovelScope(input: {
    title: string;
    genre: string;
    premise: string;
    notes?: string;
  }) {
    const profile = read<ModelProfile[]>(PROFILES_KEY, []).find(
      (item) => item.isDefault,
    );
    if (!profile) throw new Error("请先在设置页配置默认写作模型");
    const key = sessionStorage.getItem(`amy-novel:secret:${profile.id}`) ?? "";
    const prompt = scopeAdvisoryPrompt(input);
    const response = await fetch(
      normalizeChatCompletionsUrl(profile.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(
          chatCompletionsRequestBody(profile, prompt, {
            maxOutputTokens: scopeAdvisoryMaxOutputTokens(),
            temperature: 0.5,
            stream: false,
            thinking: "disabled",
          }),
        ),
      },
    );
    if (!response.ok)
      throw new Error(`模型请求失败（HTTP ${response.status}）`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return parseScopeAdvice(data.choices?.[0]?.message?.content ?? "");
  },
  async suggestPlanningBrief(input: {
    title: string;
    genre: string;
    premise: string;
    notes?: string;
  }) {
    const profile = read<ModelProfile[]>(PROFILES_KEY, []).find(
      (item) => item.isDefault,
    );
    if (!profile) throw new Error("请先在设置页配置默认写作模型");
    const key = sessionStorage.getItem(`amy-novel:secret:${profile.id}`) ?? "";
    const prompt = briefDraftingPrompt(input);
    const response = await fetch(
      normalizeChatCompletionsUrl(profile.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(
          chatCompletionsRequestBody(profile, prompt, {
            maxOutputTokens: briefDraftingMaxOutputTokens(),
            temperature: 0.7,
            stream: false,
            thinking: "disabled",
          }),
        ),
      },
    );
    if (!response.ok)
      throw new Error(`模型请求失败（HTTP ${response.status}）`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return parseBriefDraft(data.choices?.[0]?.message?.content ?? "");
  },
  async importNovelProject(bundle: NovelProjectBundle) {
    const id = nanoid(),
      now = new Date().toISOString(),
      novel: Novel = {
        ...bundle.novel,
        id,
        title: `${bundle.novel.title}（恢复）`,
        cycleSize: normalizeCycleSize(bundle.novel.cycleSize),
        createdAt: now,
        updatedAt: now,
      },
      chapterIds = new Map(
        bundle.chapters.map((item) => [
          item.id,
          `${id}:chapter:${item.position}`,
        ]),
      ),
      volumeIds = new Map(bundle.volumes.map((item) => [item.id, nanoid()])),
      entityIds = new Map(bundle.entities.map((item) => [item.id, nanoid()]));
    write(NOVELS_KEY, [novel, ...readNovels()]);
    const chapters = bundle.chapters.map((item) => ({
      ...item,
      id: chapterIds.get(item.id)!,
      novelId: id,
      volumeId: item.volumeId ? (volumeIds.get(item.volumeId) ?? null) : null,
    }));
    write(chaptersKey(id), chapters);
    write(
      volumesKey(id),
      bundle.volumes.map((item) => ({
        ...item,
        id: volumeIds.get(item.id)!,
        novelId: id,
      })),
    );
    write(
      scenesKey(id),
      bundle.scenes.flatMap((item) =>
        chapterIds.has(item.chapterId)
          ? [
              {
                ...item,
                id: nanoid(),
                chapterId: chapterIds.get(item.chapterId)!,
              },
            ]
          : [],
      ),
    );
    write(
      bibleKey(id),
      bundle.bible.map((item) => ({
        ...item,
        id: `${id}:bible:${item.kind}`,
        novelId: id,
      })),
    );
    write(
      entitiesKey(id),
      bundle.entities.map((item) => ({
        ...item,
        id: entityIds.get(item.id)!,
        novelId: id,
      })),
    );
    write(
      timelineKey(id),
      bundle.timeline.map((item) => ({
        ...item,
        id: nanoid(),
        novelId: id,
        chapterId: item.chapterId
          ? (chapterIds.get(item.chapterId) ?? null)
          : null,
        participantIds: item.participantIds.flatMap(
          (value) => entityIds.get(value) ?? [],
        ),
      })),
    );
    write(
      foreshadowKey(id),
      bundle.foreshadow.map((item) => ({
        ...item,
        id: nanoid(),
        novelId: id,
        setupChapterId: item.setupChapterId
          ? (chapterIds.get(item.setupChapterId) ?? null)
          : null,
        payoffChapterId: item.payoffChapterId
          ? (chapterIds.get(item.payoffChapterId) ?? null)
          : null,
      })),
    );
    write(
      characterStatesKey(id),
      bundle.characterStates.flatMap((item) =>
        entityIds.has(item.characterId)
          ? [
              {
                ...item,
                id: nanoid(),
                novelId: id,
                characterId: entityIds.get(item.characterId)!,
                chapterId: item.chapterId
                  ? (chapterIds.get(item.chapterId) ?? null)
                  : null,
              },
            ]
          : [],
      ),
    );
    for (const chapter of bundle.chapters) {
      const mapped = chapterIds.get(chapter.id)!;
      write(
        versionsKey(mapped),
        bundle.versions
          .filter((item) => item.chapterId === chapter.id)
          .map((item) => ({ ...item, id: nanoid(), chapterId: mapped })),
      );
      write(
        candidatesKey(mapped),
        bundle.candidates
          .filter((item) => item.chapterId === chapter.id)
          .map((item) => ({
            ...item,
            id: nanoid(),
            novelId: id,
            chapterId: mapped,
          })),
      );
    }
    write(USAGE_KEY, [
      ...bundle.usage.map((item) => ({
        ...item,
        id: nanoid(),
        novelId: id,
        chapterId: item.chapterId
          ? (chapterIds.get(item.chapterId) ?? null)
          : null,
      })),
      ...read<UsageRecord[]>(USAGE_KEY, []),
    ]);
    write(
      workflowKey(id),
      bundle.workflow
        ? normalizePlanningWorkflow({ ...bundle.workflow, novelId: id })
        : defaultPlanningWorkflow(id),
    );
    const cycleIds = new Map(
      (bundle.planningCycles ?? []).map((item) => [item.id, nanoid()]),
    );
    write(
      planningRunsKey(id),
      (bundle.planningRuns ?? []).map((item) => ({
        ...item,
        id: nanoid(),
        novelId: id,
      })),
    );
    write(
      planningCyclesKey(id),
      (bundle.planningCycles ?? []).map((item) => ({
        ...item,
        id: cycleIds.get(item.id)!,
        novelId: id,
      })),
    );
    write(
      planningPlanProposalsKey(id),
      (bundle.planningProposals ?? []).flatMap((item) =>
        cycleIds.has(item.cycleId)
          ? [{
              ...item,
              id: nanoid(),
              novelId: id,
              cycleId: cycleIds.get(item.cycleId)!,
            }]
          : [],
      ),
    );
    return novel;
  },
  async listNovels() {
    return readNovels();
  },
  async deleteNovel(id: string) {
    const chapters = read<Chapter[]>(chaptersKey(id), []),
      candidates = chapters.flatMap((chapter) =>
        read<ChapterCandidate[]>(candidatesKey(chapter.id), []),
      ),
      batches = read<GenerationBatch[]>(BATCHES_KEY, []);
    for (const candidate of candidates) {
      localStorage.removeItem(findingsKey(candidate.id));
      localStorage.removeItem(proposalsKey(candidate.id));
    }
    for (const chapter of chapters) {
      localStorage.removeItem(versionsKey(chapter.id));
      localStorage.removeItem(candidatesKey(chapter.id));
    }
    for (const batch of batches.filter((item) => item.novelId === id))
      localStorage.removeItem(jobsKey(batch.id));
    [
      chaptersKey(id),
      bibleKey(id),
      entitiesKey(id),
      timelineKey(id),
      foreshadowKey(id),
      characterStatesKey(id),
      volumesKey(id),
      scenesKey(id),
      contextKey(id),
      workflowKey(id),
      planningRunsKey(id),
      planningCyclesKey(id),
      planningPlanProposalsKey(id),
      `amy-novel:name-pool:${id}`,
    ].forEach((key) => localStorage.removeItem(key));
    write(
      NOVELS_KEY,
      readNovels().filter((item) => item.id !== id),
    );
    write(
      USAGE_KEY,
      read<UsageRecord[]>(USAGE_KEY, []).filter((item) => item.novelId !== id),
    );
    write(
      BATCHES_KEY,
      batches.filter((item) => item.novelId !== id),
    );
  },
  async createNovel(input: CreateNovelInput) {
    const now = new Date().toISOString();
    const novel: Novel = {
      id: nanoid(),
      ...input,
      premise: input.premise.trim(),
      targetWords: calculateTargetWords(input),
      cycleSize: normalizeCycleSize(input.cycleSize),
      status: "planning",
      createdAt: now,
      updatedAt: now,
    };
    const novels = readNovels();
    const chapters = buildInitialChapters(
      novel.id,
      novel.targetChapters,
      novel.chapterWords,
    );
    write(NOVELS_KEY, [novel, ...novels]);
    write(chaptersKey(novel.id), chapters);
    return { novel, chapters };
  },
  async updateNovelSettings(
    novelId: string,
    patch: { cycleSize: number },
  ): Promise<Novel> {
    const novels = readNovels();
    const novel = novels.find((item) => item.id === novelId);
    if (!novel) throw new Error("作品不存在");
    const updated: Novel = {
      ...novel,
      cycleSize: normalizeCycleSize(patch.cycleSize),
      updatedAt: new Date().toISOString(),
    };
    write(NOVELS_KEY, novels.map((item) => (item.id === novelId ? updated : item)));
    return updated;
  },
  async getPlanningWorkflow(novelId: string) {
    return normalizePlanningWorkflow(
      read<PlanningWorkflow>(
        workflowKey(novelId),
        defaultPlanningWorkflow(novelId),
      ),
    );
  },
  async savePlanningWorkflow(workflow: PlanningWorkflow) {
    const value = normalizePlanningWorkflow(workflow);
    write(workflowKey(value.novelId), value);
    return value;
  },
  async generateNovelPlan(
    novelId: string,
    phase: PlanPhase,
    range?: PlanRange,
  ) {
    const novel = readNovels().find(
      (item) => item.id === novelId,
    );
    if (!novel) throw new Error("作品不存在");
    const profile = read<ModelProfile[]>(PROFILES_KEY, []).find(
      (item) => item.isDefault,
    );
    if (!profile) throw new Error("请先在设置页配置默认写作模型");
    const key = sessionStorage.getItem(`amy-novel:secret:${profile.id}`) ?? "";
    const bible = await this.listBibleSections(novelId);
    const workflow = await this.getPlanningWorkflow(novelId);
    const entities = await this.listStoryEntities(novelId);
    const chapters = await this.listChapters(novelId);
    const poolKey = `amy-novel:name-pool:${novelId}`,
      namePool = read<NamePool>(poolKey, defaultNamePool(novelId, novel.genre));
    const prompt = novelPlanningPrompt({
      phase,
      novel,
      bible,
      brief: workflow.brief,
      entities,
      chapters,
      range,
      namePoolText: namePoolText(namePool),
    });
    const now = new Date().toISOString(),
      run: PlanningRun = {
        id: nanoid(),
        novelId,
        phase,
        startChapter: range?.startChapter ?? null,
        endChapter: range?.endChapter ?? null,
        profileId: profile.id,
        provider: profile.provider,
        model: profile.modelId,
        promptHash: planningPromptHash(prompt),
        rawResponse: "",
        inputTokens: 0,
        outputTokens: 0,
        cachedTokens: 0,
        status: "running",
        error: "",
        createdAt: now,
        updatedAt: now,
      };
    const saveRun = (next: PlanningRun) => {
      const list = read<PlanningRun[]>(planningRunsKey(novelId), []);
      write(planningRunsKey(novelId), [
        next,
        ...list.filter((item) => item.id !== next.id),
      ]);
    };
    saveRun(run);
    try {
      // 浏览器直连模型受 CORS 限制，多数 provider 需要代理才能使用。
      const response = await fetch(
        normalizeChatCompletionsUrl(profile.baseUrl),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(key ? { authorization: `Bearer ${key}` } : {}),
          },
          body: JSON.stringify(
            chatCompletionsRequestBody(profile, prompt, {
              maxOutputTokens: planningMaxOutputTokens(phase),
              temperature: 0.7,
              stream: false,
              thinking: "disabled",
            }),
          ),
        },
      );
      if (!response.ok)
        throw new Error(`模型请求失败（HTTP ${response.status}）`);
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
        };
      };
      const content = data.choices?.[0]?.message?.content ?? "",
        inputTokens = data.usage?.prompt_tokens ?? estimateTokens(prompt),
        outputTokens = data.usage?.completion_tokens ?? estimateTokens(content),
        received: PlanningRun = {
          ...run,
          rawResponse: content,
          inputTokens,
          outputTokens,
          cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
          status: "received",
          updatedAt: new Date().toISOString(),
        };
      // 原始响应先保存，解析失败时仍可检查和重新解析。
      saveRun(received);
      await this.saveUsage({
        novelId,
        chapterId: null,
        operation: "planning",
        provider: profile.provider,
        model: profile.modelId,
        inputTokens,
        outputTokens,
        cachedTokens: received.cachedTokens,
        cost: null,
        measurement: data.usage ? "provider" : "estimated",
      });
      const summary = await applyNovelPlan({
        novel,
        phase,
        content,
        entities,
        namePool,
        range,
        store: {
          saveBibleSection: (input) => this.saveBibleSection(input),
          saveStoryEntity: (input) => this.saveStoryEntity(input),
          saveNamePool: async (pool) => (write(poolKey, pool), pool),
          listStoryStructure: (id) => this.listStoryStructure(id),
          listChapters: (id) => this.listChapters(id),
          saveVolume: (input) => this.saveVolume(input),
          reorderVolumes: (id, ids) => this.reorderVolumes(id, ids),
          updateChapterPlan: (input) => this.updateChapterPlan(input),
          createChapter: (input) => this.createChapter(input),
          savePlanningCycle: (input) => this.savePlanningCycle(input),
          replacePlanningProposals: (id, cycleId, start, end, proposals) =>
            Promise.resolve(
              replaceWebPlanningProposals(
                id,
                cycleId,
                start,
                end,
                proposals,
              ),
            ),
        },
      });
      saveRun({
        ...received,
        status: "completed",
        updatedAt: new Date().toISOString(),
      });
      return summary;
    } catch (error) {
      const current = read<PlanningRun[]>(planningRunsKey(novelId), []).find(
        (item) => item.id === run.id,
      );
      saveRun({
        ...(current ?? run),
        status: "failed",
        error: error instanceof Error ? error.message : "规划生成失败",
        updatedAt: new Date().toISOString(),
      });
      throw error;
    }
  },
  async listPlanningRuns(novelId: string) {
    return read<PlanningRun[]>(planningRunsKey(novelId), []);
  },
  async listPlanningCycles(novelId: string) {
    return read<PlanningCycle[]>(planningCyclesKey(novelId), []);
  },
  async savePlanningCycle(input: SavePlanningCycleInput) {
    const list = read<PlanningCycle[]>(planningCyclesKey(input.novelId), []),
      existing = input.id
        ? list.find((item) => item.id === input.id)
        : list.find(
            (item) =>
              item.startChapter === input.startChapter &&
              item.endChapter === input.endChapter &&
              item.status !== "superseded",
          ),
      now = new Date().toISOString(),
      cycle: PlanningCycle = {
        ...input,
        id: existing?.id ?? nanoid(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
    write(planningCyclesKey(input.novelId), [
      ...list.filter((item) => item.id !== cycle.id),
      cycle,
    ]);
    return cycle;
  },
  async listPlanningProposals(novelId: string) {
    return read<PlanningProposal[]>(planningPlanProposalsKey(novelId), []);
  },
  async reviewPlanningProposal(novelId, proposalId, status) {
    return reviewPlanningProposal(
      {
        listPlanningProposals: (id) => this.listPlanningProposals(id),
        updatePlanningProposalStatus: (id, next) =>
          Promise.resolve(updateWebPlanningProposalStatus(novelId, id, next)),
        listStoryEntities: (id) => this.listStoryEntities(id),
        saveStoryEntity: (input) => this.saveStoryEntity(input),
      },
      novelId,
      proposalId,
      status,
    );
  },
  async listChapters(novelId: string) {
    return read<Chapter[]>(chaptersKey(novelId), []).map((chapter) => ({
      ...chapter,
      volumeId: chapter.volumeId ?? null,
      content: chapter.content ?? "",
      wordCount: chapter.wordCount ?? 0,
      updatedAt: chapter.updatedAt ?? new Date().toISOString(),
    }));
  },
  async getChapter(chapterId: string) {
    const novels = readNovels();
    for (const novel of novels) {
      const chapter = (await this.listChapters(novel.id)).find(
        (item) => item.id === chapterId,
      );
      if (chapter) return chapter;
    }
    return null;
  },
  async saveChapter(input: SaveChapterInput) {
    const novels = readNovels();
    for (const novel of novels) {
      const chapters = await this.listChapters(novel.id);
      const index = chapters.findIndex((item) => item.id === input.chapterId);
      if (index < 0) continue;
      const chapter: Chapter = {
        ...chapters[index],
        title: input.title,
        outline: input.outline,
        content: input.content,
        wordCount: countCjkWords(input.content),
        status:
          chapters[index].status === "planned"
            ? "draft"
            : chapters[index].status,
        updatedAt: new Date().toISOString(),
      };
      chapters[index] = chapter;
      write(chaptersKey(novel.id), chapters);
      if (input.createSnapshot) await this.createChapterSnapshot(chapter.id);
      return chapter;
    }
    throw new Error("Chapter not found");
  },
  async createChapter(input) {
    const chapters = await this.listChapters(input.novelId),
      now = new Date().toISOString(),
      position = chapters.length + 1,
      chapter: Chapter = {
        id: nanoid(),
        novelId: input.novelId,
        volumeId: input.volumeId,
        position,
        title: input.title?.trim() || `第 ${position} 章`,
        outline: "",
        status: "planned",
        targetWords: input.targetWords,
        content: "",
        wordCount: 0,
        updatedAt: now,
      };
    chapters.push(chapter);
    write(chaptersKey(input.novelId), chapters);
    return chapter;
  },
  async updateChapterPlan(input) {
    for (const novel of readNovels()) {
      const chapters = await this.listChapters(novel.id),
        index = chapters.findIndex((item) => item.id === input.chapterId);
      if (index < 0) continue;
      chapters[index] = {
        ...chapters[index],
        volumeId: input.volumeId,
        title: input.title.trim(),
        outline: input.outline,
        targetWords: input.targetWords,
        updatedAt: new Date().toISOString(),
      };
      write(chaptersKey(novel.id), chapters);
      return chapters[index];
    }
    throw new Error("Chapter not found");
  },
  async deleteChapter(id) {
    for (const novel of readNovels()) {
      const chapters = await this.listChapters(novel.id);
      if (chapters.some((item) => item.id === id)) {
        write(
          chaptersKey(novel.id),
          chapters
            .filter((item) => item.id !== id)
            .map((item, index) => ({ ...item, position: index + 1 })),
        );
        return;
      }
    }
  },
  async reorderChapters(novelId, ids) {
    const chapters = await this.listChapters(novelId),
      byId = new Map(chapters.map((item) => [item.id, item]));
    if (ids.length !== chapters.length || ids.some((id) => !byId.has(id)))
      throw new Error("Invalid reorder set");
    const next = ids.map((id, index) => ({
      ...byId.get(id)!,
      position: index + 1,
    }));
    write(chaptersKey(novelId), next);
    return next;
  },
  async listStoryStructure(novelId) {
    let volumes = read<StoryVolume[]>(volumesKey(novelId), []);
    if (!volumes.length) {
      const now = new Date().toISOString(),
        volume: StoryVolume = {
          id: nanoid(),
          novelId,
          position: 1,
          title: "第一卷",
          outline: "",
          createdAt: now,
          updatedAt: now,
        };
      volumes = [volume];
      write(volumesKey(novelId), volumes);
      const chapters = (await this.listChapters(novelId)).map((item) => ({
        ...item,
        volumeId: item.volumeId ?? volume.id,
      }));
      write(chaptersKey(novelId), chapters);
    }
    return { volumes, scenes: read<StoryScene[]>(scenesKey(novelId), []) };
  },
  async saveVolume(input: SaveVolumeInput) {
    const list = (await this.listStoryStructure(input.novelId)).volumes,
      index = list.findIndex((item) => item.id === input.id),
      now = new Date().toISOString(),
      item: StoryVolume = {
        id: input.id ?? nanoid(),
        novelId: input.novelId,
        position: index >= 0 ? list[index].position : list.length + 1,
        title: input.title.trim(),
        outline: input.outline,
        createdAt: index >= 0 ? list[index].createdAt : now,
        updatedAt: now,
      };
    if (index >= 0) list[index] = item;
    else list.push(item);
    write(volumesKey(input.novelId), list);
    return item;
  },
  async deleteVolume(id) {
    for (const novel of readNovels()) {
      const list = read<StoryVolume[]>(volumesKey(novel.id), []);
      if (!list.some((item) => item.id === id)) continue;
      if (list.length <= 1) throw new Error("At least one volume is required");
      write(
        volumesKey(novel.id),
        list
          .filter((item) => item.id !== id)
          .map((item, index) => ({ ...item, position: index + 1 })),
      );
      const chapters = (await this.listChapters(novel.id)).map((item) =>
        item.volumeId === id ? { ...item, volumeId: null } : item,
      );
      write(chaptersKey(novel.id), chapters);
      return;
    }
  },
  async reorderVolumes(novelId, ids) {
    const list = (await this.listStoryStructure(novelId)).volumes,
      byId = new Map(list.map((item) => [item.id, item]));
    const next = ids.map((id, index) => ({
      ...byId.get(id)!,
      position: index + 1,
    }));
    write(volumesKey(novelId), next);
    return next;
  },
  async saveScene(input: SaveSceneInput) {
    const novel = readNovels().find((item) =>
      read<Chapter[]>(chaptersKey(item.id), []).some(
        (ch) => ch.id === input.chapterId,
      ),
    );
    if (!novel) throw new Error("Chapter not found");
    const list = read<StoryScene[]>(scenesKey(novel.id), []),
      index = list.findIndex((item) => item.id === input.id),
      siblings = list.filter((item) => item.chapterId === input.chapterId),
      now = new Date().toISOString(),
      item: StoryScene = {
        id: input.id ?? nanoid(),
        chapterId: input.chapterId,
        position: index >= 0 ? list[index].position : siblings.length + 1,
        title: input.title.trim(),
        summary: input.summary,
        viewpoint: input.viewpoint,
        location: input.location,
        targetWords: input.targetWords,
        createdAt: index >= 0 ? list[index].createdAt : now,
        updatedAt: now,
      };
    if (index >= 0) list[index] = item;
    else list.push(item);
    write(scenesKey(novel.id), list);
    return item;
  },
  async deleteScene(id) {
    for (const novel of readNovels()) {
      const list = read<StoryScene[]>(scenesKey(novel.id), []),
        found = list.find((item) => item.id === id);
      if (found) {
        write(
          scenesKey(novel.id),
          list
            .filter((item) => item.id !== id)
            .map((item) =>
              item.chapterId === found.chapterId
                ? {
                    ...item,
                    position:
                      list
                        .filter(
                          (value) =>
                            value.chapterId === found.chapterId &&
                            value.id !== id,
                        )
                        .findIndex((value) => value.id === item.id) + 1,
                  }
                : item,
            ),
        );
        return;
      }
    }
  },
  async reorderScenes(chapterId, ids) {
    for (const novel of readNovels()) {
      const list = read<StoryScene[]>(scenesKey(novel.id), []),
        siblings = list.filter((item) => item.chapterId === chapterId);
      if (!siblings.length) return [];
      const byId = new Map(siblings.map((item) => [item.id, item])),
        next = ids.map((id, index) => ({
          ...byId.get(id)!,
          position: index + 1,
        }));
      write(scenesKey(novel.id), [
        ...list.filter((item) => item.chapterId !== chapterId),
        ...next,
      ]);
      return next;
    }
    return [];
  },
  async saveContextSnapshot(novelId: string, pack: ContextPack) {
    const list = read<ContextPack[]>(contextKey(novelId), []);
    write(contextKey(novelId), [pack, ...list]);
    return pack;
  },
  async listContextSnapshots(novelId: string, chapterId?: string) {
    const list = read<ContextPack[]>(contextKey(novelId), []);
    return chapterId
      ? list.filter((item) => item.chapterId === chapterId)
      : list;
  },
  async saveUsage(input: SaveUsageInput) {
    const item: UsageRecord = {
        id: nanoid(),
        ...input,
        createdAt: new Date().toISOString(),
      },
      list = read<UsageRecord[]>(USAGE_KEY, []);
    write(USAGE_KEY, [item, ...list]);
    return item;
  },
  async listUsage(novelId?: string) {
    const list = read<UsageRecord[]>(USAGE_KEY, []);
    return novelId ? list.filter((item) => item.novelId === novelId) : list;
  },
  async listModelProfiles() {
    return read<ModelProfile[]>(PROFILES_KEY, []);
  },
  async saveModelProfile(input: SaveModelProfileInput) {
    const list = read<ModelProfile[]>(PROFILES_KEY, []),
      index = list.findIndex((item) => item.id === input.id),
      now = new Date().toISOString(),
      id = input.id ?? nanoid();
    if (input.apiKey)
      sessionStorage.setItem(`amy-novel:secret:${id}`, input.apiKey);
    const item: ModelProfile = {
      id,
      name: input.name.trim(),
      provider: input.provider,
      modelId: input.modelId.trim(),
      baseUrl: input.baseUrl.trim(),
      contextWindow: input.contextWindow,
      inputPricePerMillion: input.inputPricePerMillion,
      outputPricePerMillion: input.outputPricePerMillion,
      isDefault: input.isDefault,
      hasSecret:
        Boolean(input.apiKey) || Boolean(index >= 0 && list[index].hasSecret),
      createdAt: index >= 0 ? list[index].createdAt : now,
      updatedAt: now,
    };
    const normalized = list.map((value) =>
      input.isDefault ? { ...value, isDefault: false } : value,
    );
    if (index >= 0) normalized[index] = item;
    else normalized.unshift(item);
    write(PROFILES_KEY, normalized);
    return item;
  },
  async deleteModelProfile(id: string) {
    write(
      PROFILES_KEY,
      read<ModelProfile[]>(PROFILES_KEY, []).filter((item) => item.id !== id),
    );
    sessionStorage.removeItem(`amy-novel:secret:${id}`);
  },
  async testModelConnection(id: string, key?: string) {
    const profile = read<ModelProfile[]>(PROFILES_KEY, []).find(
      (item) => item.id === id,
    );
    if (!profile) throw new Error("Model profile not found");
    const started = Date.now();
    try {
      const response = await fetch(
        normalizeChatCompletionsUrl(profile.baseUrl),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(key || sessionStorage.getItem(`amy-novel:secret:${id}`)
              ? {
                  authorization: `Bearer ${key || sessionStorage.getItem(`amy-novel:secret:${id}`)}`,
                }
              : {}),
          },
          body: JSON.stringify({
            model: profile.modelId,
            messages: [{ role: "user", content: "Reply with OK only." }],
            max_tokens: 8,
          }),
        },
      );
      return {
        ok: response.ok,
        latencyMs: Date.now() - started,
        message: response.ok
          ? "连接成功"
          : `连接失败（HTTP ${response.status}）`,
        model: profile.modelId,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        message: error instanceof Error ? error.message : "连接失败",
      };
    }
  },
  async generateChapter(
    input: GenerateChapterInput,
    onProgress: (event: GenerationProgress) => void,
  ) {
    const profile = read<ModelProfile[]>(PROFILES_KEY, []).find(
      (item) => item.id === input.profileId,
    );
    if (!profile) throw new Error("Model profile not found");
    const key = sessionStorage.getItem(`amy-novel:secret:${profile.id}`) ?? "";
    onProgress({ requestId: input.requestId, type: "started" });
    const response = await fetch(
      normalizeChatCompletionsUrl(profile.baseUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(
          chatCompletionsRequestBody(profile, input.contextText, {
            maxOutputTokens: input.maxOutputTokens,
            temperature: input.temperature,
            stream: true,
          }),
        ),
      },
    );
    if (!response.ok)
      throw new ModelRequestError(
        response.status,
        parseRetryAfterMs(response.headers.get("retry-after")),
      );
    if (!response.body) throw new Error("模型接口未返回流式响应");
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = "",
      content = "",
      inputTokens = 0,
      outputTokens = 0,
      cachedTokens = 0;
    const consume = (line: string) => {
      if (!line.startsWith("data:")) return;
      const raw = line.slice(5).trim();
      if (!raw || raw === "[DONE]") return;
      try {
        const data = JSON.parse(raw);
        const delta = data.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          content += delta;
          onProgress({ requestId: input.requestId, type: "delta", delta });
        }
        if (data.usage) {
          inputTokens = data.usage.prompt_tokens ?? 0;
          outputTokens = data.usage.completion_tokens ?? 0;
          cachedTokens = data.usage.prompt_tokens_details?.cached_tokens ?? 0;
        }
      } catch {}
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      lines.forEach(consume);
      if (done) break;
    }
    if (buffer) consume(buffer);
    inputTokens ||= estimateTokens(input.contextText);
    outputTokens ||= estimateTokens(content);
    const now = new Date().toISOString(),
      candidate: ChapterCandidate = {
        id: nanoid(),
        novelId: input.novelId,
        chapterId: input.chapterId,
        profileId: profile.id,
        contextHash: input.contextHash,
        content,
        wordCount: content.replace(/\s+/g, "").length,
        status: "candidate",
        inputTokens,
        outputTokens,
        cachedTokens,
        createdAt: now,
        updatedAt: now,
      },
      list = read<ChapterCandidate[]>(candidatesKey(input.chapterId), []);
    write(candidatesKey(input.chapterId), [candidate, ...list]);
    await this.saveUsage({
      novelId: input.novelId,
      chapterId: input.chapterId,
      operation: "generation",
      provider: profile.provider,
      model: profile.modelId,
      inputTokens,
      outputTokens,
      cachedTokens,
      cost: null,
      measurement: "provider",
    });
    return candidate;
  },
  async listChapterCandidates(chapterId: string) {
    return read<ChapterCandidate[]>(candidatesKey(chapterId), []);
  },
  async listFindings(id: string) {
    return read<StoredFinding[]>(findingsKey(id), []);
  },
  async updateFinding(id: string, status: StoredFinding["status"]) {
    for (const candidate of Object.keys(localStorage).filter((key) =>
      key.startsWith("amy-novel:findings:"),
    )) {
      const list = read<StoredFinding[]>(candidate, []),
        index = list.findIndex((item) => item.id === id);
      if (index >= 0) {
        list[index] = {
          ...list[index],
          status,
          updatedAt: new Date().toISOString(),
        };
        write(candidate, list);
        return list[index];
      }
    }
    throw new Error("Finding not found");
  },
  async listFactProposals(id: string) {
    return read<FactProposal[]>(proposalsKey(id), []);
  },
  async updateFactProposal(id: string, status: FactProposal["status"]) {
    for (const key of Object.keys(localStorage).filter((value) =>
      value.startsWith("amy-novel:proposals:"),
    )) {
      const list = read<FactProposal[]>(key, []),
        index = list.findIndex((item) => item.id === id);
      if (index >= 0) {
        list[index] = {
          ...list[index],
          status,
          updatedAt: new Date().toISOString(),
        };
        write(key, list);
        return list[index];
      }
    }
    throw new Error("事实建议不存在");
  },
  async cancelGeneration() {
    /* Browser preview stops between chapter checkpoints; Electron aborts immediately. */
  },
  async acceptChapterCandidate(id: string) {
    for (const novel of readNovels()) {
      for (const chapter of await this.listChapters(novel.id)) {
        const list = read<ChapterCandidate[]>(candidatesKey(chapter.id), []),
          index = list.findIndex((item) => item.id === id);
        if (index < 0) continue;
        const item = {
          ...list[index],
          status: "accepted" as const,
          updatedAt: new Date().toISOString(),
        };
        list[index] = item;
        write(candidatesKey(chapter.id), list);
        await this.saveChapter({
          chapterId: chapter.id,
          title: chapter.title,
          outline: chapter.outline,
          content: item.content,
          createSnapshot: true,
          origin: "accepted",
        });
        write(
          chaptersKey(novel.id),
          (await this.listChapters(novel.id)).map((value) =>
            value.id === chapter.id
              ? { ...value, status: "accepted" as const }
              : value,
          ),
        );
        return item;
      }
    }
    throw new Error("Candidate not found");
  },
  async rejectChapterCandidate(id: string) {
    for (const novel of readNovels()) {
      for (const chapter of await this.listChapters(novel.id)) {
        const list = read<ChapterCandidate[]>(candidatesKey(chapter.id), []),
          index = list.findIndex((item) => item.id === id);
        if (index < 0) continue;
        const item = {
          ...list[index],
          status: "rejected" as const,
          updatedAt: new Date().toISOString(),
        };
        list[index] = item;
        write(candidatesKey(chapter.id), list);
        return item;
      }
    }
    throw new Error("Candidate not found");
  },
  async listChapterVersions(chapterId: string) {
    return read<ChapterVersion[]>(versionsKey(chapterId), []);
  },
  async createChapterSnapshot(chapterId: string) {
    const chapter = await this.getChapter(chapterId);
    if (!chapter) throw new Error("Chapter not found");
    const versions = read<ChapterVersion[]>(versionsKey(chapterId), []);
    const version: ChapterVersion = {
      id: nanoid(),
      chapterId,
      versionNo: (versions[0]?.versionNo ?? 0) + 1,
      origin: "manual",
      content: chapter.content,
      wordCount: chapter.wordCount,
      createdAt: new Date().toISOString(),
    };
    write(versionsKey(chapterId), [version, ...versions]);
    return version;
  },
  async listBibleSections(novelId: string) {
    const stored = read<BibleSection[]>(bibleKey(novelId), []),
      now = new Date().toISOString(),
      kinds: BibleSectionKind[] = ["intent", "world", "style", "boundaries"];
    const sections = kinds.map(
      (kind) =>
        stored.find((item) => item.kind === kind) ?? {
          id: `${novelId}:bible:${kind}`,
          novelId,
          kind,
          content: "",
          versionNo: 1,
          updatedAt: now,
        },
    );
    write(bibleKey(novelId), sections);
    return sections;
  },
  async saveBibleSection(input: SaveBibleSectionInput) {
    const sections = await this.listBibleSections(input.novelId),
      index = sections.findIndex((item) => item.kind === input.kind);
    const section: BibleSection = {
      ...sections[index],
      content: input.content,
      versionNo: sections[index].versionNo + 1,
      updatedAt: new Date().toISOString(),
    };
    sections[index] = section;
    write(bibleKey(input.novelId), sections);
    return section;
  },
  async listStoryEntities(novelId: string, type?: StoryEntityType) {
    const entities = read<StoryEntity[]>(entitiesKey(novelId), []);
    return type ? entities.filter((item) => item.type === type) : entities;
  },
  async saveStoryEntity(input: SaveStoryEntityInput) {
    const entities = read<StoryEntity[]>(entitiesKey(input.novelId), []),
      index = entities.findIndex((item) => item.id === input.id),
      now = new Date().toISOString();
    const entity: StoryEntity = {
      id: input.id ?? nanoid(),
      novelId: input.novelId,
      type: input.type,
      name: input.name.trim(),
      summary: input.summary,
      aliases: normalizeAliases(input.aliases),
      profile: input.profile,
      status: "active",
      createdAt: index >= 0 ? entities[index].createdAt : now,
      updatedAt: now,
    };
    if (index >= 0) entities[index] = entity;
    else entities.unshift(entity);
    write(entitiesKey(input.novelId), entities);
    return entity;
  },
  async deleteStoryEntity(entityId: string) {
    for (const novel of readNovels()) {
      const entities = read<StoryEntity[]>(entitiesKey(novel.id), []);
      if (entities.some((item) => item.id === entityId)) {
        write(
          entitiesKey(novel.id),
          entities.filter((item) => item.id !== entityId),
        );
        return;
      }
    }
  },
  async listTimelineEvents(novelId: string) {
    return read<TimelineEvent[]>(timelineKey(novelId), []).sort((a, b) =>
      a.storyTime.localeCompare(b.storyTime),
    );
  },
  async saveTimelineEvent(input: SaveTimelineEventInput) {
    const list = read<TimelineEvent[]>(timelineKey(input.novelId), []),
      index = list.findIndex((item) => item.id === input.id),
      now = new Date().toISOString(),
      item: TimelineEvent = {
        id: input.id ?? nanoid(),
        novelId: input.novelId,
        chapterId: input.chapterId,
        storyTime: input.storyTime,
        title: input.title.trim(),
        detail: input.detail,
        participantIds: normalizeStateList(input.participantIds),
        source: input.source ?? "manual",
        createdAt: index >= 0 ? list[index].createdAt : now,
        updatedAt: now,
      };
    if (index >= 0) list[index] = item;
    else list.push(item);
    write(timelineKey(input.novelId), list);
    return item;
  },
  async deleteTimelineEvent(id: string) {
    for (const novel of readNovels()) {
      const list = read<TimelineEvent[]>(timelineKey(novel.id), []);
      if (list.some((item) => item.id === id)) {
        write(
          timelineKey(novel.id),
          list.filter((item) => item.id !== id),
        );
        return;
      }
    }
  },
  async listForeshadowThreads(novelId: string) {
    return read<ForeshadowThread[]>(foreshadowKey(novelId), []);
  },
  async saveForeshadowThread(input: SaveForeshadowInput) {
    const list = read<ForeshadowThread[]>(foreshadowKey(input.novelId), []),
      index = list.findIndex((item) => item.id === input.id),
      now = new Date().toISOString(),
      item: ForeshadowThread = {
        id: input.id ?? nanoid(),
        novelId: input.novelId,
        title: input.title.trim(),
        detail: input.detail,
        setupChapterId: input.setupChapterId,
        payoffChapterId: input.payoffChapterId,
        status: input.status,
        source: input.source ?? "manual",
        createdAt: index >= 0 ? list[index].createdAt : now,
        updatedAt: now,
      };
    if (index >= 0) list[index] = item;
    else list.unshift(item);
    write(foreshadowKey(input.novelId), list);
    return item;
  },
  async deleteForeshadowThread(id: string) {
    for (const novel of readNovels()) {
      const list = read<ForeshadowThread[]>(foreshadowKey(novel.id), []);
      if (list.some((item) => item.id === id)) {
        write(
          foreshadowKey(novel.id),
          list.filter((item) => item.id !== id),
        );
        return;
      }
    }
  },
  async listCharacterStates(novelId: string, characterId?: string) {
    const list = read<CharacterState[]>(characterStatesKey(novelId), []).map(
      (item) => ({ ...item, skills: item.skills ?? [] }),
    );
    return characterId
      ? list.filter((item) => item.characterId === characterId)
      : list;
  },
  async saveCharacterState(input: SaveCharacterStateInput) {
    const list = read<CharacterState[]>(characterStatesKey(input.novelId), []),
      index = list.findIndex((item) => item.id === input.id),
      now = new Date().toISOString(),
      item: CharacterState = {
        id: input.id ?? nanoid(),
        novelId: input.novelId,
        characterId: input.characterId,
        chapterId: input.chapterId,
        summary: input.summary,
        location: input.location,
        physical: input.physical,
        emotional: input.emotional,
        knowledge: normalizeStateList(input.knowledge),
        goals: normalizeStateList(input.goals),
        inventory: normalizeStateList(input.inventory),
        skills: normalizeStateList(input.skills),
        source: input.source ?? "manual",
        createdAt: index >= 0 ? list[index].createdAt : now,
        updatedAt: now,
      };
    if (index >= 0) list[index] = item;
    else list.unshift(item);
    write(characterStatesKey(input.novelId), list);
    return item;
  },
  async deleteCharacterState(id: string) {
    for (const novel of readNovels()) {
      const list = read<CharacterState[]>(characterStatesKey(novel.id), []);
      if (list.some((item) => item.id === id)) {
        write(
          characterStatesKey(novel.id),
          list.filter((item) => item.id !== id),
        );
        return;
      }
    }
  },
  async createGenerationDraft(novelId: string, policy: GenerationPolicy) {
    const workflow = await this.getPlanningWorkflow(novelId);
    if (!workflow.confirmedSteps.includes(9))
      throw new Error("请先完成小说框架十步向导和一致性检查");
    const novel = readNovels().find(
      (item) => item.id === novelId,
    );
    if (!novel) throw new Error("作品不存在");
    const [sections, entities, structure, allChapters, cycles] = await Promise.all([
      this.listBibleSections(novelId),
      this.listStoryEntities(novelId),
      this.listStoryStructure(novelId),
      this.listChapters(novelId),
      this.listPlanningCycles(novelId),
    ]);
    const cycle = cycles.find(
      (item) =>
        item.startChapter === policy.startChapter &&
        item.endChapter === policy.endChapter &&
        ["ready", "generating"].includes(item.status),
    );
    if (!cycle)
      throw new Error(
        `第 ${policy.startChapter}–${policy.endChapter} 章策划包尚未通过一致性检查`,
      );
    assertPlanningReady({
      novel,
      sections,
      entities,
      volumes: structure.volumes,
      chapters: allChapters,
      range: {
        startChapter: policy.startChapter,
        endChapter: policy.endChapter,
      },
    });
    const now = new Date().toISOString(),
      id = nanoid(),
      batch: GenerationBatch = {
        id,
        novelId,
        status: "queued",
        policy,
        outputTokensUsed: 0,
        createdAt: now,
        updatedAt: now,
      },
      chapters = (await this.listChapters(novelId)).filter(
        (item) =>
          item.position >= policy.startChapter &&
          item.position <= policy.endChapter,
      ),
      jobs: GenerationJob[] = chapters.map((chapter, index) => ({
        id: nanoid(),
        batchId: id,
        chapterId: chapter.id,
        position: index + 1,
        status: "queued",
        attempt: 0,
        candidateId: null,
        inputTokens: 0,
        outputTokens: 0,
        error: "",
        updatedAt: now,
      }));
    write(BATCHES_KEY, [batch, ...read<GenerationBatch[]>(BATCHES_KEY, [])]);
    write(jobsKey(id), jobs);
    await this.savePlanningCycle({ ...cycle, status: "generating" });
    return { id, estimate: estimateGeneration(policy) };
  },
  async listGenerationBatches() {
    return read<GenerationBatch[]>(BATCHES_KEY, []);
  },
  async listGenerationJobs(id: string) {
    return read<GenerationJob[]>(jobsKey(id), []);
  },
  async setBatchStatus(id: string, status: GenerationBatch["status"]) {
    const list = read<GenerationBatch[]>(BATCHES_KEY, []),
      index = list.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("Batch not found");
    list[index] = {
      ...list[index],
      status,
      updatedAt: new Date().toISOString(),
    };
    write(BATCHES_KEY, list);
    return list[index];
  },
  async updateGenerationJob(
    id: string,
    status: GenerationJobStatus,
    patch = {},
  ) {
    for (const batch of read<GenerationBatch[]>(BATCHES_KEY, [])) {
      const list = read<GenerationJob[]>(jobsKey(batch.id), []),
        index = list.findIndex((item) => item.id === id);
      if (index < 0) continue;
      const previous = list[index],
        item = {
          ...previous,
          ...patch,
          status,
          updatedAt: new Date().toISOString(),
        };
      list[index] = item;
      write(jobsKey(batch.id), list);
      if (item.outputTokens !== previous.outputTokens) {
        const batches = read<GenerationBatch[]>(BATCHES_KEY, []),
          bi = batches.findIndex((value) => value.id === batch.id);
        batches[bi] = {
          ...batches[bi],
          outputTokensUsed:
            batches[bi].outputTokensUsed +
            item.outputTokens -
            previous.outputTokens,
        };
        write(BATCHES_KEY, batches);
      }
      return item;
    }
    throw new Error("Job not found");
  },
  async startBackgroundBatch() {},
  async pauseBackgroundBatch() {},
};

export const platform: PlatformPort = window.amyNovel ?? webPlatform;

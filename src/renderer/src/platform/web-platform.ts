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
  parseBriefDraft,
  briefDraftingMaxOutputTokens,
  briefDraftingPrompt,
} from "@domain/brief-drafting";
import {
  parsePersonaRecommendation,
  personaRecommendationMaxOutputTokens,
  personaRecommendationPrompt,
  type PersonaSuggestion,
} from "@domain/persona-recommendation";
import type {
  ChapterCandidate,
  ContinueChapterInput,
  ContinueChapterResult,
  GenerateChapterInput,
  GenerationProgress,
} from "@domain/chapter-generation";
import type { FactProposal, StoredFinding } from "@domain/quality-check";
import { estimateTokens } from "@domain/context-pack";
import {
  GLOBAL_REVIEW_CYCLE_ID,
  globalReviewPrompt,
  parseGlobalReview,
  type GlobalFinding,
} from "@domain/global-consistency";
import { runWholeBookReview } from "@application/whole-book-review-runner";
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
  candidateReviewComplete,
  estimateGeneration,
  pendingFactProposalCount,
  type GenerationBatch,
  type GenerationEvent,
  type GenerationJob,
  type GenerationJobStatus,
  type GenerationPolicy,
  type NewGenerationEvent,
} from "@domain/generation";
import type { PlatformPort } from "@application/ports/platform-port";
import {
  remapEntityShortRef,
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
// AN-006：数据落 IndexedDB（内存镜像保持同步读），localStorage 仅存迁移标记。
import {
  initWebStorage,
  keysWithPrefix,
  read,
  remove,
  write,
} from "./web-storage";
import {
  applyNovelPlan,
  validateNovelPlanContent,
} from "@application/apply-novel-plan";
import { repairPlanningContentOnce } from "@application/repair-planning-content";
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
import {
  planningProposalIdentity,
  type NewPlanningProposal,
  type PlanningProposal,
  type PlanningProposalStatus,
} from "@domain/planning-proposal";
import { reviewPlanningProposal } from "@application/review-planning-proposal";
import {
  applyStyleTemplate,
  parseStyleAnalysis,
  styleAnalysisPrompt,
  type AnalyzeStyleTemplateInput,
  type SaveStyleTemplateInput,
  type StyleTemplate,
} from "@domain/style-template";
import type {
  CreateWorkflowRunInput,
  UpdateWorkflowRunInput,
  WorkflowRun,
} from "@domain/workflow-run";

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
const STYLE_TEMPLATES_KEY = "amy-novel:style-templates";
const candidatesKey = (chapterId: string) =>
  `amy-novel:candidates:${chapterId}`;
const findingsKey = (candidateId: string) =>
  `amy-novel:findings:${candidateId}`;
const proposalsKey = (candidateId: string) =>
  `amy-novel:proposals:${candidateId}`;
const BATCHES_KEY = "amy-novel:generation-batches";
const jobsKey = (id: string) => `amy-novel:generation-jobs:${id}`;
const eventsKey = (id: string) => `amy-novel:generation-events:${id}`;
const workflowKey = (novelId: string) =>
  `amy-novel:planning-workflow:${novelId}`;
const planningRunsKey = (novelId: string) =>
  `amy-novel:planning-runs:${novelId}`;
const planningCyclesKey = (novelId: string) =>
  `amy-novel:planning-cycles:${novelId}`;
const planningPlanProposalsKey = (novelId: string) =>
  `amy-novel:planning-proposals:${novelId}`;
const workflowRunsKey = (novelId: string) =>
  `amy-novel:workflow-runs:${novelId}`;
const globalFindingsKey = (novelId: string) =>
  `amy-novel:global-findings:${novelId}`;

async function requestWebPlanning(
  profile: ModelProfile,
  apiKey: string,
  prompt: string,
  maxOutputTokens: number,
  temperature: number,
): Promise<{
  content: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  measured: boolean;
}> {
  const response = await fetch(normalizeChatCompletionsUrl(profile.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(
      chatCompletionsRequestBody(profile, prompt, {
        maxOutputTokens,
        temperature,
        stream: false,
        thinking: "disabled",
      }),
    ),
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok)
    throw new Error(`模型请求失败（HTTP ${response.status}）`);
  const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    },
    content = data.choices?.[0]?.message?.content ?? "";
  return {
    content,
    inputTokens: data.usage?.prompt_tokens ?? estimateTokens(prompt),
    outputTokens: data.usage?.completion_tokens ?? estimateTokens(content),
    cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    measured: Boolean(data.usage),
  };
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
    seen = new Set(
      kept
        .filter((item) => item.status !== "rejected")
        .map(planningProposalIdentity),
    ),
    created = proposals.filter((item) => {
      const key = planningProposalIdentity(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((item) => ({
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

function addWebPlanningProposals(
  novelId: string,
  cycleId: string,
  startChapter: number,
  endChapter: number,
  proposals: NewPlanningProposal[],
): PlanningProposal[] {
  const existing = read<PlanningProposal[]>(
      planningPlanProposalsKey(novelId),
      [],
    ),
    seen = new Set(
      existing
        .filter((item) => item.status !== "rejected")
        .map(planningProposalIdentity),
    ),
    now = new Date().toISOString(),
    created = proposals
      .filter((item) => {
        const key = planningProposalIdentity(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((item) => ({
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
  write(planningPlanProposalsKey(novelId), [...existing, ...created]);
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

function reviewWebCandidate(candidateId: string): {
  candidate: ChapterCandidate | null;
  pending: number;
  batch: GenerationBatch | null;
  job: GenerationJob | null;
} {
  let candidate: ChapterCandidate | null = null;
  for (const novel of readNovels()) {
    for (const chapter of read<Chapter[]>(chaptersKey(novel.id), [])) {
      candidate =
        read<ChapterCandidate[]>(candidatesKey(chapter.id), []).find(
          (item) => item.id === candidateId,
        ) ?? null;
      if (candidate) break;
    }
    if (candidate) break;
  }
  const proposals = read<FactProposal[]>(proposalsKey(candidateId), []),
    pending = pendingFactProposalCount(proposals);
  for (const batch of read<GenerationBatch[]>(BATCHES_KEY, [])) {
    const jobs = read<GenerationJob[]>(jobsKey(batch.id), []),
      index = jobs.findIndex((item) => item.candidateId === candidateId);
    if (index < 0) continue;
    if (
      candidate &&
      candidateReviewComplete(candidate.status, proposals) &&
      jobs[index].status === "candidate_ready"
    ) {
      jobs[index] = {
        ...jobs[index],
        status: "completed",
        updatedAt: new Date().toISOString(),
      };
      write(jobsKey(batch.id), jobs);
    }
    return { candidate, pending, batch, job: jobs[index] };
  }
  return { candidate, pending, batch: null, job: null };
}

export const webPlatform: PlatformPort = {
  host: "web",
  /** 首次读取前等待 IndexedDB 装载与旧数据迁移完成。 */
  ready: () => initWebStorage(),
  async getDiagnostics() {
    return {
      generatedAt: new Date().toISOString(),
      appVersion: "1.0.0-web",
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
        signal: AbortSignal.timeout(120_000),
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
        signal: AbortSignal.timeout(120_000),
      },
    );
    if (!response.ok)
      throw new Error(`模型请求失败（HTTP ${response.status}）`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return parseBriefDraft(data.choices?.[0]?.message?.content ?? "");
  },
  async suggestPersonaLineup(novelId: string): Promise<PersonaSuggestion[]> {
    const novel = readNovels().find((item) => item.id === novelId);
    if (!novel) throw new Error("作品不存在");
    const profile = read<ModelProfile[]>(PROFILES_KEY, []).find(
      (item) => item.isDefault,
    );
    if (!profile) throw new Error("请先在设置页配置默认写作模型");
    const key = sessionStorage.getItem(`amy-novel:secret:${profile.id}`) ?? "",
      bible = await this.listBibleSections(novelId),
      characters = await this.listStoryEntities(novelId),
      prompt = personaRecommendationPrompt({ novel, bible, characters }),
      response = await fetch(normalizeChatCompletionsUrl(profile.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(
          chatCompletionsRequestBody(profile, prompt, {
            maxOutputTokens: personaRecommendationMaxOutputTokens(),
            temperature: 0.6,
            stream: false,
            thinking: "disabled",
          }),
        ),
        signal: AbortSignal.timeout(180_000),
      });
    if (!response.ok)
      throw new Error(`模型请求失败（HTTP ${response.status}）`);
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return parsePersonaRecommendation(
      data.choices?.[0]?.message?.content ?? "",
      characters,
    );
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
        item.cycleId === "entity-merge" || cycleIds.has(item.cycleId)
          ? [{
              ...item,
              id: nanoid(),
              novelId: id,
              cycleId:
                item.cycleId === "entity-merge"
                  ? "entity-merge"
                  : cycleIds.get(item.cycleId)!,
              targetRef: remapEntityShortRef(
                item.targetRef,
                bundle.entities,
                entityIds,
              ),
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
      remove(findingsKey(candidate.id));
      remove(proposalsKey(candidate.id));
    }
    for (const chapter of chapters) {
      remove(versionsKey(chapter.id));
      remove(candidatesKey(chapter.id));
    }
    for (const batch of batches.filter((item) => item.novelId === id)) {
      remove(jobsKey(batch.id));
      remove(eventsKey(batch.id));
    }
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
    ].forEach((key) => remove(key));
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
    const rollingMemory =
      phase === "structure" && range
        ? await Promise.all([
            this.listPlanningCycles(novelId),
            this.listCharacterStates(novelId),
            this.listTimelineEvents(novelId),
            this.listForeshadowThreads(novelId),
          ]).then(([cycles, characterStates, timeline, foreshadow]) => ({
            cycles,
            characterStates,
            timeline,
            foreshadow,
          }))
        : undefined;
    const poolKey = `amy-novel:name-pool:${novelId}`,
      namePool = read<NamePool>(poolKey, defaultNamePool(novelId, novel.genre)),
      planEventId = `planning:${novelId}`,
      emitPlan = (
        stage: "plan_started" | "context_build" | "generating" | "plan_received" | "plan_applied" | "retry" | "failed" | "batch_completed",
        level: "info" | "success" | "warning" | "error",
        message: string,
        data: Record<string, unknown> = {},
      ) =>
        void this.appendGenerationEvent?.({
          batchId: planEventId,
          novelId,
          chapterId: null,
          stage,
          level,
          message,
          data: { phase, ...data },
        });
    emitPlan(
      "plan_started",
      "info",
      `开始生成规划：读取设定（圣经 ${bible.filter((item) => item.content.trim()).length} 份、实体 ${entities.length} 张、章节 ${chapters.length} 章）`,
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
    emitPlan(
      "context_build",
      "info",
      `提示已构建（约 ${estimateTokens(prompt).toLocaleString()} tokens，模型 ${profile.modelId}）`,
      { inputTokens: estimateTokens(prompt), model: profile.modelId },
    );
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
        repairResponse: "",
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
      const result = await requestWebPlanning(
          profile,
          key,
          prompt,
          planningMaxOutputTokens(phase),
          0.7,
        ),
        received: PlanningRun = {
          ...run,
          rawResponse: result.content,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          cachedTokens: result.cachedTokens,
          status: "received",
          updatedAt: new Date().toISOString(),
        };
      let latestRun = received;
      // 原始响应先保存，解析失败时仍可检查和重新解析。
      saveRun(received);
      emitPlan(
        "plan_received",
        "info",
        `模型已返回 ${result.content.length.toLocaleString()} 字，正在解析并写入`,
        { outputTokens: result.outputTokens },
      );
      await this.saveUsage({
        novelId,
        chapterId: null,
        operation: "planning",
        provider: profile.provider,
        model: profile.modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cachedTokens: received.cachedTokens,
        cost: null,
        measurement: result.measured ? "provider" : "estimated",
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
          emitPlan(
            "retry",
            "warning",
            "规划 JSON 解析失败，正在执行一次低温结构修复",
          );
          const repaired = await requestWebPlanning(
            profile,
            key,
            repairPrompt,
            planningMaxOutputTokens(phase),
            0.1,
          );
          latestRun = {
            ...latestRun,
            repairResponse: repaired.content,
            inputTokens: latestRun.inputTokens + repaired.inputTokens,
            outputTokens: latestRun.outputTokens + repaired.outputTokens,
            cachedTokens: latestRun.cachedTokens + repaired.cachedTokens,
            updatedAt: new Date().toISOString(),
          };
          saveRun(latestRun);
          await this.saveUsage({
            novelId,
            chapterId: null,
            operation: "planning",
            provider: profile.provider,
            model: profile.modelId,
            inputTokens: repaired.inputTokens,
            outputTokens: repaired.outputTokens,
            cachedTokens: repaired.cachedTokens,
            cost: null,
            measurement: repaired.measured ? "provider" : "estimated",
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
          addPlanningProposals: (id, cycleId, start, end, proposals) =>
            Promise.resolve(
              addWebPlanningProposals(id, cycleId, start, end, proposals),
            ),
        },
      });
      saveRun({
        ...latestRun,
        status: "completed",
        updatedAt: new Date().toISOString(),
      });
      emitPlan(
        "plan_applied",
        "success",
        `已写入正史草稿：${summary.sections} 份文档、${summary.entities} 张实体卡、${summary.chapters} 个章节策划`,
        { sections: summary.sections, entities: summary.entities, chapters: summary.chapters },
      );
      emitPlan("batch_completed", "success", "规划生成完成，请回到页面审核");
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
      emitPlan(
        "failed",
        "error",
        `生成失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
      throw error;
    }
  },
  async listPlanningRuns(novelId: string) {
    return read<PlanningRun[]>(planningRunsKey(novelId), []).map((item) => ({
      ...item,
      repairResponse: item.repairResponse ?? "",
    }));
  },
  async listPlanningCycles(novelId: string) {
    return read<PlanningCycle[]>(planningCyclesKey(novelId), []);
  },
  async savePlanningCycle(input: SavePlanningCycleInput) {
    if (input.status === "completed") {
      const chapters = read<Chapter[]>(chaptersKey(input.novelId), []).filter(
          (item) =>
            item.position >= input.startChapter &&
            item.position <= input.endChapter,
        ),
        accepted = chapters.flatMap((chapter) =>
          read<ChapterCandidate[]>(candidatesKey(chapter.id), []).filter(
            (item) => item.status === "accepted",
          ),
        ),
        pending = accepted.reduce(
          (total, candidate) =>
            total +
            pendingFactProposalCount(
              read<FactProposal[]>(proposalsKey(candidate.id), []),
            ),
          0,
        );
      if (pending)
        throw new Error(
          `本批仍有 ${pending} 条正史建议未处理，不能封存周期`,
        );
    }
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
  async createWorkflowRun(input: CreateWorkflowRunInput) {
    const now = new Date().toISOString(),
      run: WorkflowRun = {
        id: nanoid(),
        novelId: input.novelId,
        mode: input.mode,
        currentPhase: "bible",
        status: "paused",
        checkpoint: null,
        config: input.config,
        attempt: 0,
        batchId: null,
        error: "",
        createdAt: now,
        updatedAt: now,
      };
    write(workflowRunsKey(input.novelId), [
      run,
      ...read<WorkflowRun[]>(workflowRunsKey(input.novelId), []),
    ]);
    return run;
  },
  async updateWorkflowRun(input: UpdateWorkflowRunInput) {
    for (const novel of readNovels()) {
      const list = read<WorkflowRun[]>(workflowRunsKey(novel.id), []),
        index = list.findIndex((item) => item.id === input.id);
      if (index < 0) continue;
      list[index] = {
        ...list[index],
        ...input,
        updatedAt: new Date().toISOString(),
      };
      write(workflowRunsKey(novel.id), list);
      return list[index];
    }
    throw new Error("Workflow run 不存在");
  },
  async listWorkflowRuns(novelId: string) {
    return read<WorkflowRun[]>(workflowRunsKey(novelId), []);
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
  async listStyleTemplates() {
    return read<StyleTemplate[]>(STYLE_TEMPLATES_KEY, []);
  },
  async analyzeStyleTemplate(input: AnalyzeStyleTemplateInput) {
    if (input.sampleText.trim().length < 200)
      throw new Error("样章至少需要 200 字，才能可靠提炼文风");
    const profile = read<ModelProfile[]>(PROFILES_KEY, []).find(
      (item) => item.id === input.profileId,
    );
    if (!profile) throw new Error("Model profile not found");
    const key = sessionStorage.getItem(`amy-novel:secret:${profile.id}`) ?? "",
      response = await fetch(normalizeChatCompletionsUrl(profile.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(
          chatCompletionsRequestBody(profile, styleAnalysisPrompt(input), {
            maxOutputTokens: 3000,
            temperature: 0.3,
            stream: false,
            thinking: "disabled",
          }),
        ),
        signal: AbortSignal.timeout(180_000),
      });
    if (!response.ok)
      throw new Error(`模型请求失败（HTTP ${response.status}）`);
    const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      },
      analysis = parseStyleAnalysis(
        data.choices?.[0]?.message?.content ?? "",
      );
    return this.saveStyleTemplate({
      name: input.name?.trim() || analysis.name,
      authorAlias: input.authorAlias?.trim() || analysis.authorAlias,
      sourceTitle: input.sourceTitle?.trim() || "",
      sampleText: input.sampleText,
      contentSummary: analysis.contentSummary,
      styleSummary: analysis.styleSummary,
      styleGuide: analysis.styleGuide,
    });
  },
  async saveStyleTemplate(input: SaveStyleTemplateInput) {
    const list = read<StyleTemplate[]>(STYLE_TEMPLATES_KEY, []),
      now = new Date().toISOString(),
      existing = input.id ? list.find((item) => item.id === input.id) : null,
      item: StyleTemplate = {
        ...input,
        id: input.id ?? nanoid(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      },
      next = list.some((value) => value.id === item.id)
        ? list.map((value) => (value.id === item.id ? item : value))
        : [item, ...list];
    write(STYLE_TEMPLATES_KEY, next);
    return item;
  },
  async deleteStyleTemplate(id: string) {
    write(
      STYLE_TEMPLATES_KEY,
      read<StyleTemplate[]>(STYLE_TEMPLATES_KEY, []).filter(
        (item) => item.id !== id,
      ),
    );
  },
  async generateChapter(
    input: GenerateChapterInput,
    onProgress: (event: GenerationProgress) => void,
  ) {
    const profile = read<ModelProfile[]>(PROFILES_KEY, []).find(
      (item) => item.id === input.profileId,
    );
    if (!profile) throw new Error("Model profile not found");
    const template = input.styleTemplateId
        ? read<StyleTemplate[]>(STYLE_TEMPLATES_KEY, []).find(
            (item) => item.id === input.styleTemplateId,
          )
        : null,
      prompt = applyStyleTemplate(input.contextText, template),
      key = sessionStorage.getItem(`amy-novel:secret:${profile.id}`) ?? "";
    if (input.styleTemplateId && !template)
      throw new Error("所选文风模板已不存在，请重新选择");
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
          chatCompletionsRequestBody(profile, prompt, {
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
    inputTokens ||= estimateTokens(prompt);
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
    for (const candidate of keysWithPrefix("amy-novel:findings:")) {
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
    for (const key of keysWithPrefix("amy-novel:proposals:")) {
      const list = read<FactProposal[]>(key, []),
        index = list.findIndex((item) => item.id === id);
      if (index >= 0) {
        list[index] = {
          ...list[index],
          status,
          updatedAt: new Date().toISOString(),
        };
        write(key, list);
        const { candidate, pending, batch, job } = reviewWebCandidate(
          list[index].candidateId,
        );
        if (
          candidate?.status === "accepted" &&
          !pending &&
          batch &&
          job?.status === "completed"
        )
          await this.appendGenerationEvent?.({
            batchId: batch.id,
            novelId: candidate.novelId,
            chapterId: candidate.chapterId,
            stage: "chapter_accepted",
            level: "success",
            message: "本章正史建议已全部处理，可以继续生成下一章",
            data: { candidateId: candidate.id, position: job.position },
          });
        return list[index];
      }
    }
    throw new Error("事实建议不存在");
  },
  async cancelGeneration() {
    /* Browser preview stops between chapter checkpoints; Electron aborts immediately. */
  },
  async continueChapter(
    input: ContinueChapterInput,
  ): Promise<ContinueChapterResult> {
    const profile = read<ModelProfile[]>(PROFILES_KEY, []).find(
      (item) => item.id === input.profileId,
    );
    if (!profile) throw new Error("Model profile not found");
    const key = sessionStorage.getItem(`amy-novel:secret:${profile.id}`) ?? "",
      response = await fetch(normalizeChatCompletionsUrl(profile.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
        },
        body: JSON.stringify(
          chatCompletionsRequestBody(profile, input.prompt, {
            maxOutputTokens: input.maxOutputTokens,
            temperature: input.temperature,
            stream: false,
            thinking: "disabled",
          }),
        ),
        signal: AbortSignal.timeout(300_000),
      });
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
    const content = data.choices?.[0]?.message?.content ?? "";
    await this.saveUsage({
      novelId: input.novelId,
      chapterId: input.chapterId,
      operation: "generation",
      provider: profile.provider,
      model: profile.modelId,
      inputTokens: data.usage?.prompt_tokens ?? estimateTokens(input.prompt),
      outputTokens: data.usage?.completion_tokens ?? estimateTokens(content),
      cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cost: null,
      measurement: data.usage ? "provider" : "estimated",
    });
    return {
      content,
      inputTokens: data.usage?.prompt_tokens ?? estimateTokens(input.prompt),
      outputTokens: data.usage?.completion_tokens ?? estimateTokens(content),
      cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    };
  },
  async updateChapterCandidateContent(id: string, content: string) {
    for (const novel of readNovels()) {
      for (const chapter of await this.listChapters(novel.id)) {
        const list = read<ChapterCandidate[]>(candidatesKey(chapter.id), []),
          index = list.findIndex((item) => item.id === id);
        if (index < 0) continue;
        if (list[index].status !== "candidate")
          throw new Error("候选稿已处理，不能再修改；请重新生成");
        list[index] = {
          ...list[index],
          content,
          wordCount: content.replace(/\s+/g, "").length,
          updatedAt: new Date().toISOString(),
        };
        write(candidatesKey(chapter.id), list);
        return list[index];
      }
    }
    throw new Error("Candidate not found");
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
        const { pending, batch, job } = reviewWebCandidate(id);
        if (batch && job) {
          await this.appendGenerationEvent?.({
            batchId: batch.id,
            novelId: novel.id,
            chapterId: chapter.id,
            stage: "chapter_accepted",
            level: "success",
            message: pending
              ? `候选稿已写入正史；处理完 ${pending} 条正史建议后才能继续下一章`
              : "候选稿及正史建议均已处理，可以继续生成下一章",
            data: {
              candidateId: id,
              position: job.position,
              pendingProposals: pending,
            },
          });
        }
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
      (item) => ({
        ...item,
        appearance: item.appearance ?? "",
        outfit: item.outfit ?? "",
        identity: item.identity ?? "",
        skills: item.skills ?? [],
      }),
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
        appearance: input.appearance ?? "",
        outfit: input.outfit ?? "",
        identity: input.identity ?? "",
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
        policy.startChapter >= item.startChapter &&
        policy.endChapter <= item.endChapter &&
        ["ready", "generating"].includes(item.status),
    );
    if (!cycle)
      throw new Error(
        `第 ${policy.startChapter}–${policy.endChapter} 章不在已通过一致性检查的策划包范围内`,
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
    // AN-028：同一作品同时只允许一个未完结批次。多批次并存时自动审阅会
    // 在批次间来回跳，还会对已入正史的章节重复排队生成。
    const existingBatch = (await this.listGenerationBatches()).find(
      (item) =>
        item.novelId === novelId &&
        item.status !== "completed" &&
        item.status !== "cancelled",
    );
    if (existingBatch)
      throw new Error(
        `已有进行中的批次（第 ${existingBatch.policy.startChapter}–${existingBatch.policy.endChapter} 章，${
          existingBatch.awaitingReview
            ? "等待审核"
            : `状态：${existingBatch.status}`
        }）。请先到生成工作台继续或停止该批次，再创建新任务。`,
      );
    const now = new Date().toISOString(),
      id = nanoid(),
      batch: GenerationBatch = {
        id,
        novelId,
        status: "queued",
        policy,
        outputTokensUsed: 0,
        awaitingReview: false,
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
    return read<GenerationBatch[]>(BATCHES_KEY, []).map((item) => ({
      ...item,
      awaitingReview: item.awaitingReview ?? false,
    }));
  },
  async listGenerationJobs(id: string) {
    return read<GenerationJob[]>(jobsKey(id), []);
  },
  async listGenerationEvents(batchId: string) {
    return read<GenerationEvent[]>(eventsKey(batchId), []);
  },
  async appendGenerationEvent(input: NewGenerationEvent) {
    const event: GenerationEvent = {
      id: nanoid(),
      createdAt: new Date().toISOString(),
      ...input,
      data: input.data ?? {},
    };
    write(eventsKey(input.batchId), [
      event,
      ...read<GenerationEvent[]>(eventsKey(input.batchId), []),
    ]);
    return event;
  },
  async listGlobalFindings(novelId: string) {
    return read<GlobalFinding[]>(globalFindingsKey(novelId), []);
  },
  async saveGlobalFindings(novelId: string, findings: GlobalFinding[]) {
    write(globalFindingsKey(novelId), findings);
    return findings;
  },
  async reviewGlobalConsistency(novelId: string) {
    const novel = readNovels().find((item) => item.id === novelId);
    if (!novel) throw new Error("作品不存在");
    const profile = read<ModelProfile[]>(PROFILES_KEY, []).find(
      (item) => item.isDefault,
    );
    if (!profile) throw new Error("请先在设置页配置默认写作模型");
    const key = sessionStorage.getItem(`amy-novel:secret:${profile.id}`) ?? "";
    const [bible, entities, chapters, characterStates, timeline, foreshadow] =
      await Promise.all([
        this.listBibleSections(novelId),
        this.listStoryEntities(novelId),
        this.listChapters(novelId),
        this.listCharacterStates(novelId),
        this.listTimelineEvents(novelId),
        this.listForeshadowThreads(novelId),
      ]);
    const accepted = [...chapters]
      .filter((item) => item.status === "accepted" && item.content.trim())
      .sort((a, b) => a.position - b.position);
    const recentContents = accepted.slice(-2).map((item) => ({
      position: item.position,
      title: item.title,
      content: item.content,
    }));
    const prompt = globalReviewPrompt({
      novelTitle: novel.title,
      genre: novel.genre,
      bible: bible.map((item) => ({ title: item.kind, content: item.content })),
      entities,
      chapters: accepted,
      characterStates,
      timeline,
      foreshadow,
      recentContents,
      inputBudget: Math.max(4000, profile.contextWindow - 4000),
    });
    const batchId = `global-review:${novelId}`;
    try {
      await this.appendGenerationEvent?.({
        batchId,
        novelId,
        chapterId: null,
        stage: "global_review",
        level: "info",
        message: `全局一致性审查开始（约 ${estimateTokens(prompt).toLocaleString()} tokens，模型 ${profile.modelId}）`,
        data: { inputTokens: estimateTokens(prompt), model: profile.modelId },
      });
      const result = await requestWebPlanning(profile, key, prompt, 4000, 0.3);
      const outcome = parseGlobalReview(result.content, { novelId });
      // AI 发现替换上一轮 AI 发现；忽略状态按稳定 id 延续，规则发现原样保留。
      const previous = read<GlobalFinding[]>(globalFindingsKey(novelId), []),
        dismissed = new Set(
          previous
            .filter((item) => item.source === "ai" && item.status === "dismissed")
            .map((item) => item.id),
        ),
        aiFindings = outcome.findings.map((item) => ({
          ...item,
          status: dismissed.has(item.id) ? ("dismissed" as const) : item.status,
        })),
        // AI 发现替换上一轮 AI 发现；作者疑点标记（source=author）与规则发现保留。
        merged = [
          ...previous.filter((item) => item.source !== "ai"),
          ...aiFindings,
        ];
      write(globalFindingsKey(novelId), merged);
      const proposals = addWebPlanningProposals(
        novelId,
        GLOBAL_REVIEW_CYCLE_ID,
        1,
        accepted.at(-1)?.position ?? 1,
        outcome.proposals,
      );
      await this.saveUsage({
        novelId,
        chapterId: null,
        operation: "global_review",
        provider: profile.provider,
        model: profile.modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cachedTokens: result.cachedTokens,
        cost: null,
        measurement: result.measured ? "provider" : "estimated",
      });
      await this.appendGenerationEvent?.({
        batchId,
        novelId,
        chapterId: null,
        stage: "global_review",
        level: outcome.findings.some((item) => item.severity === "error")
          ? "warning"
          : "success",
        message: outcome.findings.length
          ? `全局审查发现 ${outcome.findings.length} 项问题，${proposals.length} 项设定修复提案`
          : "全局审查通过，未发现问题",
        data: {
          summary: outcome.summary,
          findings: outcome.findings.map((item) => item.message),
          proposals: proposals.length,
        },
      });
      return { summary: outcome.summary, findings: aiFindings, proposals };
    } catch (error) {
      await this.appendGenerationEvent?.({
        batchId,
        novelId,
        chapterId: null,
        stage: "global_review",
        level: "error",
        message: `全局一致性审查失败：${error instanceof Error ? error.message : "未知错误"}`,
        data: {},
      });
      throw error;
    }
  },
  async reviewWholeBook(novelId: string, options?: { windowSize?: number }) {
    const novel = readNovels().find((item) => item.id === novelId);
    if (!novel) throw new Error("作品不存在");
    const profile = read<ModelProfile[]>(PROFILES_KEY, []).find(
      (item) => item.isDefault,
    );
    if (!profile) throw new Error("请先在设置页配置默认写作模型");
    const key =
      sessionStorage.getItem(`amy-novel:secret:${profile.id}`) ?? "";
    return runWholeBookReview(novelId, options, {
      novel,
      profile,
      listChapters: (id) => this.listChapters(id),
      listStoryEntities: (id) => this.listStoryEntities(id),
      listCharacterStates: (id) => this.listCharacterStates(id),
      listTimelineEvents: (id) => this.listTimelineEvents(id),
      listForeshadowThreads: (id) => this.listForeshadowThreads(id),
      listGlobalFindings: (id) => this.listGlobalFindings(id),
      saveGlobalFindings: (id, findings) =>
        this.saveGlobalFindings(id, findings),
      saveUsage: (input) => this.saveUsage(input),
      saveGenerationEvent: (event) =>
        this.appendGenerationEvent?.(event) ?? Promise.resolve(),
      callModel: (prompt) => requestWebPlanning(profile, key, prompt, 3000, 0.2),
    });
  },
  async setBatchStatus(
    id: string,
    status: GenerationBatch["status"],
    patch?: { awaitingReview?: boolean },
  ) {
    const list = read<GenerationBatch[]>(BATCHES_KEY, []),
      index = list.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("Batch not found");
    list[index] = {
      ...list[index],
      status,
      awaitingReview: patch?.awaitingReview ?? false,
      updatedAt: new Date().toISOString(),
    };
    write(BATCHES_KEY, list);
    return list[index];
  },
  async deleteGenerationBatch(id: string): Promise<void> {
    // AN-029：与 Electron 同一状态门禁——进行中/等待审核的批次先停止再删。
    const list = read<GenerationBatch[]>(BATCHES_KEY, []),
      batch = list.find((item) => item.id === id);
    if (!batch) throw new Error("Batch not found");
    if (batch.status !== "completed" && batch.status !== "cancelled")
      throw new Error("仅已完成或已取消的批次可删除；请先停止该批次");
    write(
      BATCHES_KEY,
      list.filter((item) => item.id !== id),
    );
    remove(jobsKey(id));
    remove(eventsKey(id));
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

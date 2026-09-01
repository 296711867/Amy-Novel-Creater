/**
 * 写操作 IPC 通道的参数守卫表（AN-012）。
 *
 * 键为 IPC_CHANNELS 常量的值，值为按 handler 参数顺序排列的守卫。
 * 读通道（list/get/diagnostics 等）不在表内，直接放行；未列出的可选
 * 字段不校验——语义与完整性由 Domain 和数据库层负责，这里只挡住
 * 信任边界上的类型攻击与垃圾输入。
 */
import { IPC_CHANNELS } from "@shared/ipc-contract";
import {
  arr,
  boolean,
  id,
  nullable,
  num,
  obj,
  oneOf,
  optional,
  str,
  type ArgumentGuard,
} from "./ipc-guard";

const planningPhases = ["bible", "cast", "scenes", "structure"] as const;
const workflowModes = ["autopilot", "checkpoint", "chapter"] as const;
const workflowPhases = [
  "bible",
  "cast",
  "scenes",
  "structure",
  "generation",
] as const;
const workflowStatuses = ["running", "paused", "failed", "completed"] as const;
const workflowCheckpoints = [
  "phase_review",
  "proposal_review",
  "chapter_review",
] as const;
const batchStatuses = [
  "draft",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
] as const;
const jobStatuses = [
  "queued",
  "building_context",
  "generating",
  "validating",
  "continuity_check",
  "candidate_ready",
  "completed",
  "waiting_retry",
  "failed",
  "paused",
] as const;
const chapterText = obj({
  chapterId: id(),
  title: str(),
  outline: str(),
  content: str(),
});

export const IPC_WRITE_GUARDS: Record<string, ArgumentGuard[]> = {
  [IPC_CHANNELS.createNovel]: [
    obj({
      title: str(),
      genre: str(),
      premise: str(),
      targetChapters: num({ min: 1, int: true }),
      chapterWords: num({ min: 500, max: 20000, int: true }),
    }),
  ],
  [IPC_CHANNELS.updateNovelSettings]: [
    id(),
    obj({ cycleSize: num({ min: 1, int: true }) }),
  ],
  [IPC_CHANNELS.deleteNovel]: [id()],
  [IPC_CHANNELS.importNovelProject]: [
    obj({
      format: str(),
      novel: obj({ id: id(), title: str() }),
    }),
  ],
  [IPC_CHANNELS.savePlanningWorkflow]: [
    obj({
      novelId: id(),
      confirmedSteps: arr(num({ int: true })),
    }),
  ],
  [IPC_CHANNELS.generateNovelPlan]: [
    id(),
    oneOf(planningPhases),
    optional(obj({ startChapter: num({ int: true }), endChapter: num({ int: true }) })),
  ],
  [IPC_CHANNELS.savePlanningCycle]: [
    obj({
      novelId: id(),
      startChapter: num({ min: 1, int: true }),
      endChapter: num({ min: 1, int: true }),
      status: str(),
    }),
  ],
  [IPC_CHANNELS.reviewPlanningProposal]: [
    id(),
    id(),
    oneOf(["accepted", "rejected"] as const),
  ],
  [IPC_CHANNELS.saveGlobalFindings]: [
    id(),
    arr(
      obj({
        id: str(),
        severity: oneOf(["error", "warning", "info"] as const),
        category: str(),
        message: str(),
        status: oneOf(["open", "dismissed"] as const),
      }),
    ),
  ],
  [IPC_CHANNELS.reviewGlobalConsistency]: [id()],
  [IPC_CHANNELS.reviewWholeBook]: [id(), optional(num({ min: 1, int: true }))],
  [IPC_CHANNELS.createWorkflowRun]: [
    obj({
      novelId: id(),
      mode: oneOf(workflowModes),
      config: obj({
        generationPolicy: obj({
          startChapter: num({ min: 1, int: true }),
          endChapter: num({ min: 1, int: true }),
          chapterWords: num({ min: 500, max: 20000, int: true }),
        }),
        maxPhaseRetries: num({ min: 0, int: true }),
      }),
    }),
  ],
  [IPC_CHANNELS.updateWorkflowRun]: [
    obj({
      id: id(),
      currentPhase: optional(oneOf(workflowPhases)),
      status: optional(oneOf(workflowStatuses)),
      checkpoint: optional(nullable(oneOf(workflowCheckpoints))),
      attempt: optional(num({ min: 0, int: true })),
      batchId: optional(id()),
      error: optional(str()),
    }),
  ],
  [IPC_CHANNELS.saveChapter]: [chapterText],
  [IPC_CHANNELS.createChapter]: [
    obj({ novelId: id(), targetWords: num({ min: 1, int: true }) }),
  ],
  [IPC_CHANNELS.updateChapterPlan]: [obj({ chapterId: id(), title: str(), outline: str() })],
  [IPC_CHANNELS.deleteChapter]: [id()],
  [IPC_CHANNELS.reorderChapters]: [id(), arr(id())],
  [IPC_CHANNELS.saveVolume]: [obj({ novelId: id(), title: str(), outline: str() })],
  [IPC_CHANNELS.deleteVolume]: [id()],
  [IPC_CHANNELS.reorderVolumes]: [id(), arr(id())],
  [IPC_CHANNELS.saveScene]: [
    obj({ chapterId: id(), title: str(), targetWords: num({ min: 1, int: true }) }),
  ],
  [IPC_CHANNELS.deleteScene]: [id()],
  [IPC_CHANNELS.reorderScenes]: [id(), arr(id())],
  [IPC_CHANNELS.saveContextSnapshot]: [id(), obj({})],
  [IPC_CHANNELS.saveUsage]: [
    obj({ novelId: id(), operation: str(), provider: str(), model: str() }),
  ],
  // 注意：不校验 apiKey 字段的值，只要求整体形状；密钥永不进入日志。
  [IPC_CHANNELS.saveModelProfile]: [
    obj({ name: str(), provider: str(), modelId: str(), baseUrl: str() }),
  ],
  [IPC_CHANNELS.deleteModelProfile]: [id()],
  [IPC_CHANNELS.saveStyleTemplate]: [
    obj({ name: str(), sampleText: str(), styleGuide: str() }),
  ],
  [IPC_CHANNELS.deleteStyleTemplate]: [id()],
  [IPC_CHANNELS.updateChapterCandidateContent]: [id(), str()],
  [IPC_CHANNELS.acceptChapterCandidate]: [id()],
  [IPC_CHANNELS.rejectChapterCandidate]: [id()],
  [IPC_CHANNELS.updateFinding]: [id(), str()],
  [IPC_CHANNELS.updateFactProposal]: [
    id(),
    oneOf(["accepted", "rejected"] as const),
  ],
  [IPC_CHANNELS.createChapterSnapshot]: [id()],
  [IPC_CHANNELS.saveBibleSection]: [
    obj({ novelId: id(), kind: str(), content: str() }),
  ],
  [IPC_CHANNELS.saveStoryEntity]: [
    obj({ novelId: id(), type: str(), name: str() }),
  ],
  [IPC_CHANNELS.deleteStoryEntity]: [id()],
  [IPC_CHANNELS.saveTimelineEvent]: [
    obj({ novelId: id(), title: str(), storyTime: str() }),
  ],
  [IPC_CHANNELS.deleteTimelineEvent]: [id()],
  [IPC_CHANNELS.saveForeshadowThread]: [
    obj({ novelId: id(), title: str(), status: str() }),
  ],
  [IPC_CHANNELS.deleteForeshadowThread]: [id()],
  [IPC_CHANNELS.saveCharacterState]: [
    obj({ novelId: id(), characterId: id(), chapterId: nullable(id()) }),
  ],
  [IPC_CHANNELS.deleteCharacterState]: [id()],
  [IPC_CHANNELS.createGenerationDraft]: [
    id(),
    obj({
      startChapter: num({ min: 1, int: true }),
      endChapter: num({ min: 1, int: true }),
      chapterWords: num({ min: 500, max: 20000, int: true }),
      continuityCheck: boolean(),
      maxRetries: num({ min: 0, int: true }),
      approvalMode: str(),
      outputTokenBudget: num({ min: 1, int: true }),
    }),
  ],
  [IPC_CHANNELS.setBatchStatus]: [id(), oneOf(batchStatuses), optional(obj({}))],
  [IPC_CHANNELS.deleteGenerationBatch]: [id()],
  [IPC_CHANNELS.updateGenerationJob]: [
    id(),
    oneOf(jobStatuses),
    optional(obj({})),
  ],
  [IPC_CHANNELS.startBackgroundBatch]: [id()],
  [IPC_CHANNELS.pauseBackgroundBatch]: [id()],
  // 单章生成会直接产生付费模型调用，必须校验到 profile 维度。
  [IPC_CHANNELS.generateChapter]: [obj({ profileId: id(), contextText: str() })],
  [IPC_CHANNELS.continueChapter]: [obj({ profileId: id() })],
  [IPC_CHANNELS.cancelGeneration]: [id()],
};

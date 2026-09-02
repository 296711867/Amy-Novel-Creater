/**
 * 真实 API 全自动运行评估（默认跳过，仅 AMY_E2E_REAL=1 时执行）。
 *
 * 与滚动十章 E2E 的区别：本用例不手工编排各阶段，而是驱动真实的
 * `resumeWorkflowRun`（src/application/run-workflow.ts）走完
 * “圣经 → 人物 → 场景 → 策划包 → 正文批次”的 autopilot 全流程。
 * 评估对象是 Workflow Runner 本身：
 * - 阶段推进、失败重试与断点恢复语义；
 * - 待审设定提案的 proposal_review 门禁（全自动候选也不例外）；
 * - 批次状态到运行状态的收敛（镜像 store.syncWorkflowRunFromBatch）；
 * - 全自动模式只产候选稿，不写正史。
 *
 * 驱动方式与产品同构：generateNovelPlan 镜像 src/main/ipc/novel-ipc.ts 的
 * 处理器（含 AN-004 一次低温 JSON 修复），正文生成复用 BatchRunner。
 * 所有状态落在临时 SQLite 库（仓库外），可跨次续跑。
 */
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NovelDatabase } from "../../src/main/db/database";
import type { SecretVault } from "../../src/main/security/secret-vault";
import { BatchRunner } from "../../src/main/generation/batch-runner";
import { streamOpenAICompatible } from "../../src/main/model/openai-compatible";
import {
  novelPlanningPrompt,
  planningMaxOutputTokens,
  type PlanPhase,
  type PlanRange,
} from "@domain/planning";
import { namePoolText } from "@domain/name-pool";
import { estimateTokens } from "@domain/context-pack";
import { repairPlanningContentOnce } from "@application/repair-planning-content";
import { resumeWorkflowRun } from "@application/run-workflow";
import { workflowRunUpdateFromBatch, type WorkflowRun } from "@domain/workflow-run";
import {
  applyNovelPlan,
  validateNovelPlanContent,
} from "@application/apply-novel-plan";
import { reviewPlanningProposal } from "@application/review-planning-proposal";
import { confirmPlanningStep, type PlanningBrief } from "@domain/planning-workflow";
import {
  estimateGeneration,
  type GenerationBatch,
  type GenerationPolicy,
} from "@domain/generation";

const REAL = process.env.AMY_E2E_REAL === "1";
const NOVEL_TITLE = "全自动运行评估·灯约残响";
const RANGE: PlanRange = { startChapter: 1, endChapter: 5 };
const POLICY: GenerationPolicy = {
  startChapter: RANGE.startChapter,
  endChapter: RANGE.endChapter,
  chapterWords: 800,
  continuityCheck: true,
  maxRetries: 2,
  approvalMode: "candidate",
  outputTokenBudget: 80_000,
  deepThinking: false,
};
const BRIEF: PlanningBrief = {
  audience: "喜欢东方玄幻、规则怪谈与航海冒险结合的年轻读者",
  style: "第三人称限知，节奏明快，对话口语化，每章结尾留钩子",
  boundaries: "主角不能死亡；不后宫；不洗白主要反派；灯约规则不可自相矛盾",
  sellingPoint: "以灯为货币的记忆航路：每过一盏灯都要交出一段过去",
  conflict: "守灯人旧部想重订灯约垄断航路，主角要让灯下的自由航路延续",
  protagonistGoal: "集齐五座灯塔的信物重燃母灯；失败则航路永闭、记忆散尽",
  ending: "主角重定灯约，雾海让出航道，代价是忘记母亲的面容",
};

const WORK_DIR = join(tmpdir(), "amy-e2e");
const DB_FILE = join(WORK_DIR, "workflow-autopilot.db");
const KEY_FILE = join(tmpdir(), "amy-e2e-key.txt");

const planningRunMetrics: Array<{
  phase: string;
  status: string;
  repaired: boolean;
  error: string;
  inputTokens: number;
  outputTokens: number;
}> = [];
const proposalReviewLog: string[] = [];
const driveLog: string[] = [];

function log(message: string): void {
  console.log(`[E2E ${new Date().toISOString().slice(11, 19)}] ${message}`);
}

let db: NovelDatabase;
let runner: BatchRunner;
let apiKey = "";
let novelId = "";

/** 镜像 novel-ipc 的 generateNovelPlan 处理器，含一次低温 JSON 修复。 */
async function generateNovelPlan(
  targetNovelId: string,
  phase: PlanPhase,
  range?: PlanRange,
) {
  const novel = await db.getNovel(targetNovelId);
  if (!novel) throw new Error("作品不存在");
  const profiles = await db.listModelProfiles();
  const profile = profiles.find((item) => item.isDefault) ?? profiles[0];
  if (!profile) throw new Error("请先配置默认写作模型");
  const [bible, workflow, entities, chapters, namePool] = await Promise.all([
    db.listBibleSections(targetNovelId),
    db.getPlanningWorkflow(targetNovelId),
    db.listStoryEntities(targetNovelId),
    db.listChapters(targetNovelId),
    db.getNamePool(targetNovelId, novel.genre),
  ]);
  const rollingMemory =
    phase === "structure" && range
      ? await Promise.all([
          db.listPlanningCycles(targetNovelId),
          db.listCharacterStates(targetNovelId),
          db.listTimelineEvents(targetNovelId),
          db.listForeshadowThreads(targetNovelId),
        ]).then(([cycles, characterStates, timeline, foreshadow]) => ({
          cycles,
          characterStates,
          timeline,
          foreshadow,
        }))
      : undefined;
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
  const run = await db.startPlanningRun({
    novelId: targetNovelId,
    phase,
    startChapter: range?.startChapter,
    endChapter: range?.endChapter,
    profileId: profile.id,
    provider: profile.provider,
    model: profile.modelId,
    prompt,
  });
  log(`规划 ${phase}${range ? ` ${range.startChapter}-${range.endChapter}` : ""}：prompt ${prompt.length} 字符`);
  try {
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
    );
    const inputTokens = result.inputTokens || estimateTokens(prompt);
    const outputTokens = result.outputTokens || estimateTokens(result.content);
    await db.recordPlanningResponse(run.id, {
      rawResponse: result.content,
      inputTokens,
      outputTokens,
      cachedTokens: result.cachedTokens,
    });
    await db.saveUsage({
      novelId: targetNovelId,
      chapterId: null,
      operation: "planning",
      provider: profile.provider,
      model: profile.modelId,
      inputTokens,
      outputTokens,
      cachedTokens: result.cachedTokens,
      cost: null,
      measurement: result.inputTokens || result.outputTokens ? "provider" : "estimated",
    });
    let repaired = false;
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
        repaired = true;
        log("规划 JSON 解析失败，执行一次低温结构修复");
        const fix = await streamOpenAICompatible(
          profile,
          apiKey,
          repairPrompt,
          planningMaxOutputTokens(phase),
          0.1,
          () => {},
          fetch,
          AbortSignal.timeout(300_000),
          "disabled",
        );
        await db.recordPlanningRepair(run.id, {
          repairResponse: fix.content,
          inputTokens: fix.inputTokens || estimateTokens(repairPrompt),
          outputTokens: fix.outputTokens || estimateTokens(fix.content),
          cachedTokens: fix.cachedTokens,
        });
        return fix.content;
      },
    });
    const summary = await applyNovelPlan({
      novel,
      phase,
      content: resolved.content,
      entities,
      namePool,
      range,
      store: db,
    });
    await db.completePlanningRun(run.id);
    planningRunMetrics.push({
      phase,
      status: "completed",
      repaired,
      error: "",
      inputTokens,
      outputTokens,
    });
    log(`规划完成：${JSON.stringify(summary)}${repaired ? "（经低温修复）" : ""}`);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "规划生成失败";
    await db.failPlanningRun(run.id, message);
    planningRunMetrics.push({
      phase,
      status: "failed",
      repaired: false,
      error: message,
      inputTokens: 0,
      outputTokens: 0,
    });
    throw error;
  }
}

/** 与 store.startWorkflowRun 相同的端口装配：双端 PlatformPort 的 Electron 形态。 */
function workflowPort() {
  return {
    host: "electron" as const,
    generateNovelPlan,
    listPlanningProposals: (id: string) => db.listPlanningProposals(id),
    listPlanningCycles: (id: string) => db.listPlanningCycles(id),
    savePlanningCycle: db.savePlanningCycle.bind(db),
    getPlanningWorkflow: (id: string) => db.getPlanningWorkflow(id),
    savePlanningWorkflow: (workflow: Parameters<typeof db.savePlanningWorkflow>[0]) =>
      db.savePlanningWorkflow(workflow),
    async createGenerationDraft(id: string, policy: GenerationPolicy) {
      const batch = await db.createGenerationBatch(id, policy);
      return { id: batch.id, estimate: estimateGeneration(policy) };
    },
    listGenerationBatches: () => db.listGenerationBatches(),
    startBackgroundBatch: async (batchId: string) => {
      runner.start(batchId);
    },
    createWorkflowRun: db.createWorkflowRun.bind(db),
    updateWorkflowRun: db.updateWorkflowRun.bind(db),
    listWorkflowRuns: db.listWorkflowRuns.bind(db),
  };
}

/** 作者代理：接受当前范围与全局合并的待审设定提案，镜像 store.reviewPlanningProposal。 */
async function acceptPendingProposals() {
  const proposals = (await db.listPlanningProposals(novelId)).filter(
    (item) =>
      item.status === "pending" &&
      (item.cycleId === "entity-merge" ||
        (item.startChapter === RANGE.startChapter &&
          item.endChapter === RANGE.endChapter)),
  );
  for (const proposal of proposals) {
    try {
      await reviewPlanningProposal(db, novelId, proposal.id, "accepted");
      proposalReviewLog.push(`accepted ${proposal.action} ${proposal.targetName}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.updatePlanningProposalStatus(proposal.id, "rejected");
      proposalReviewLog.push(
        `rejected ${proposal.action} ${proposal.targetName}｜${message.slice(0, 120)}`,
      );
    }
  }
  log(`提案审核 ${proposalReviewLog.length} 项（本轮 ${proposals.length} 项）`);
}

async function waitBatchSettled(
  batchId: string,
  timeoutMs: number,
): Promise<GenerationBatch> {
  const started = Date.now();
  let lastLog = 0;
  for (;;) {
    const batch = await db.getGenerationBatch(batchId);
    if (!batch) throw new Error("批次不存在");
    if (["completed", "failed", "paused", "cancelled"].includes(batch.status))
      return batch;
    if (Date.now() - started > timeoutMs) throw new Error("批次执行超时");
    if (Date.now() - lastLog > 30_000) {
      const jobs = await db.listGenerationJobs(batchId);
      const counts = jobs.reduce((acc: Record<string, number>, item) => {
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
      }, {});
      log(`批次进行中：${JSON.stringify(counts)}，输出 ${batch.outputTokensUsed} tokens`);
      lastLog = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}

/**
 * 作者代理：批次创建被数据层门禁拒绝时，镜像向导的人工恢复——
 * 重新生成当前范围策划包、处理提案、把周期置 ready，再让运行重试。
 */
async function authorRecoveryAfterGateFailure(message: string) {
  log(`运行在批次创建门禁失败，执行作者恢复：${message.slice(0, 160)}`);
  await generateNovelPlan(novelId, "structure", RANGE);
  await acceptPendingProposals();
  const cycles = await db.listPlanningCycles(novelId);
  const cycle = cycles.find(
    (item) =>
      !["completed", "superseded"].includes(item.status) &&
      item.startChapter === RANGE.startChapter,
  );
  if (cycle && cycle.status === "plan_review")
    await db.savePlanningCycle({ ...cycle, status: "ready" });
  const workflow = await db.getPlanningWorkflow(novelId);
  await db.savePlanningWorkflow(confirmPlanningStep(workflow, 9));
}

/**
 * 驱动真实 Runner 直到终态。每轮 = 一次 resumeWorkflowRun + 一次作者动作：
 * - proposal_review：作者处理提案后继续；
 * - failed（批次创建门禁）：作者重规划后重试（最多 2 次）；
 * - running + batchId：等待后台批次停点，按事件语义收敛（镜像 store.syncWorkflowRunFromBatch）。
 */
async function driveRun(source: WorkflowRun, maxRounds = 20): Promise<WorkflowRun> {
  let run = source;
  let recoveries = 0;
  for (let round = 1; round <= maxRounds; round++) {
    run = await resumeWorkflowRun(workflowPort(), { ...run });
    driveLog.push(
      `round ${round}: ${run.status}${run.checkpoint ? `/${run.checkpoint}` : ""} phase=${run.currentPhase} attempt=${run.attempt}${run.error ? ` error=${run.error.slice(0, 80)}` : ""}`,
    );
    log(`第 ${round} 轮：${run.status}${run.checkpoint ? `（${run.checkpoint}）` : ""}，阶段 ${run.currentPhase}`);
    if (run.status === "completed") return run;
    if (run.status === "failed") {
      const gateFailure =
        run.currentPhase === "generation" &&
        (run.error.includes("向导") ||
          run.error.includes("策划包") ||
          run.error.includes("一致性"));
      if (gateFailure && recoveries < 2) {
        recoveries++;
        await authorRecoveryAfterGateFailure(run.error);
        continue;
      }
      return run;
    }
    if (run.checkpoint === "proposal_review") {
      await acceptPendingProposals();
      continue;
    }
    if (run.checkpoint === "chapter_review") {
      // autopilot 关闭了单章审批，不应停在这里；防御性失败便于发现语义漂移。
      throw new Error(`全自动模式不应停在章节审核：${run.error}`);
    }
    if (run.status === "running" && run.batchId) {
      const batch = await waitBatchSettled(run.batchId, 3_600_000);
      const update = workflowRunUpdateFromBatch(batch);
      if (update) {
        run = await db.updateWorkflowRun({ id: run.id, ...update });
        log(`批次 ${batch.status}，运行收敛为 ${run.status}`);
        if (run.status === "completed" || run.status === "failed") return run;
      }
      continue;
    }
    throw new Error(`运行停留在未预期的状态：${run.status}/${run.checkpoint}`);
  }
  throw new Error("驱动轮次耗尽，运行未到达终态");
}

describe.skipIf(!REAL)("真实 API：Workflow Runner 全自动运行（autopilot 1-5 章）", () => {
  beforeAll(async () => {
    mkdirSync(WORK_DIR, { recursive: true });
    apiKey = readFileSync(KEY_FILE, "utf8").trim();
    if (!apiKey) throw new Error(`缺少密钥文件 ${KEY_FILE}`);
    db = await NovelDatabase.open(`/${DB_FILE.replaceAll("\\", "/")}`);
    runner = new BatchRunner(db, {
      get: async () => apiKey,
    } as unknown as SecretVault);
    const existing = (await db.listNovels()).find(
      (item) => item.title === NOVEL_TITLE,
    );
    if (existing) {
      novelId = existing.id;
    } else {
      const created = await db.createNovel({
        title: NOVEL_TITLE,
        genre: "玄幻",
        premise:
          "雾海把大陆割成孤岛，灯船以记忆为灯油沿航路穿雾。少年沈灯继承母亲的守灯残约，" +
          "发现每点亮一座灯塔就要交出一段过去。守灯人旧部想重订灯约垄断航路，" +
          "沈灯要在五座灯塔重燃母灯，让自由航路延续下去。",
        targetChapters: 10,
        chapterWords: 800,
        cycleSize: 5,
      });
      novelId = created.novel.id;
    }
    const profiles = await db.listModelProfiles();
    if (!profiles.length)
      await db.saveModelProfile(
        {
          name: "智谱 GLM（Coding Plan）",
          provider: "glm",
          modelId: "GLM-5.2",
          baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
          contextWindow: 128000,
          inputPricePerMillion: null,
          outputPricePerMillion: null,
          isDefault: true,
        },
        true,
      );
    // 作者在向导前两步亲自完成的输入：简报 + 步骤 1、2 确认（autopilot 不代签这两步的内容）。
    const workflow = await db.getPlanningWorkflow(novelId);
    if (!workflow.confirmedSteps.includes(2)) {
      await db.savePlanningWorkflow({
        ...workflow,
        brief: BRIEF,
        confirmedSteps: [1, 2],
        updatedAt: new Date().toISOString(),
      });
    }
    log(`novel=${novelId} db=${DB_FILE}`);
  }, 60_000);

  afterAll(() => {
    if (db) db.close();
  });

  it(
    "驱动 resumeWorkflowRun 走完 autopilot 全流程",
    { timeout: 3_600_000 },
    async () => {
      let run = (await db.listWorkflowRuns(novelId))[0];
      if (run?.status === "completed") return log("已有完成的运行，跳过驱动");
      if (!run)
        run = await db.createWorkflowRun({
          novelId,
          mode: "autopilot",
          config: { generationPolicy: POLICY, maxPhaseRetries: 2 },
        });
      const final = await driveRun(run);
      expect(final.status).toBe("completed");
    },
  );

  it(
    "评估汇总：三档门禁语义、候选不入正史、预算与留痕",
    { timeout: 120_000 },
    async () => {
      const run = (await db.listWorkflowRuns(novelId))[0];
      expect(run).toMatchObject({ mode: "autopilot", status: "completed" });
      expect(run.batchId).toBeTruthy();

      const batch = await db.getGenerationBatch(run.batchId!);
      if (!batch) throw new Error("batch missing");
      expect(batch.status).toBe("completed");
      const jobs = (await db.listGenerationJobs(batch.id)).sort(
        (a, b) => a.position - b.position,
      );
      expect(jobs).toHaveLength(RANGE.endChapter - RANGE.startChapter + 1);
      expect(jobs.every((item) => item.status === "candidate_ready")).toBe(true);
      expect(jobs.every((item) => item.candidateId)).toBe(true);

      // 全自动候选：候选稿齐备但全部待审，正史未被写入，事实提案停在待处理。
      const chapters = await db.listChapters(novelId);
      const candidateRows = [] as Array<{ position: number; words: number; facts: number }>;
      for (const job of jobs) {
        const candidate = await db.getChapterCandidate(job.candidateId!);
        expect(candidate?.status).toBe("candidate");
        const chapter = chapters.find((item) => item.id === candidate!.chapterId)!;
        expect(chapter.status).not.toBe("accepted");
        const facts = await db.listFactProposals(candidate!.id);
        candidateRows.push({
          position: chapter.position,
          words: candidate!.wordCount,
          facts: facts.filter((item) => item.status === "proposed").length,
        });
      }
      // 候选链：后章在前章未接受时生成，任务按位置单调排列即串行执行的证据。
      expect(
        jobs.every((item, index) => item.position === index + RANGE.startChapter),
      ).toBe(true);

      // 规划留痕：四个阶段全部完成，原始响应在库；记录修复次数。
      const planRuns = await db.listPlanningRuns(novelId);
      const phases = new Set(planRuns.filter((item) => item.status === "completed").map((item) => item.phase));
      for (const phase of ["bible", "cast", "scenes", "structure"] as PlanPhase[])
        expect(phases.has(phase)).toBe(true);
      expect(planRuns.every((item) => item.rawResponse.length > 0)).toBe(true);

      // 代签确认：非 checkpoint 模式在提案清零后代签九步（数据层门禁被合法满足）。
      const workflow = await db.getPlanningWorkflow(novelId);
      expect(workflow.confirmedSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

      // 预算硬约束与用量留痕。
      expect(batch.outputTokensUsed).toBeLessThanOrEqual(POLICY.outputTokenBudget);
      const usage = await db.listUsage(novelId);
      const totalInput = usage.reduce((acc, item) => acc + item.inputTokens, 0);
      const totalOutput = usage.reduce((acc, item) => acc + item.outputTokens, 0);
      const events = await db.listGenerationEvents(batch.id);
      expect(events.length).toBeGreaterThan(0);

      const summary = {
        run: {
          id: run.id,
          mode: run.mode,
          rounds: driveLog.length,
          transcript: driveLog,
        },
        proposals: proposalReviewLog,
        planningRuns: planningRunMetrics,
        candidates: candidateRows,
        batch: {
          status: batch.status,
          outputTokensUsed: batch.outputTokensUsed,
          budget: POLICY.outputTokenBudget,
          events: events.length,
        },
        usage: { totalInput, totalOutput },
      };
      console.log(JSON.stringify(summary, null, 2));
      log(
        `候选 ${candidateRows.length} 章全部待审、正史未写入；` +
          `规划 ${planningRunMetrics.length} 次（修复 ${planningRunMetrics.filter((item) => item.repaired).length} 次）；` +
          `提案 ${proposalReviewLog.length} 项；累计输入 ${totalInput} / 输出 ${totalOutput} tokens`,
      );
    },
  );
});

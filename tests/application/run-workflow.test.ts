import { describe, expect, it } from "vitest";
import { resumeWorkflowRun } from "@application/run-workflow";
import type {
  WorkflowMode,
  WorkflowRun,
  WorkflowRunConfig,
} from "@domain/workflow-run";
import type { PlanningProposal } from "@domain/planning-proposal";
import type { PlanningCycle } from "@domain/planning-cycle";
import type { PlanningWorkflow } from "@domain/planning-workflow";
import { EMPTY_PLANNING_BRIEF } from "@domain/planning-workflow";
import type { PlanPhase, PlanRange } from "@domain/planning";
import type {
  BatchStatus,
  GenerationBatch,
  GenerationPolicy,
} from "@domain/generation";

type WorkflowPort = Parameters<typeof resumeWorkflowRun>[0];

interface FakeOptions {
  host?: "electron" | "web";
  mode?: WorkflowMode;
  maxPhaseRetries?: number;
  draftError?: Error;
  batch?: { id: string; status: BatchStatus; awaitingReview?: boolean };
  /** 每次规划调用弹出一项：Error 表示该次调用抛出，缺省表示成功。 */
  planScript?: Array<Error | undefined>;
}

function basePolicy(): GenerationPolicy {
  return {
    startChapter: 1,
    endChapter: 10,
    chapterWords: 3000,
    continuityCheck: true,
    maxRetries: 2,
    approvalMode: "candidate",
    outputTokenBudget: 60000,
  };
}

function pendingProposal(): PlanningProposal {
  return {
    id: "proposal-1",
    novelId: "novel-1",
    cycleId: "cycle-1",
    startChapter: 1,
    endChapter: 10,
    action: "add",
    targetType: "location",
    targetName: "旧城区钟楼",
    patch: { aliases: [] } as PlanningProposal["patch"],
    reason: "第 3 章章纲引用了未登记地点",
    status: "pending",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}

function readyCycle(status: PlanningCycle["status"] = "plan_review"): PlanningCycle {
  return {
    id: "cycle-1",
    novelId: "novel-1",
    startChapter: 1,
    endChapter: 10,
    status,
    expectedClosingState: "",
    actualClosingState: "",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  } as PlanningCycle;
}

function createPort(options: FakeOptions = {}) {
  const config: WorkflowRunConfig = {
    generationPolicy: basePolicy(),
    maxPhaseRetries: options.maxPhaseRetries ?? 2,
  };
  const state = {
    run: {
      id: "run-1",
      novelId: "novel-1",
      mode: options.mode ?? "checkpoint",
      currentPhase: "bible",
      status: "paused",
      checkpoint: null,
      config,
      attempt: 0,
      batchId: options.batch?.id ?? null,
      error: "",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    } as WorkflowRun,
    workflow: {
      novelId: "novel-1",
      scopeAdvice: null,
      brief: EMPTY_PLANNING_BRIEF,
      confirmedSteps: [],
      updatedAt: "2026-08-31T00:00:00.000Z",
    } as PlanningWorkflow,
    proposals: [] as PlanningProposal[],
    cycles: [] as PlanningCycle[],
    planCalls: [] as Array<{ phase: PlanPhase; range?: PlanRange }>,
    planScript: [...(options.planScript ?? [])],
    drafts: [] as GenerationPolicy[],
    started: [] as string[],
    savedCycles: [] as PlanningCycle[],
    draftError: options.draftError,
    batches: [] as GenerationBatch[],
    /** 模拟 startBackgroundBatch 后宿主侧的批次状态变化。 */
    onStart(_batchId: string): void {}
  };
  if (options.batch)
    state.batches.push({
      id: options.batch.id,
      novelId: "novel-1",
      status: options.batch.status,
      policy: config.generationPolicy,
      outputTokensUsed: 0,
      awaitingReview: options.batch.awaitingReview ?? false,
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    });
  const port: WorkflowPort = {
    host: options.host ?? "electron",
    async generateNovelPlan(_novelId, phase, range) {
      state.planCalls.push({ phase, range });
      const step = state.planScript.length
        ? state.planScript.shift()
        : undefined;
      if (step instanceof Error) throw step;
      return {} as never;
    },
    async listPlanningProposals() {
      return [...state.proposals];
    },
    async listPlanningCycles() {
      return [...state.cycles];
    },
    async savePlanningCycle(input) {
      const saved = input as PlanningCycle;
      state.savedCycles.push(saved);
      return saved;
    },
    async getPlanningWorkflow() {
      return state.workflow;
    },
    async savePlanningWorkflow(input) {
      state.workflow = input;
      return input;
    },
    async createGenerationDraft(novelId, policy) {
      if (state.draftError) throw state.draftError;
      state.drafts.push(policy);
      const id = "batch-1";
      state.batches.push({
        id,
        novelId,
        status: "queued",
        policy,
        outputTokensUsed: 0,
        awaitingReview: false,
        createdAt: "2026-08-31T00:00:00.000Z",
        updatedAt: "2026-08-31T00:00:00.000Z",
      });
      return { id, estimate: {} as never };
    },
    async listGenerationBatches() {
      return [...state.batches];
    },
    async startBackgroundBatch(batchId) {
      state.started.push(batchId);
      state.onStart(batchId);
    },
    async createWorkflowRun() {
      throw new Error("测试直接构造 run，不需要 createWorkflowRun");
    },
    async updateWorkflowRun(input) {
      state.run = {
        ...state.run,
        ...input,
        updatedAt: "2026-08-31T00:01:00.000Z",
      };
      return { ...state.run };
    },
  };
  return { port, state };
}

describe("resumeWorkflowRun", () => {
  it("checkpoint 模式逐阶段暂停，全部确认后按单章审批生成正文", async () => {
    const { port, state } = createPort({ mode: "checkpoint" });
    const phases: Array<{ phase: WorkflowRun["currentPhase"]; next: string }> = [
      { phase: "bible", next: "cast" },
      { phase: "cast", next: "scenes" },
      { phase: "scenes", next: "structure" },
      { phase: "structure", next: "generation" },
    ];
    for (const item of phases) {
      const paused = await resumeWorkflowRun(port, { ...state.run });
      expect(paused.status).toBe("paused");
      expect(paused.checkpoint).toBe("phase_review");
      expect(paused.currentPhase).toBe(item.next);
      expect(state.planCalls.at(-1)?.phase).toBe(item.phase);
    }
    // 结构规划阶段传入当前批次范围。
    expect(state.planCalls.at(-1)?.range).toEqual({
      startChapter: 1,
      endChapter: 10,
    });

    // checkpoint 模式不代签向导确认，也不要求已有策划周期。
    state.draftError = new Error("第 9 步一致性检查尚未确认，拒绝创建批次");
    const gated = await resumeWorkflowRun(port, { ...state.run });
    expect(gated.status).toBe("paused");
    expect(gated.checkpoint).toBe("phase_review");
    expect(gated.error).toContain("第 9 步");

    state.draftError = undefined;
    const running = await resumeWorkflowRun(port, { ...state.run });
    expect(running.status).toBe("running");
    expect(running.batchId).toBe("batch-1");
    // 关键节点暂停模式沿用单章审批门禁。
    expect(state.drafts[0]?.approvalGate).toBe(true);
    expect(state.workflow.confirmedSteps).toEqual([]);
  });

  it("autopilot 模式连续完成规划，代签九步确认并以连续候选模式建批次", async () => {
    const { port, state } = createPort({ mode: "autopilot" });
    state.cycles.push(readyCycle("plan_review"));
    const running = await resumeWorkflowRun(port, { ...state.run });

    expect(state.planCalls.map((item) => item.phase)).toEqual([
      "bible",
      "cast",
      "scenes",
      "structure",
    ]);
    // plan_review 周期被推进为 ready。
    expect(state.savedCycles[0]?.status).toBe("ready");
    // 非交互模式在提案处理完毕后代签向导确认，满足数据层门禁。
    expect(state.workflow.confirmedSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(running.status).toBe("running");
    expect(running.currentPhase).toBe("generation");
    // 全自动候选：关闭单章审批，连续生成候选稿但不写正史。
    expect(state.drafts[0]?.approvalGate).toBe(false);
    expect(state.started).toEqual(["batch-1"]);
  });

  it("存在待审提案时任何模式都暂停在提案审核，处理后才能建批次", async () => {
    const { port, state } = createPort({ mode: "autopilot" });
    state.cycles.push(readyCycle("ready"));
    state.proposals.push(pendingProposal());

    const paused = await resumeWorkflowRun(port, { ...state.run });
    expect(paused.status).toBe("paused");
    expect(paused.checkpoint).toBe("proposal_review");
    expect(paused.error).toContain("1 条设定提案");
    expect(state.drafts).toHaveLength(0);

    state.proposals[0].status = "accepted";
    const running = await resumeWorkflowRun(port, { ...state.run });
    expect(running.status).toBe("running");
    expect(running.batchId).toBe("batch-1");
  });

  it("阶段失败按重试预算重试，耗尽后标记失败并保留错误", async () => {
    const { port, state } = createPort({
      mode: "autopilot",
      maxPhaseRetries: 1,
      planScript: [
        new Error("规划 JSON 两次解析失败"),
        new Error("规划 JSON 两次解析失败"),
      ],
    });
    state.cycles.push(readyCycle("ready"));

    const failed = await resumeWorkflowRun(port, { ...state.run });
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("规划 JSON");
    expect(failed.currentPhase).toBe("bible");
    // 初始一次 + 一次重试，不会无限重试。
    expect(state.planCalls).toHaveLength(2);
    expect(state.drafts).toHaveLength(0);
  });

  it("失败后恢复会重置重试预算并继续推进", async () => {
    const { port, state } = createPort({
      mode: "autopilot",
      maxPhaseRetries: 1,
      planScript: [
        new Error("模型 401 未授权"),
        new Error("模型 401 未授权"),
      ],
    });
    state.cycles.push(readyCycle("ready"));
    const failed = await resumeWorkflowRun(port, { ...state.run });
    expect(failed.status).toBe("failed");
    expect(failed.attempt).toBe(1);
    expect(failed.error).toContain("401");

    // 作者修正配置后恢复：attempt 归零，阶段重新执行并成功推进到正文。
    const running = await resumeWorkflowRun(port, { ...state.run });
    expect(running.status).toBe("running");
    expect(running.attempt).toBe(0);
    expect(state.planCalls.map((item) => item.phase)).toEqual([
      "bible",
      "bible",
      "bible",
      "cast",
      "scenes",
      "structure",
    ]);
  });

  it("批次已完成时直接收敛为完成，不重复拉起批次", async () => {
    const { port, state } = createPort({
      mode: "chapter",
      batch: { id: "batch-9", status: "completed" },
    });
    state.run.currentPhase = "generation";
    const completed = await resumeWorkflowRun(port, { ...state.run });
    expect(completed.status).toBe("completed");
    expect(completed.checkpoint).toBeNull();
    expect(state.started).toHaveLength(0);
    expect(state.drafts).toHaveLength(0);
  });

  it("Web 端批次暂停等待审核立即收敛为章节审核，Electron 端等待批次事件", async () => {
    const web = createPort({
      host: "web",
      mode: "chapter",
      batch: { id: "batch-1", status: "paused", awaitingReview: true },
    });
    web.state.run.currentPhase = "generation";
    web.state.onStart = () => {
      // Web 端批次在恢复调用内同步跑完，最终停在等待审核。
      web.state.batches[0] = {
        ...web.state.batches[0],
        status: "paused",
        awaitingReview: true,
      };
    };
    const webRun = await resumeWorkflowRun(web.port, { ...web.state.run });
    expect(webRun.status).toBe("paused");
    expect(webRun.checkpoint).toBe("chapter_review");

    const electron = createPort({
      host: "electron",
      mode: "chapter",
      batch: { id: "batch-1", status: "paused", awaitingReview: true },
    });
    electron.state.run.currentPhase = "generation";
    // Electron 端 startBackgroundBatch 即发即忘，批次在主进程后台续跑；
    // 立即回读到的 paused 是旧值，运行保持 running，交给批次事件收敛。
    const electronRun = await resumeWorkflowRun(electron.port, {
      ...electron.state.run,
    });
    expect(electronRun.status).toBe("running");
    expect(electronRun.checkpoint).toBeNull();
    expect(electron.state.started).toEqual(["batch-1"]);
  });
});

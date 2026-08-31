import type { PlatformPort } from "./ports/platform-port";
import {
  nextWorkflowPhase,
  workflowRunUpdateFromBatch,
  type WorkflowRun,
} from "@domain/workflow-run";

type WorkflowPort = Pick<
  PlatformPort,
  | "host"
  | "generateNovelPlan"
  | "listPlanningProposals"
  | "listPlanningCycles"
  | "savePlanningCycle"
  | "getPlanningWorkflow"
  | "savePlanningWorkflow"
  | "createGenerationDraft"
  | "listGenerationBatches"
  | "startBackgroundBatch"
  | "createWorkflowRun"
  | "updateWorkflowRun"
>;

export async function resumeWorkflowRun(
  port: WorkflowPort,
  source: WorkflowRun,
): Promise<WorkflowRun> {
  // 从失败恢复意味着作者决定再试一次：重试预算随之重置。
  let run = await port.updateWorkflowRun({
    id: source.id,
    status: "running",
    checkpoint: null,
    ...(source.status === "failed" ? { attempt: 0 } : {}),
    error: "",
  });
  // 曾在规划检查点（阶段/提案审核）暂停的运行恢复时必须重新走
  // prepareGeneration：提案可能新增，代签确认也可能尚未执行。
  if (run.currentPhase === "generation" && !source.checkpoint)
    return resumeGeneration(port, run);

  while (run.currentPhase !== "generation") {
    const phase = run.currentPhase,
      result = await runPlanningPhase(port, run);
    if (result.status === "failed") return result;
    run = result;
    if (run.mode === "checkpoint")
      return port.updateWorkflowRun({
        id: run.id,
        status: "paused",
        checkpoint: "phase_review",
      });
    if (phase === "structure") break;
  }
  return prepareGeneration(port, run);
}

async function runPlanningPhase(
  port: WorkflowPort,
  source: WorkflowRun,
): Promise<WorkflowRun> {
  if (source.currentPhase === "generation") return source;
  const phase = source.currentPhase,
    range = phase === "structure"
      ? {
          startChapter: source.config.generationPolicy.startChapter,
          endChapter: source.config.generationPolicy.endChapter,
        }
      : undefined;
  let run = source;
  for (let attempt = source.attempt; attempt <= source.config.maxPhaseRetries; attempt++) {
    run = await port.updateWorkflowRun({ id: run.id, attempt, error: "" });
    try {
      await port.generateNovelPlan(run.novelId, phase, range);
      return port.updateWorkflowRun({
        id: run.id,
        currentPhase: nextWorkflowPhase(phase),
        attempt: 0,
        error: "",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "工作流阶段失败";
      if (attempt >= source.config.maxPhaseRetries)
        return port.updateWorkflowRun({
          id: run.id,
          status: "failed",
          attempt,
          error: message,
        });
      run = await port.updateWorkflowRun({
        id: run.id,
        attempt: attempt + 1,
        error: message,
      });
    }
  }
  return run;
}

async function prepareGeneration(
  port: WorkflowPort,
  run: WorkflowRun,
): Promise<WorkflowRun> {
  const policy = run.config.generationPolicy,
    proposals = await port.listPlanningProposals(run.novelId),
    pending = proposals.filter(
      (item) =>
        item.status === "pending" &&
        (item.cycleId === "entity-merge" ||
          (item.startChapter === policy.startChapter &&
            item.endChapter === policy.endChapter)),
    );
  if (pending.length)
    return port.updateWorkflowRun({
      id: run.id,
      status: "paused",
      checkpoint: "proposal_review",
      error: `仍有 ${pending.length} 条设定提案等待作者处理`,
    });

  if (run.mode !== "checkpoint") {
    const cycle = (await port.listPlanningCycles(run.novelId)).find(
      (item) =>
        policy.startChapter >= item.startChapter &&
        policy.endChapter <= item.endChapter &&
        ["plan_review", "ready", "generating"].includes(item.status),
    );
    if (!cycle)
      return port.updateWorkflowRun({
        id: run.id,
        status: "failed",
        error: "当前范围没有可用策划周期",
      });
    if (cycle.status === "plan_review")
      await port.savePlanningCycle({ ...cycle, status: "ready" });
    const workflow = await port.getPlanningWorkflow(run.novelId);
    await port.savePlanningWorkflow({
      ...workflow,
      confirmedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      updatedAt: new Date().toISOString(),
    });
  }
  return resumeGeneration(port, {
    ...run,
    currentPhase: "generation",
  });
}

async function resumeGeneration(
  port: WorkflowPort,
  source: WorkflowRun,
): Promise<WorkflowRun> {
  let run = source;
  if (!run.batchId) {
    try {
      const created = await port.createGenerationDraft(run.novelId, {
        ...run.config.generationPolicy,
        approvalGate: run.mode !== "autopilot",
      });
      run = await port.updateWorkflowRun({
        id: run.id,
        currentPhase: "generation",
        batchId: created.id,
        attempt: 0,
        error: "",
      });
    } catch (error) {
      return port.updateWorkflowRun({
        id: run.id,
        status: run.mode === "checkpoint" ? "paused" : "failed",
        checkpoint: run.mode === "checkpoint" ? "phase_review" : null,
        error: error instanceof Error ? error.message : "创建正文批次失败",
      });
    }
  }
  const batch = (await port.listGenerationBatches()).find(
    (item) => item.id === run.batchId,
  );
  if (!batch)
    return port.updateWorkflowRun({
      id: run.id,
      status: "failed",
      error: "正文批次不存在",
    });
  // 已终态的批次无需再拉起；暂停中的批次由作者处理后通过恢复继续。
  const before = workflowRunUpdateFromBatch(batch);
  if (before && before.status !== "paused")
    return port.updateWorkflowRun({ id: run.id, ...before });
  await port.startBackgroundBatch(batch.id);
  const latest = (await port.listGenerationBatches()).find(
    (item) => item.id === batch.id,
  );
  const settled = latest ? workflowRunUpdateFromBatch(latest) : null;
  // Web 端批次在恢复调用内同步跑完，状态已是终值；Electron 端批次后台
  // 执行，刚启动时的 paused 读数是旧值，只有终态可以立即收敛，暂停状态
  // 交给批次事件驱动收敛，避免运行被误标为等待审核。
  const settledNow =
    port.host === "web" || settled?.status !== "paused" ? settled : null;
  return port.updateWorkflowRun({
    id: run.id,
    ...(settledNow ?? {
      status: "running" as const,
      checkpoint: null,
      error: "",
    }),
  });
}

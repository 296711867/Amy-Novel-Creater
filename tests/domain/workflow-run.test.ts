import { describe, expect, it } from "vitest";
import {
  nextWorkflowPhase,
  previousWorkflowPhase,
  workflowRunUpdateFromBatch,
  WORKFLOW_CHECKPOINT_LABELS,
  WORKFLOW_MODE_LABELS,
  WORKFLOW_PHASE_LABELS,
  WORKFLOW_STATUS_LABELS,
  type WorkflowCheckpoint,
  type WorkflowMode,
  type WorkflowPhase,
  type WorkflowRunStatus,
} from "@domain/workflow-run";

const PHASES: WorkflowPhase[] = ["bible", "cast", "scenes", "structure"];

describe("workflow run domain", () => {
  it("阶段推进与回退互为逆函数，终点稳定在 generation", () => {
    for (const phase of PHASES) {
      expect(previousWorkflowPhase(nextWorkflowPhase(phase))).toBe(phase);
    }
    expect(nextWorkflowPhase("generation")).toBe("generation");
    expect(previousWorkflowPhase("bible")).toBe("structure");
  });

  it("标签覆盖全部枚举取值", () => {
    const phases = Object.keys(WORKFLOW_PHASE_LABELS);
    for (const phase of PHASES) expect(phases).toContain(phase);
    expect(Object.keys(WORKFLOW_MODE_LABELS)).toEqual(
      expect.arrayContaining(["checkpoint", "chapter", "autopilot"] as WorkflowMode[]),
    );
    expect(Object.keys(WORKFLOW_STATUS_LABELS)).toEqual(
      expect.arrayContaining([
        "running",
        "paused",
        "failed",
        "completed",
      ] as WorkflowRunStatus[]),
    );
    expect(Object.keys(WORKFLOW_CHECKPOINT_LABELS)).toEqual(
      expect.arrayContaining([
        "phase_review",
        "proposal_review",
        "chapter_review",
      ] as Exclude<WorkflowCheckpoint, null>[]),
    );
  });

  it("批次完成/失败/取消收敛为运行终态", () => {
    expect(workflowRunUpdateFromBatch({ status: "completed", awaitingReview: false }))
      .toEqual({ status: "completed", checkpoint: null, error: "" });
    expect(workflowRunUpdateFromBatch({ status: "failed", awaitingReview: false }))
      .toEqual({ status: "failed", checkpoint: null, error: "正文批次执行失败" });
    expect(workflowRunUpdateFromBatch({ status: "cancelled", awaitingReview: false }))
      .toEqual({ status: "failed", checkpoint: null, error: "正文批次执行失败" });
  });

  it("批次暂停按等待审核与否区分检查点", () => {
    expect(
      workflowRunUpdateFromBatch({ status: "paused", awaitingReview: true }),
    ).toEqual({ status: "paused", checkpoint: "chapter_review", error: "" });
    const budget = workflowRunUpdateFromBatch({
      status: "paused",
      awaitingReview: false,
    });
    expect(budget?.status).toBe("paused");
    expect(budget?.checkpoint).toBeNull();
    expect(budget?.error).toContain("暂停");
  });

  it("进行中的批次返回 null，运行保持 running", () => {
    expect(
      workflowRunUpdateFromBatch({ status: "running", awaitingReview: false }),
    ).toBeNull();
    expect(
      workflowRunUpdateFromBatch({ status: "queued", awaitingReview: false }),
    ).toBeNull();
    expect(
      workflowRunUpdateFromBatch({ status: "draft", awaitingReview: false }),
    ).toBeNull();
  });
});

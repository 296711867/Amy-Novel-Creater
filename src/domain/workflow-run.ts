import type { GenerationPolicy } from "./generation";

export type WorkflowMode = "autopilot" | "checkpoint" | "chapter";
export type WorkflowPhase =
  | "bible"
  | "cast"
  | "scenes"
  | "structure"
  | "generation";
export type WorkflowRunStatus = "running" | "paused" | "failed" | "completed";
export type WorkflowCheckpoint =
  | "phase_review"
  | "proposal_review"
  | "chapter_review"
  | null;

export interface WorkflowRunConfig {
  generationPolicy: GenerationPolicy;
  maxPhaseRetries: number;
}

export interface WorkflowRun {
  id: string;
  novelId: string;
  mode: WorkflowMode;
  currentPhase: WorkflowPhase;
  status: WorkflowRunStatus;
  checkpoint: WorkflowCheckpoint;
  config: WorkflowRunConfig;
  attempt: number;
  batchId: string | null;
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateWorkflowRunInput {
  novelId: string;
  mode: WorkflowMode;
  config: WorkflowRunConfig;
}

export type UpdateWorkflowRunInput = Pick<WorkflowRun, "id"> &
  Partial<
    Pick<
      WorkflowRun,
      | "currentPhase"
      | "status"
      | "checkpoint"
      | "attempt"
      | "batchId"
      | "error"
    >
  >;

export const WORKFLOW_PHASE_LABELS: Record<WorkflowPhase, string> = {
  bible: "故事圣经",
  cast: "人物体系",
  scenes: "场景与实体",
  structure: "当前批次策划",
  generation: "正文候选生成",
};

export const WORKFLOW_MODE_LABELS: Record<WorkflowMode, string> = {
  checkpoint: "关键节点暂停",
  chapter: "每章暂停",
  autopilot: "全自动候选",
};

export const WORKFLOW_STATUS_LABELS: Record<WorkflowRunStatus, string> = {
  running: "运行中",
  paused: "等待作者",
  failed: "已失败",
  completed: "已完成",
};

export const WORKFLOW_CHECKPOINT_LABELS: Record<
  Exclude<WorkflowCheckpoint, null>,
  string
> = {
  phase_review: "规划阶段审核",
  proposal_review: "设定提案审核",
  chapter_review: "章节候选审核",
};

export function nextWorkflowPhase(phase: WorkflowPhase): WorkflowPhase {
  if (phase === "bible") return "cast";
  if (phase === "cast") return "scenes";
  if (phase === "scenes") return "structure";
  return "generation";
}

/** 阶段审核暂停发生在阶段推进之后：currentPhase 的上一个阶段才是待审核内容。 */
export function previousWorkflowPhase(phase: WorkflowPhase): WorkflowPhase {
  if (phase === "cast") return "bible";
  if (phase === "scenes") return "cast";
  if (phase === "structure") return "scenes";
  return "structure";
}

/**
 * 批次状态到运行状态的收敛规则。正文批次在宿主侧后台执行（Electron）或
 * 同步执行（Web），运行状态最终都按同一映射从批次反推；返回 null 表示
 * 批次仍在进行，运行保持 running 不变。
 */
export function workflowRunUpdateFromBatch(batch: {
  status: string;
  awaitingReview: boolean;
}):
  | Pick<UpdateWorkflowRunInput, "status" | "checkpoint" | "error">
  | null {
  if (batch.status === "completed")
    return { status: "completed", checkpoint: null, error: "" };
  if (batch.status === "failed" || batch.status === "cancelled")
    return { status: "failed", checkpoint: null, error: "正文批次执行失败" };
  if (batch.status === "paused")
    return batch.awaitingReview
      ? { status: "paused", checkpoint: "chapter_review", error: "" }
      : {
          status: "paused",
          checkpoint: null,
          error: "正文批次已暂停（预算耗尽或手动暂停），处理后可继续运行",
        };
  return null;
}

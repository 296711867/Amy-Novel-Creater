// @vitest-environment jsdom
/**
 * AN-035 全自动巡航：tickCruise 状态机分支回归。
 *
 * 覆盖：无运行时按封存进度启动、提案暂停点自动接受并续跑、失败暂停、
 * 批次预算耗尽暂停、completed 后等待入正史、封存并开下一周期、
 * 到达目标收工，以及开关持久化。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => {
  const now = "2026-09-02T00:00:00.000Z";
  const novel = {
    id: "n1",
    title: "巡航测试",
    genre: "悬疑",
    premise: "p",
    targetWords: 100000,
    targetChapters: 40,
    chapterWords: 2500,
    cycleSize: 10,
    status: "writing" as const,
    createdAt: now,
    updatedAt: now,
  };
  const workflow = {
    novelId: "n1",
    scopeAdvice: null,
    brief: {
      audience: "a",
      style: "s",
      boundaries: "b",
      sellingPoint: "sp",
      conflict: "c",
      protagonistGoal: "g",
      ending: "e",
    },
    confirmedSteps: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    updatedAt: now,
  };
  return {
    now,
    novel,
    workflow,
    runs: [] as Array<Record<string, unknown>>,
    proposals: [] as Array<Record<string, unknown>>,
    cycles: [] as Array<Record<string, unknown>>,
    chapters: [] as Array<Record<string, unknown>>,
    batches: [] as Array<Record<string, unknown>>,
    entities: [] as unknown[],
    timeline: [] as unknown[],
    states: [] as unknown[],
    foreshadow: [] as unknown[],
    calls: {
      createWorkflowRun: [] as unknown[],
      reviewPlanningProposal: [] as unknown[],
      savePlanningCycle: [] as unknown[],
      startBackgroundBatch: [] as string[],
      generateNovelPlan: [] as string[],
      createGenerationDraft: [] as unknown[],
    },
    runSeq: 0,
    batchSeq: 0,
  };
});

vi.mock("@renderer/platform/web-platform", () => ({
  platform: {
    host: "electron",
    ready: () => Promise.resolve(),
    listNovels: () => Promise.resolve([backend.novel]),
    listPlanningRuns: () => Promise.resolve([]),
    listBibleSections: () => Promise.resolve([]),
    listStoryStructure: () => Promise.resolve({ volumes: [] }),
    listWorkflowRuns: () =>
      Promise.resolve(backend.runs.map((item) => ({ ...item }))),
    createWorkflowRun: (input: Record<string, unknown>) => {
      backend.calls.createWorkflowRun.push(input);
      const run = {
        id: `wr${++backend.runSeq}`,
        currentPhase: "bible",
        status: "running",
        checkpoint: null,
        attempt: 0,
        batchId: null,
        error: "",
        createdAt: backend.now,
        updatedAt: backend.now,
        ...input,
      };
      backend.runs.unshift(run);
      return Promise.resolve({ ...run });
    },
    updateWorkflowRun: (patch: Record<string, unknown>) => {
      const run = backend.runs.find((item) => item.id === patch.id)!;
      Object.assign(run, patch);
      return Promise.resolve({ ...run });
    },
    generateNovelPlan: (_novelId: string, phase: string) => {
      backend.calls.generateNovelPlan.push(phase);
      return Promise.resolve();
    },
    listPlanningProposals: () =>
      Promise.resolve(backend.proposals.map((item) => ({ ...item }))),
    reviewPlanningProposal: (
      _novelId: string,
      id: string,
      status: string,
    ) => {
      backend.calls.reviewPlanningProposal.push({ id, status });
      const item = backend.proposals.find((value) => value.id === id)!;
      item.status = status;
      return Promise.resolve({ ...item });
    },
    listPlanningCycles: () =>
      Promise.resolve(backend.cycles.map((item) => ({ ...item }))),
    savePlanningCycle: (input: Record<string, unknown>) => {
      backend.calls.savePlanningCycle.push({ ...input });
      const index = backend.cycles.findIndex(
        (item) => item.id === (input as { id: string }).id,
      );
      if (index >= 0) backend.cycles[index] = input;
      else backend.cycles.push(input);
      return Promise.resolve({ ...input });
    },
    getPlanningWorkflow: () =>
      Promise.resolve({
        ...backend.workflow,
        brief: { ...backend.workflow.brief },
        confirmedSteps: [...backend.workflow.confirmedSteps],
      }),
    savePlanningWorkflow: (value: typeof backend.workflow) => {
      backend.workflow = value;
      return Promise.resolve({ ...value });
    },
    listChapters: () =>
      Promise.resolve(backend.chapters.map((item) => ({ ...item }))),
    listStoryEntities: () => Promise.resolve(backend.entities as never[]),
    listTimelineEvents: () => Promise.resolve(backend.timeline as never[]),
    listCharacterStates: () => Promise.resolve(backend.states as never[]),
    listForeshadowThreads: () =>
      Promise.resolve(backend.foreshadow as never[]),
    listGenerationBatches: () =>
      Promise.resolve(backend.batches.map((item) => ({ ...item }))),
    createGenerationDraft: (novelId: string, policy: unknown) => {
      backend.calls.createGenerationDraft.push(policy);
      const batch = {
        id: `b${++backend.batchSeq}`,
        novelId,
        status: "queued",
        policy,
        outputTokensUsed: 0,
        awaitingReview: false,
        createdAt: backend.now,
        updatedAt: backend.now,
      };
      backend.batches.push(batch);
      return Promise.resolve({ id: batch.id, estimate: {} });
    },
    startBackgroundBatch: (batchId: string) => {
      backend.calls.startBackgroundBatch.push(batchId);
      const batch = backend.batches.find((item) => item.id === batchId);
      if (batch) {
        batch.status = "running";
        batch.awaitingReview = false;
      }
      return Promise.resolve();
    },
  },
}));

import { useNovelStore } from "@renderer/store/novel-store";

const store = useNovelStore;

function policy(startChapter: number, endChapter: number) {
  return {
    startChapter,
    endChapter,
    chapterWords: 2500,
    continuityCheck: true,
    maxRetries: 2,
    approvalMode: "candidate" as const,
    outputTokenBudget: 120000,
    concurrency: 1,
    deepThinking: false,
  };
}
function seedRun(overrides: Record<string, unknown> = {}) {
  const run = {
    id: "wr-seed",
    novelId: "n1",
    mode: "autopilot",
    currentPhase: "generation",
    status: "completed",
    checkpoint: null,
    config: { generationPolicy: policy(21, 30), maxPhaseRetries: 2 },
    attempt: 0,
    batchId: "b-seed",
    error: "",
    createdAt: backend.now,
    updatedAt: backend.now,
    ...overrides,
  };
  backend.runs.unshift(run);
  return run;
}
function seedChapters(from: number, to: number, status = "accepted") {
  for (let position = from; position <= to; position++)
    backend.chapters.push({
      id: `c${position}`,
      novelId: "n1",
      position,
      volumeId: null,
      title: `第${position}章`,
      outline: "o",
      status,
      targetWords: 2500,
      content: "正文。",
      wordCount: 3,
      updatedAt: backend.now,
    });
}
function seedCycle(start: number, end: number, status: string) {
  const cycle = {
    id: `cy-${start}`,
    novelId: "n1",
    startChapter: start,
    endChapter: end,
    status,
    goal: "g",
    openingState: "o",
    climax: "c",
    expectedClosingState: "e",
    actualClosingState: "",
    createdAt: backend.now,
    updatedAt: backend.now,
  };
  backend.cycles.push(cycle);
  return cycle;
}

describe("全自动巡航（AN-035）", () => {
  beforeEach(() => {
    backend.runs.length = 0;
    backend.proposals.length = 0;
    backend.cycles.length = 0;
    backend.chapters.length = 0;
    backend.batches.length = 0;
    backend.entities = [];
    backend.timeline = [];
    backend.states = [];
    backend.foreshadow = [];
    backend.workflow.confirmedSteps = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    Object.keys(backend.calls).forEach((key) => {
      (backend.calls as Record<string, unknown[]>)[key].length = 0;
    });
    window.localStorage.removeItem("amy-novel:cruise");
    window.localStorage.removeItem("amy-novel:auto-review");
    store.setState({
      novels: [backend.novel],
      workflowRuns: {},
      planningCycles: {},
      chapters: {},
      planningProposals: {},
      planningWorkflows: {},
      batches: [],
      jobs: {},
      entities: {},
      timelineEvents: {},
      foreshadowThreads: {},
      characterStates: {},
      autoReview: {},
      cruise: {},
    });
  });

  afterEach(() => {
    store.getState().stopCruise("n1");
    store.getState().setAutoReview("n1", false);
  });

  it("无运行时按封存进度启动新周期（21–30，autopilot 模式）并持久化开关", async () => {
    seedCycle(1, 10, "completed");
    seedCycle(11, 20, "completed");
    store.getState().startCruise("n1", 40);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const created = backend.calls.createWorkflowRun[0] as {
      mode: string;
      config: { generationPolicy: { startChapter: number; endChapter: number } };
    };
    expect(created.mode).toBe("autopilot");
    expect(created.config.generationPolicy).toMatchObject({
      startChapter: 21,
      endChapter: 30,
    });
    // 开关持久化 + 自动接受联动开启。
    expect(
      JSON.parse(window.localStorage.getItem("amy-novel:cruise") ?? "{}").n1,
    ).toMatchObject({ enabled: true, status: "active", targetChapter: 40 });
    expect(store.getState().autoReview["n1"]?.enabled).toBe(true);
  });

  it("提案暂停点：自动接受全部 pending 设定提案并续跑运行", async () => {
    seedRun({
      status: "paused",
      checkpoint: "proposal_review",
      batchId: "b-seed",
    });
    seedCycle(21, 30, "generating");
    backend.batches.push({
      id: "b-seed",
      novelId: "n1",
      status: "paused",
      policy: policy(21, 30),
      outputTokensUsed: 100,
      awaitingReview: true,
      createdAt: backend.now,
      updatedAt: backend.now,
    });
    backend.proposals.push(
      { id: "pp1", novelId: "n1", status: "pending", cycleId: "entity-merge", startChapter: 21, endChapter: 30 },
      { id: "pp2", novelId: "n1", status: "pending", cycleId: "entity-merge", startChapter: 21, endChapter: 30 },
    );
    store.setState({ cruise: { n1: { enabled: true, status: "active", targetChapter: 40, message: "", updatedAt: backend.now } } });
    await store.getState().tickCruise("n1");
    expect(backend.calls.reviewPlanningProposal).toEqual([
      { id: "pp1", status: "accepted" },
      { id: "pp2", status: "accepted" },
    ]);
    expect(backend.calls.startBackgroundBatch).toEqual(["b-seed"]);
  });

  it("运行失败 → 巡航暂停并记录原因（不自动重试）", async () => {
    seedRun({ status: "failed", error: "模型余额不足" });
    store.setState({ cruise: { n1: { enabled: true, status: "active", targetChapter: 40, message: "", updatedAt: backend.now } } });
    await store.getState().tickCruise("n1");
    const cruise = store.getState().cruise["n1"];
    expect(cruise?.status).toBe("paused");
    expect(cruise?.message).toContain("模型余额不足");
    expect(cruise?.message).toContain("继续巡航");
  });

  it("批次 Token 预算耗尽 → 巡航暂停并给出可读原因", async () => {
    seedRun({ status: "paused", checkpoint: null, batchId: "b-budget" });
    backend.batches.push({
      id: "b-budget",
      novelId: "n1",
      status: "paused",
      policy: policy(21, 30),
      outputTokensUsed: 6000,
      awaitingReview: false,
      createdAt: backend.now,
      updatedAt: backend.now,
    });
    store.setState({ cruise: { n1: { enabled: true, status: "active", targetChapter: 40, message: "", updatedAt: backend.now } } });
    // policy 的批次预算改小以触发耗尽。
    (backend.batches[0].policy as { outputTokenBudget: number }).outputTokenBudget = 6000;
    await store.getState().tickCruise("n1");
    const cruise = store.getState().cruise["n1"];
    expect(cruise?.status).toBe("paused");
    expect(cruise?.message).toContain("Token 预算耗尽");
  });

  it("completed 但章节未全部入正史 → 等待自动接受，不封存", async () => {
    seedRun({});
    seedChapters(21, 22, "accepted");
    seedChapters(23, 23, "candidate");
    store.setState({
      cruise: { n1: { enabled: true, status: "active", targetChapter: 40, message: "", updatedAt: backend.now } },
      autoReview: { n1: { enabled: true, message: "" } },
    });
    await store.getState().tickCruise("n1");
    const cruise = store.getState().cruise["n1"];
    expect(cruise?.status).toBe("active");
    expect(cruise?.message).toContain("2/3");
    expect(backend.calls.savePlanningCycle).toHaveLength(0);
  });

  it("全部入正史且校验通过 → 自动封存（起草实际结束状态）并开下一周期", async () => {
    seedRun({});
    seedChapters(21, 30, "accepted");
    seedCycle(21, 30, "generating");
    store.setState({ cruise: { n1: { enabled: true, status: "active", targetChapter: 40, message: "", updatedAt: backend.now } } });
    await store.getState().tickCruise("n1");
    const sealed = backend.calls.savePlanningCycle[0] as {
      status: string;
      actualClosingState: string;
    };
    expect(sealed.status).toBe("completed");
    expect(sealed.actualClosingState.length).toBeGreaterThan(0);
    const created = backend.calls.createWorkflowRun[0] as {
      config: { generationPolicy: { startChapter: number; endChapter: number } };
    };
    expect(created.config.generationPolicy).toMatchObject({
      startChapter: 31,
      endChapter: 40,
    });
    expect(store.getState().cruise["n1"]?.status).toBe("active");
    expect(store.getState().cruise["n1"]?.message).toContain("已封存");
  });

  it("到达目标章数 → 巡航收工并关闭自动接受", async () => {
    seedRun({ config: { generationPolicy: policy(31, 40), maxPhaseRetries: 2 } });
    seedChapters(31, 40, "accepted");
    seedCycle(31, 40, "generating");
    store.setState({
      cruise: { n1: { enabled: true, status: "active", targetChapter: 40, message: "", updatedAt: backend.now } },
      autoReview: { n1: { enabled: true, message: "" } },
    });
    await store.getState().tickCruise("n1");
    expect(store.getState().cruise["n1"]).toBeUndefined();
    expect(store.getState().autoReview["n1"]?.enabled).toBe(false);
    expect(store.getState().autoReview["n1"]?.message).toContain("巡航完成");
    expect(window.localStorage.getItem("amy-novel:cruise")).toBe("{}");
  });
});

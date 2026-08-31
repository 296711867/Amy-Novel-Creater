// @vitest-environment jsdom
/**
 * AN-010：Renderer 关键流程测试（zustand store + 模拟平台）。
 *
 * 覆盖发布前必须守住的三条链路：
 * 1. 规划门禁——跳步确认被域规则挡住，第 9 步未确认时批次创建被拒；
 * 2. 候选接受与事实审核——未接受候选稿前事实提案不能写入正史记忆；
 * 3. 生成中切页恢复——批次后台推进时，页面重新挂载仅靠 loadBatches/
 *    loadJobs 即可恢复运行与待审状态。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 共享假平台：内存状态可被“后台执行器”直接推进，模拟主进程行为。 */
const backend = vi.hoisted(() => {
  const now = "2026-08-31T00:00:00.000Z";
  const novel = {
    id: "n1",
    title: "流程测试",
    genre: "科幻",
    premise: "p",
    targetWords: 3000,
    targetChapters: 1,
    chapterWords: 3000,
    cycleSize: 10,
    status: "writing" as const,
    createdAt: now,
    updatedAt: now,
  };
  const chapter = {
    id: "c1",
    novelId: "n1",
    position: 1,
    volumeId: null,
    title: "第一章",
    outline: "o",
    status: "candidate" as string,
    targetWords: 3000,
    content: "旧正文",
    wordCount: 3,
    updatedAt: now,
  };
  const candidate = {
    id: "cd1",
    novelId: "n1",
    chapterId: "c1",
    profileId: "p1",
    contextHash: "h",
    content: "星舰在黎明前起飞。",
    wordCount: 9,
    status: "candidate" as string,
    inputTokens: 100,
    outputTokens: 20,
    cachedTokens: 0,
    createdAt: now,
    updatedAt: now,
  };
  return {
    now,
    workflow: {
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
      confirmedSteps: [] as number[],
      updatedAt: now,
    },
    novel,
    chapters: [{ ...chapter }],
    candidates: [{ ...candidate }],
    proposals: [
      {
        id: "fp1",
        candidateId: "cd1",
        chapterId: "c1",
        kind: "foreshadow" as const,
        title: "雾灯的秘密",
        payload: { detail: "灯油来自记忆", status: "developing" },
        status: "proposed" as string,
        createdAt: now,
        updatedAt: now,
      },
    ],
    batches: [
      {
        id: "b1",
        novelId: "n1",
        status: "running" as string,
        policy: {
          startChapter: 1,
          endChapter: 1,
          chapterWords: 3000,
          continuityCheck: true,
          maxRetries: 2,
          approvalMode: "candidate" as const,
          outputTokenBudget: 6000,
        },
        outputTokensUsed: 100,
        awaitingReview: false,
        createdAt: now,
        updatedAt: now,
      },
    ],
    jobs: [
      {
        id: "j1",
        batchId: "b1",
        chapterId: "c1",
        position: 1,
        status: "generating" as string,
        attempt: 0,
        candidateId: null as string | null,
        inputTokens: 0,
        outputTokens: 0,
        error: "",
        updatedAt: now,
      },
    ],
    calls: {
      startBackgroundBatch: [] as string[],
      saveForeshadowThread: [] as unknown[],
      saveCharacterState: [] as unknown[],
      saveTimelineEvent: [] as unknown[],
    },
  };
});

vi.mock("@renderer/platform/web-platform", () => ({
  platform: {
    host: "electron",
    ready: () => Promise.resolve(),
    listNovels: () => Promise.resolve([backend.novel]),
    getPlanningWorkflow: () => Promise.resolve(backend.workflow),
    savePlanningWorkflow: (workflow: typeof backend.workflow) => {
      backend.workflow = workflow;
      return Promise.resolve(workflow);
    },
    listChapters: () => Promise.resolve(backend.chapters),
    getChapter: (id: string) =>
      Promise.resolve(backend.chapters.find((item) => item.id === id)),
    listChapterCandidates: (chapterId: string) =>
      Promise.resolve(backend.candidates.filter((c) => c.chapterId === chapterId)),
    acceptChapterCandidate: (id: string) => {
      const item = backend.candidates.find((c) => c.id === id)!;
      item.status = "accepted";
      backend.chapters
        .filter((chapter) => chapter.id === item.chapterId)
        .forEach((chapter) => {
          chapter.status = "accepted";
          chapter.content = item.content;
          chapter.wordCount = item.wordCount;
        });
      return Promise.resolve({ ...item });
    },
    rejectChapterCandidate: (id: string) => {
      const item = backend.candidates.find((c) => c.id === id)!;
      item.status = "rejected";
      return Promise.resolve({ ...item });
    },
    listFindings: () => Promise.resolve([]),
    listFactProposals: (candidateId: string) =>
      Promise.resolve(backend.proposals.filter((p) => p.candidateId === candidateId)),
    updateFactProposal: (id: string, status: string) => {
      const item = backend.proposals.find((p) => p.id === id)!;
      item.status = status;
      // 镜像真实数据层：最后一条建议处理完任务即 completed（AN-003 门禁）。
      if (backend.proposals.every((p) => p.status !== "proposed")) {
        const job = backend.jobs.find((j) => j.candidateId === id || j.candidateId === item.candidateId);
        if (job && job.status === "candidate_ready") {
          job.status = "completed";
          const batch = backend.batches.find((b) => b.id === job.batchId);
          if (batch && batch.awaitingReview) {
            batch.awaitingReview = false;
            batch.status = "completed";
          }
        }
      }
      return Promise.resolve({ ...item });
    },
    saveForeshadowThread: (input: unknown) => {
      backend.calls.saveForeshadowThread.push(input);
      return Promise.resolve(input);
    },
    saveCharacterState: (input: unknown) => {
      backend.calls.saveCharacterState.push(input);
      return Promise.resolve(input);
    },
    saveTimelineEvent: (input: unknown) => {
      backend.calls.saveTimelineEvent.push(input);
      return Promise.resolve(input);
    },
    listStoryEntities: () => Promise.resolve([]),
    listTimelineEvents: () => Promise.resolve([]),
    listCharacterStates: () => Promise.resolve([]),
    listForeshadowThreads: () => Promise.resolve([]),
    // 镜像真实数据层门禁：第 9 步未确认时拒绝创建正文批次。
    createGenerationDraft: () => {
      if (!backend.workflow.confirmedSteps.includes(9))
        return Promise.reject(new Error("请先完成小说框架十步向导和一致性检查"));
      return Promise.resolve({ id: "b-new", estimate: {} });
    },
    listGenerationBatches: () => Promise.resolve(backend.batches.map((b) => ({ ...b }))),
    listGenerationJobs: (batchId: string) =>
      Promise.resolve(backend.jobs.filter((j) => j.batchId === batchId).map((j) => ({ ...j }))),
    startBackgroundBatch: (batchId: string) => {
      backend.calls.startBackgroundBatch.push(batchId);
      return Promise.resolve();
    },
  },
}));

import { useNovelStore } from "@renderer/store/novel-store";

const store = useNovelStore;

describe("Renderer 关键流程（store）", () => {
  beforeEach(() => {
    // 重置共享后台状态，保持用例独立。
    backend.workflow.confirmedSteps = [];
    backend.chapters[0].status = "candidate";
    backend.chapters[0].content = "旧正文";
    backend.candidates[0].status = "candidate";
    backend.proposals[0].status = "proposed";
    backend.batches[0].status = "running";
    backend.batches[0].awaitingReview = false;
    backend.jobs[0].status = "generating";
    backend.jobs[0].candidateId = null;
    backend.calls.startBackgroundBatch.length = 0;
    backend.calls.saveForeshadowThread.length = 0;
    store.setState({
      planningWorkflows: {},
      chapters: {},
      candidates: {},
      factProposals: {},
      findings: {},
      batches: [],
      jobs: {},
    });
  });

  it("规划门禁：跳步确认被挡，第 9 步未确认时批次创建被拒", async () => {
    // 直接确认第 9 步：域规则强制按顺序确认，跳步直接拒绝。
    await expect(
      store.getState().confirmPlanningReview("n1", 9),
    ).rejects.toThrow("请先确认第 8 步");
    expect(backend.workflow.confirmedSteps).toEqual([]);
    await expect(
      store.getState().createGenerationDraft("n1", {
        startChapter: 1,
        endChapter: 1,
        chapterWords: 3000,
        continuityCheck: true,
        maxRetries: 2,
        approvalMode: "candidate",
        outputTokenBudget: 6000,
      }),
    ).rejects.toThrow(/十步向导|一致性检查/);

    // 按顺序确认 1–9 后门禁放行。
    for (let step = 1; step <= 9; step++)
      await store.getState().confirmPlanningReview("n1", step as 1);
    const workflow = store.getState().planningWorkflows["n1"];
    expect(workflow?.confirmedSteps).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    await expect(
      store.getState().createGenerationDraft("n1", {
        startChapter: 1,
        endChapter: 1,
        chapterWords: 3000,
        continuityCheck: true,
        maxRetries: 2,
        approvalMode: "candidate",
        outputTokenBudget: 6000,
      }),
    ).resolves.toMatchObject({ id: "b-new" });
  });

  it("候选接受与事实审核：未接受候选稿前事实提案不能写入正史记忆", async () => {
    await store.getState().loadChapters("n1");
    await store.getState().loadCandidates("c1");
    await store.getState().loadQuality("cd1");

    // 候选稿还是 candidate：接受事实提案会被正史门禁拒绝。
    await expect(
      store.getState().reviewFactProposal("cd1", "fp1", true),
    ).rejects.toThrow();
    expect(backend.calls.saveForeshadowThread).toHaveLength(0);
    expect(backend.proposals[0].status).toBe("proposed");

    // 接受候选稿 → 章节状态与内容同步到 store。
    const accepted = await store.getState().reviewCandidate("cd1", true);
    expect(accepted.status).toBe("accepted");
    const chapter = store.getState().chapters["n1"]?.find((c) => c.id === "c1");
    expect(chapter).toMatchObject({ status: "accepted", content: "星舰在黎明前起飞。" });

    // 再接受事实提案：伏笔以 ai_candidate 来源写入正史记忆，状态同步。
    await store.getState().reviewFactProposal("cd1", "fp1", true);
    expect(backend.calls.saveForeshadowThread).toHaveLength(1);
    expect(backend.calls.saveForeshadowThread[0]).toMatchObject({
      novelId: "n1",
      title: "雾灯的秘密",
      source: "ai_candidate",
    });
    expect(store.getState().factProposals["cd1"]?.[0].status).toBe("accepted");
  });

  it("生成中切页恢复：后台推进后仅靠 loadBatches/loadJobs 恢复状态", async () => {
    // 进入生成页：dispatch 启动后台批次（Electron 主进程执行）。
    await store.getState().dispatchBatch("b1");
    expect(backend.calls.startBackgroundBatch).toEqual(["b1"]);
    expect(store.getState().batches[0]).toMatchObject({ status: "running" });

    // 作者切到其他页面；期间主进程把本章推进到候选就绪并暂停等待审核。
    backend.jobs[0].status = "candidate_ready";
    backend.jobs[0].candidateId = "cd1";
    backend.batches[0].status = "paused";
    backend.batches[0].awaitingReview = true;

    // 切回生成页：挂载 effect 只做 loadBatches + loadJobs，状态即恢复。
    await store.getState().loadBatches();
    await store.getState().loadJobs("b1");
    expect(store.getState().batches[0]).toMatchObject({
      status: "paused",
      awaitingReview: true,
    });
    expect(store.getState().jobs["b1"]?.[0]).toMatchObject({
      status: "candidate_ready",
      candidateId: "cd1",
    });

    // 处理完全部事实提案后（AN-003 门禁），任务与批次收敛为完成。
    backend.candidates[0].status = "accepted";
    await store.getState().loadCandidates("c1");
    await store.getState().loadQuality("cd1");
    await store.getState().reviewFactProposal("cd1", "fp1", true);
    await store.getState().loadBatches();
    await store.getState().loadJobs("b1");
    expect(store.getState().jobs["b1"]?.[0].status).toBe("completed");
    expect(store.getState().batches[0]).toMatchObject({
      status: "completed",
      awaitingReview: false,
    });
  });
});

// @vitest-environment jsdom
/**
 * AN-044（含 waiting_retry 扩展）：runBatch 启动时的孤儿任务自愈。
 *
 * Web 端批次在渲染进程执行，页面刷新/关闭会杀死进行中的请求与重试退避
 * setTimeout。重开或恢复时任务永远停在 generating / building_context /
 * waiting_retry——不重置的话该章永远不会有候选稿（黑洞章）。
 * waiting_retry 的退避计时随页面死亡，必须一并重置（2026-09-13 复审补充）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const backend = vi.hoisted(() => {
  const now = "2026-09-13T00:00:00.000Z";
  const novel = {
    id: "n1",
    title: "孤儿任务测试",
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
  const chapter = (position: number) => ({
    id: `c${position}`,
    novelId: "n1",
    position,
    volumeId: null,
    title: `第${position}章`,
    outline: "o",
    status: "accepted",
    targetWords: 2500,
    content: "旧稿。",
    wordCount: 3,
    updatedAt: now,
  });
  return {
    now,
    novel,
    jobs: [
      // 三种孤儿状态各一
      { id: "j1", batchId: "b1", chapterId: "c1", position: 1, status: "generating", candidateId: null, attempt: 0, error: "", updatedAt: now },
      { id: "j2", batchId: "b1", chapterId: "c2", position: 2, status: "building_context", candidateId: null, attempt: 0, error: "", updatedAt: now },
      { id: "j3", batchId: "b1", chapterId: "c3", position: 3, status: "waiting_retry", candidateId: null, attempt: 1, error: "网关 503", updatedAt: now },
    ],
    chapters: [chapter(1), chapter(2), chapter(3)],
    requeued: [] as string[],
    emitted: [] as string[],
  };
});

vi.mock("@renderer/platform/web-platform", () => ({
  platform: {
    host: "web",
    ready: () => Promise.resolve(),
    listNovels: () => Promise.resolve([backend.novel]),
    listGenerationBatches: () =>
      Promise.resolve([
        {
          id: "b1",
          novelId: "n1",
          status: "paused",
          policy: {
            startChapter: 1,
            endChapter: 3,
            chapterWords: 2500,
            continuityCheck: true,
            maxRetries: 2,
            approvalMode: "candidate",
            outputTokenBudget: 60000,
          },
          outputTokensUsed: 0,
          awaitingReview: false,
          createdAt: backend.now,
          updatedAt: backend.now,
        },
      ]),
    listGenerationJobs: () => Promise.resolve(backend.jobs.map((j) => ({ ...j }))),
    updateGenerationJob: (id: string, status: string) => {
      if (status === "queued") backend.requeued.push(id);
      const job = backend.jobs.find((j) => j.id === id);
      if (job) job.status = status as never;
      return Promise.resolve({ ...job });
    },
    setBatchStatus: (id: string, status: string) => {
      // 模拟运行器收尾：无需真实生成，直接把批次标记完成
      return Promise.resolve({ id, status });
    },
    appendGenerationEvent: (input: { message: string }) => {
      backend.emitted.push(input.message);
      return Promise.resolve({ ...input });
    },
    getChapter: (id: string) =>
      Promise.resolve(backend.chapters.find((c) => c.id === id) ?? null),
    listChapterCandidates: () => Promise.resolve([]),
    listModelProfiles: () =>
      Promise.resolve([
        {
          id: "p1",
          name: "作者模型",
          provider: "openai-compatible",
          baseUrl: "http://127.0.0.1:8990/v1",
          modelId: "amy-author",
          apiKey: "",
          contextWindow: 128000,
          isDefault: true,
          createdAt: backend.now,
          updatedAt: backend.now,
        },
      ]),
  },
}));

import { useNovelStore } from "@renderer/store/novel-store";

describe("runBatch 孤儿任务自愈（AN-044 含 waiting_retry）", () => {
  beforeEach(() => {
    useNovelStore.setState({
      novels: [backend.novel],
      batches: [],
      jobs: {},
      chapters: { n1: backend.chapters.map((c) => ({ ...c })) } as never,
      modelProfiles: [],
      candidates: {},
      activeRequests: {},
    });
    backend.requeued.length = 0;
    backend.emitted.length = 0;
    // 重置任务状态
    backend.jobs[0].status = "generating";
    backend.jobs[1].status = "building_context";
    backend.jobs[2].status = "waiting_retry";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("waiting_retry 等孤儿任务在 runBatch 启动时被重置回 queued", async () => {
    // dispatchBatch（web host）→ runBatch：入口重置孤儿 → 循环无 queued
    // 之外的任务可跑（模拟生成直接完成由 mock 承担——这里只验证重置发生）。
    // 由于 mock 的生成调用未实现，runBatch 会在首次真实生成调用处抛错；
    // 但孤儿重置发生在循环之前，requeued 应已记录三条。
    await store_dispatch().catch(() => undefined);
    expect(backend.requeued).toEqual(["j1", "j2", "j3"]);
    expect(
      backend.emitted.some((m) => m.includes("因中断挂起")),
    ).toBe(true);
  });
});

async function store_dispatch() {
  const store = useNovelStore.getState();
  await store.dispatchBatch("b1");
}

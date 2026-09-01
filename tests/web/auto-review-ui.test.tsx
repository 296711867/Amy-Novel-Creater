// @vitest-environment jsdom
/**
 * AN-026：生成工作台自动审阅 UI 回归（真实组件 + 真实 store + 模拟平台）。
 *
 * 验证三个界面接线：
 * 1. 「自动接受并连续创作」开关存在且点击后切换 store 状态；
 * 2. 候选稿未接受时：正史建议按钮锁定且有解锁提示条；
 * 3. 候选稿已接受且有待审建议时：出现「全部接受」按钮，点击批量写入。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { HashRouter } from "react-router-dom";

const backend = vi.hoisted(() => {
  const now = "2026-08-31T00:00:00.000Z";
  return {
    now,
    novels: [
      {
        id: "n1",
        title: "UI 测试小说",
        genre: "悬疑",
        premise: "p",
        targetWords: 3000,
        targetChapters: 1,
        chapterWords: 3000,
        cycleSize: 10,
        status: "writing" as const,
        createdAt: now,
        updatedAt: now,
      },
    ],
    chapters: [
      {
        id: "c1",
        novelId: "n1",
        position: 1,
        volumeId: null,
        title: "第一章",
        outline: "o",
        status: "candidate",
        targetWords: 3000,
        content: "旧正文",
        wordCount: 3,
        updatedAt: now,
      },
    ],
    candidates: [
      {
        id: "cd1",
        novelId: "n1",
        chapterId: "c1",
        profileId: "p1",
        contextHash: "h",
        content: "雾灯在暴雨里亮着。",
        wordCount: 9,
        status: "candidate",
        inputTokens: 100,
        outputTokens: 20,
        cachedTokens: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    proposals: [
      {
        id: "fp1",
        candidateId: "cd1",
        chapterId: "c1",
        kind: "foreshadow" as const,
        title: "灯油来自记忆",
        payload: { detail: "灯油原料是守灯人的回忆", status: "developing" },
        status: "proposed",
        createdAt: now,
        updatedAt: now,
      },
    ],
    batches: [
      {
        id: "b1",
        novelId: "n1",
        status: "paused",
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
        awaitingReview: true,
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
        status: "candidate_ready",
        attempt: 1,
        candidateId: "cd1",
        inputTokens: 100,
        outputTokens: 20,
        error: "",
        updatedAt: now,
      },
    ],
    calls: { saveForeshadowThread: [] as unknown[] },
  };
});

vi.mock("@renderer/platform/web-platform", () => ({
  platform: {
    host: "electron",
    ready: () => Promise.resolve(),
    listNovels: () => Promise.resolve(backend.novels),
    listChapters: () => Promise.resolve(backend.chapters),
    getChapter: (id: string) =>
      Promise.resolve(backend.chapters.find((item) => item.id === id)),
    listChapterCandidates: (chapterId: string) =>
      Promise.resolve(
        backend.candidates.filter((item) => item.chapterId === chapterId),
      ),
    acceptChapterCandidate: (id: string) => {
      const item = backend.candidates.find((value) => value.id === id)!;
      item.status = "accepted";
      backend.chapters
        .filter((chapter) => chapter.id === item.chapterId)
        .forEach((chapter) => {
          chapter.status = "accepted";
          chapter.content = item.content;
        });
      return Promise.resolve({ ...item });
    },
    rejectChapterCandidate: (id: string) => {
      const item = backend.candidates.find((value) => value.id === id)!;
      item.status = "rejected";
      return Promise.resolve({ ...item });
    },
    listFindings: () => Promise.resolve([]),
    listFactProposals: (candidateId: string) =>
      Promise.resolve(
        backend.proposals.filter((item) => item.candidateId === candidateId),
      ),
    updateFactProposal: (id: string, status: string) => {
      const item = backend.proposals.find((value) => value.id === id)!;
      item.status = status;
      return Promise.resolve({ ...item });
    },
    saveForeshadowThread: (input: unknown) => {
      backend.calls.saveForeshadowThread.push(input);
      return Promise.resolve(input);
    },
    saveCharacterState: (input: unknown) => Promise.resolve(input),
    saveTimelineEvent: (input: unknown) => Promise.resolve(input),
    listStoryEntities: () => Promise.resolve([]),
    listTimelineEvents: () => Promise.resolve([]),
    listCharacterStates: () => Promise.resolve([]),
    listForeshadowThreads: () => Promise.resolve([]),
    listGenerationBatches: () =>
      Promise.resolve(backend.batches.map((item) => ({ ...item }))),
    listGenerationJobs: (batchId: string) =>
      Promise.resolve(
        backend.jobs
          .filter((item) => item.batchId === batchId)
          .map((item) => ({ ...item })),
      ),
    listGenerationEvents: () => Promise.resolve([]),
    startBackgroundBatch: () => Promise.resolve(),
  },
}));

import { BatchesPage } from "@renderer/pages/BatchesPage";
import { useNovelStore } from "@renderer/store/novel-store";

function renderPage() {
  return render(
    <HashRouter>
      <BatchesPage />
    </HashRouter>,
  );
}

describe("生成工作台自动审阅 UI（AN-026）", () => {
  afterEach(() => {
    useNovelStore.getState().setAutoReview("n1", false);
    cleanup();
  });
  beforeEach(() => {
    backend.candidates[0].status = "candidate";
    backend.chapters[0].status = "candidate";
    backend.proposals[0].status = "proposed";
    backend.calls.saveForeshadowThread.length = 0;
    useNovelStore.setState({
      novels: backend.novels,
      chapters: {},
      candidates: {},
      factProposals: {},
      findings: {},
      batches: [],
      jobs: {},
      activityEvents: {},
      autoReview: {},
    });
  });

  it("候选稿未接受：建议按钮锁定并显示解锁提示，不出现全部接受", async () => {
    renderPage();
    // 等待批次数据装载完成。
    await waitFor(() =>
      expect(screen.getByText(/等待审核/)).toBeTruthy(),
    );

    const acceptCanon = await screen.findByRole("button", {
      name: /接受并写入正史/,
    });
    expect((acceptCanon as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/先点击上方「接受并写入正文」/)).toBeTruthy();
    expect(screen.queryByText(/全部接受/)).toBeNull();
  });

  it("自动接受开关：点击切换 store 状态与文案", async () => {
    renderPage();
    const toggle = await screen.findByRole("button", {
      name: /自动接受并连续创作/,
    });
    fireEvent.click(toggle);
    expect(useNovelStore.getState().autoReview["n1"]?.enabled).toBe(true);
    expect(
      await screen.findByText(/自动创作中·点击停止/),
    ).toBeTruthy();
    // 清理：关闭自动审阅，停掉测试里的轮询定时器。
    useNovelStore.getState().setAutoReview("n1", false);
  });

  it("候选稿已接受：全部接受按钮批量写入正史建议", async () => {
    backend.candidates[0].status = "accepted";
    backend.chapters[0].status = "accepted";
    renderPage();
    const acceptAll = await screen.findByRole("button", {
      name: /全部接受（1）/,
    });
    fireEvent.click(acceptAll);
    await waitFor(() =>
      expect(backend.calls.saveForeshadowThread).toHaveLength(1),
    );
    expect(backend.calls.saveForeshadowThread[0]).toMatchObject({
      novelId: "n1",
      source: "ai_candidate",
    });
    expect(
      await screen.findByText(/已接受 1 条正史建议/),
    ).toBeTruthy();
  });
});

// @vitest-environment jsdom
/**
 * AN-043 回归：巡航启用（含 paused）时，巡航卡片不依赖第 10 步解锁。
 *
 * 线上形态：周期封存后 invalidatePlanning(7) 使向导退回第 7 步，第 8–10 步
 * 锁定；巡航卡片旧实现只在 activeStep===10 渲染，作者看不到暂停原因、
 * 点不到「继续巡航」。修复后巡航启用期间卡片在任意步骤可见。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@renderer/platform/web-platform", () => ({
  platform: {
    host: "web",
    ready: () => Promise.resolve(),
    getPlanningWorkflow: () =>
      Promise.resolve({
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
        // 地基完成、第 7 步待办：向导停在第 7 步，第 8–10 步锁定。
        confirmedSteps: [1, 2, 3, 4, 5, 6],
        updatedAt: "2026-09-11T00:00:00.000Z",
      }),
    listPlanningRuns: () => Promise.resolve([]),
    listPlanningCycles: () => Promise.resolve([]),
    listPlanningProposals: () => Promise.resolve([]),
    listWorkflowRuns: () => Promise.resolve([]),
    listBibleSections: () => Promise.resolve([]),
    listStoryEntities: () => Promise.resolve([]),
    listChapters: () => Promise.resolve([]),
    listStoryStructure: () => Promise.resolve({ volumes: [], scenes: [] }),
    listVolumes: () => Promise.resolve([]),
    listTimelineEvents: () => Promise.resolve([]),
    listForeshadowThreads: () => Promise.resolve([]),
    listCharacterStates: () => Promise.resolve([]),
  },
}));

import { PlanningWorkflowPage } from "@renderer/pages/PlanningWorkflowPage";
import { useNovelStore } from "@renderer/store/novel-store";

function renderPlanPage() {
  return render(
    <MemoryRouter initialEntries={["/novels/n1/plan"]}>
      <Routes>
        <Route
          path="/novels/:novelId/plan"
          element={<PlanningWorkflowPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("巡航卡片可见性（AN-043）", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    useNovelStore.setState({
      initialized: true,
      novels: [
        {
          id: "n1",
          title: "雾灯航路",
          genre: "悬疑",
          premise: "守灯少年寻找失踪的引航员",
          targetWords: 300000,
          targetChapters: 100,
          chapterWords: 3000,
          cycleSize: 10,
          status: "planning",
          createdAt: "2026-09-11T00:00:00.000Z",
          updatedAt: "2026-09-11T00:00:00.000Z",
        },
      ],
      chapters: {},
      bibleSections: {},
      entities: {},
      volumes: {},
      planningCycles: {},
      planningRuns: {},
      planningProposals: {},
      workflowRuns: {},
      timelineEvents: {},
      foreshadowThreads: {},
      characterStates: {},
      activityEvents: {},
      planningBusy: {},
      planningMessage: {},
      cruise: {},
    });
  });

  it("巡航未启用：向导第 7 步不出现巡航卡片（保持原行为）", async () => {
    renderPlanPage();
    expect(await screen.findByText("第 7 / 10 步")).toBeTruthy();
    expect(screen.queryByText("全自动巡航（自动规划 + 自动创作）")).toBeNull();
  });

  it("巡航 paused：第 7 步也渲染巡航卡片与「继续巡航」按钮", async () => {
    useNovelStore.setState({
      planningWorkflows: {},
      cruise: {
        n1: {
          enabled: true,
          status: "paused",
          targetChapter: 40,
          message: "自动接受已停止（本批次已全部完成，自动接受已自动关闭。）",
          updatedAt: "2026-09-11T00:00:00.000Z",
        },
      },
    });
    renderPlanPage();
    expect(await screen.findByText("第 7 / 10 步")).toBeTruthy();
    expect(
      await screen.findByRole("heading", {
        name: "全自动巡航（自动规划 + 自动创作）",
      }),
    ).toBeTruthy();
    const resume = screen.getByRole("button", { name: /继续巡航/ });
    expect(resume).toBeTruthy();
    // Autopilot 卡片仍只在第 10 步展示，不随巡航卡片提前出现。
    expect(screen.queryByText("Autopilot 自动运行")).toBeNull();
  });
});

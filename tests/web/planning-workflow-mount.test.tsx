// @vitest-environment jsdom
/**
 * AN-025 回归：规划向导页挂载不再因不稳定 selector 触发无限重渲染。
 *
 * 复现条件：新建小说后 store 里 planningWorkflow / activityEvents 尚无该
 * novelId 的键，旧实现 selector 写成 `state.activityEvents[key] ?? []`，
 * 每次返回新数组引用，zustand v5（useSyncExternalStore）判定快照变化
 * 强制重渲染，最终抛 "Maximum update depth exceeded" 并卸载整棵树，
 * 用户表现为点击作品卡片后白屏。本测试在同样的空数据状态下整页挂载
 * PlanningWorkflowPage，修复前 render 抛错，修复后正常渲染第 1 步。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@renderer/platform/web-platform", () => ({
  platform: {
    host: "web",
    ready: () => Promise.resolve(),
    getPlanningWorkflow: () => Promise.resolve(null),
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

describe("规划向导页挂载回归（白屏 AN-025）", () => {
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
          createdAt: "2026-08-31T00:00:00.000Z",
          updatedAt: "2026-08-31T00:00:00.000Z",
        },
      ],
      // 关键：所有按 novelId 分桶的状态都没有键，selector 走兜底分支。
      chapters: {},
      bibleSections: {},
      entities: {},
      volumes: {},
      planningWorkflows: {},
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
    });
  });

  it("空数据状态下挂载不触发 Maximum update depth exceeded", async () => {
    expect(() =>
      render(
        <MemoryRouter initialEntries={["/novels/n1/plan"]}>
          <Routes>
            <Route
              path="/novels/:novelId/plan"
              element={<PlanningWorkflowPage />}
            />
          </Routes>
        </MemoryRouter>,
      ),
    ).not.toThrow();

    // 页面正常渲染出向导骨架：标题与第 1 步。
    expect(await screen.findByText("雾灯航路")).toBeTruthy();
    expect(await screen.findByText("第 1 / 10 步")).toBeTruthy();
  });
});

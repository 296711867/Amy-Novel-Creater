// @vitest-environment jsdom
/**
 * AN-024：PersonaPanel 关键 UI 回归（真实组件 + 真实 store + 模拟平台）。
 *
 * 走通“让 Amy 推荐人格阵容 → 逐个调整 → 批量确认写入正式设定”的
 * 完整交互：草稿渲染、确认后 saveStoryEntity 以 ai 建议人格字段写入、
 * 结果文案与已确认状态切换。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const backend = vi.hoisted(() => ({
  entities: [
    {
      id: "e1",
      novelId: "n1",
      type: "character",
      name: "沈灯",
      summary: "守灯少年",
      aliases: [] as string[],
      profile: { tier: "protagonist" } as Record<string, unknown>,
      status: "active",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
    {
      id: "e2",
      novelId: "n1",
      type: "character",
      name: "崔衡",
      summary: "守灯人旧部",
      aliases: [],
      profile: { tier: "support" },
      status: "active",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
  ],
  savedEntities: [] as Array<Record<string, unknown>>,
}));

vi.mock("@renderer/platform/web-platform", () => ({
  platform: {
    host: "electron",
    ready: () => Promise.resolve(),
    suggestPersonaLineup: () =>
      Promise.resolve([
        {
          entityName: "沈灯",
          tier: "protagonist",
          personaType: "守灯的偏执理想主义者",
          reason: "主角弧线需要",
          writingConstraints: "短句，不解释动机",
          speechHabit: "灯还亮着",
        },
        {
          entityName: "崔衡",
          tier: "support",
          personaType: "体面的旧秩序维护者",
          reason: "反派阵营代表",
          writingConstraints: "敬语，克制",
          speechHabit: "依灯约行事",
        },
      ]),
    listStoryEntities: () => Promise.resolve(backend.entities.map((e) => ({ ...e }))),
    saveStoryEntity: (input: Record<string, unknown>) => {
      backend.savedEntities.push(input);
      return Promise.resolve(input);
    },
  },
}));

import { PersonaPanel } from "@renderer/pages/PlanningWorkflowPage";
import { useNovelStore } from "@renderer/store/novel-store";

describe("PersonaPanel UI 回归", () => {
  beforeEach(() => {
    backend.savedEntities.length = 0;
    useNovelStore.setState({
      entities: {},
      personaDrafts: {},
      personaBusy: {},
      personaMessage: {},
    });
  });

  it("推荐 → 调整 → 批量确认写入正式人物设定", async () => {
    await useNovelStore.getState().loadEntities("n1");
    render(<PersonaPanel novelId="n1" confirmed={false} />);

    fireEvent.click(await screen.findByText("让 Amy 推荐人格阵容"));

    // 两名人物按分层渲染草稿：主角完整人格、核心配角同样可调整。
    expect(await screen.findByText("沈灯")).toBeTruthy();
    expect(await screen.findByText("崔衡")).toBeTruthy();
    expect(screen.getByText("主角 · 完整人格")).toBeTruthy();
    expect(screen.getByDisplayValue("守灯的偏执理想主义者")).toBeTruthy();

    // 作者调整写作行为约束后批量确认。
    fireEvent.change(screen.getAllByLabelText(/写作行为约束/)[0], {
      target: { value: "更短的句子" },
    });
    fireEvent.click(screen.getByText(/批量确认人物阵容（2 名）/));

    await waitFor(() =>
      expect(backend.savedEntities).toHaveLength(2),
    );
    expect(backend.savedEntities[0]).toMatchObject({
      id: "e1",
      profile: expect.objectContaining({
        tier: "protagonist",
        人格: "守灯的偏执理想主义者",
        写作约束: "更短的句子",
        语言习惯: "灯还亮着",
      }),
    });
    expect(
      await screen.findByText(/已批量确认 2 名人物的人格/),
    ).toBeTruthy();
  });
});

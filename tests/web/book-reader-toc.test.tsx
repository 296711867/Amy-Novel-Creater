// @vitest-environment jsdom
/**
 * AN-055 回归：连读页目录点击不再跳回首页。
 *
 * 线上形态：目录用裸锚点 href="#book-ch-N"，HashRouter 把它解析为路由
 * "book-ch-N"，匹配不到任何页面 → 通配路由 Navigate 到 "/"。修复后目录
 * 点击 preventDefault 并滚动定位，路由保持不变。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { BookReaderPage } from "@renderer/pages/BookReaderPage";
import { useNovelStore } from "@renderer/store/novel-store";

const chapter = (position: number) => ({
  id: `n1:chapter:${position}`,
  novelId: "n1",
  position,
  volumeId: null,
  title: `第${position}章 章节名`,
  outline: "o",
  status: "accepted" as const,
  targetWords: 2000,
  content: "第一段。\n\n第二段。",
  wordCount: 2000,
  updatedAt: "2026-09-13T00:00:00.000Z",
});

vi.mock("@renderer/platform/web-platform", () => ({
  platform: {
    host: "web",
    ready: () => Promise.resolve(),
    listChapters: () =>
      Promise.resolve([chapter(1), chapter(2), chapter(3)]),
    listFindings: () => Promise.resolve([]),
    addFinding: () => Promise.resolve({}),
    reviseChapterContent: () => Promise.resolve(chapter(1)),
  },
}));

describe("连读页目录点击（AN-055）", () => {
  beforeEach(() => {
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    useNovelStore.setState({
      initialized: true,
      novels: [
        {
          id: "n1",
          title: "雾灯航路",
          genre: "悬疑",
          premise: "p",
          targetWords: 300000,
          targetChapters: 100,
          chapterWords: 3000,
          cycleSize: 10,
          status: "writing",
          createdAt: "2026-09-13T00:00:00.000Z",
          updatedAt: "2026-09-13T00:00:00.000Z",
        },
      ],
      chapters: {
        n1: [chapter(1), chapter(2), chapter(3)],
      },
      versions: {},
      findings: {},
    });
  });

  it("目录点击 preventDefault 并滚动定位，路由不变化", () => {
    render(
      <MemoryRouter initialEntries={["/novels/n1/book"]}>
        <Routes>
          <Route path="/novels/:novelId/book" element={<BookReaderPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const tocLink = screen.getByText("2. 第2章 章节名").closest("a")!;
    expect(tocLink.getAttribute("href")).toBe("#book-ch-2");
    fireEvent.click(tocLink);
    // 滚动定位被调用，且未发生路由跳转（仍在连读页）
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText(/整书连读/)).toBeTruthy();
  });
});


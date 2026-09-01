/**
 * AN-032 全书分窗口审稿：窗口切分、prompt 装配与解析域测试。
 */
import { describe, expect, it } from "vitest";
import {
  bookReviewWindowPrompt,
  buildBookWindows,
  characterDigestText,
  parseBookReviewWindow,
} from "@domain/whole-book-review";
import type { Chapter } from "@domain/novel";

const now = "2026-09-02T00:00:00.000Z";
function chapter(position: number, content = "正文。"): Chapter {
  return {
    id: `c${position}`,
    novelId: "n1",
    position,
    volumeId: null,
    title: `第${position}章`,
    outline: "o",
    status: "accepted",
    targetWords: 2500,
    content,
    wordCount: 3,
    updatedAt: now,
  };
}

describe("窗口切分", () => {
  it("只收已入正史且有正文的章节，按窗口大小顺序切分", () => {
    const windows = buildBookWindows(
      [
        chapter(1),
        { ...chapter(2), status: "draft" }, // 未入正史
        chapter(3, "  "), // 空正文
        chapter(4),
        chapter(5),
        chapter(6),
        chapter(7),
      ],
      3,
    );
    expect(windows.map((item) => [item.start, item.end])).toEqual([
      [1, 5],
      [6, 7],
    ]);
    expect(windows[0].chapters.map((item) => item.position)).toEqual([1, 4, 5]);
    expect(windows[0].index).toBe(0);
  });

  it("空书返回空窗口数组", () => {
    expect(buildBookWindows([])).toEqual([]);
    expect(
      buildBookWindows([{ ...chapter(1), status: "planned" }]),
    ).toEqual([]);
  });
});

describe("窗口 prompt 装配", () => {
  it("携带滚动摘要、人物速览与已知问题，正文按预算均分", () => {
    const prompt = bookReviewWindowPrompt({
      novelTitle: "雾灯航路",
      genre: "悬疑",
      windowIndex: 1,
      windowCount: 4,
      windowChapters: [
        chapter(6, "第六章正文".repeat(2000)),
        chapter(7, "第七章正文".repeat(2000)),
      ],
      rollingSummary: "前五回顾：主角离家。",
      characterDigest: "- 沈灯：守灯少年",
      knownIssues: ["伏笔「账本」未回收"],
      inputBudget: 2000,
    });
    expect(prompt).toContain("2/4 个窗口");
    expect(prompt).toContain("前五回顾：主角离家。");
    expect(prompt).toContain("- 沈灯：守灯少年");
    expect(prompt).toContain("伏笔「账本」未回收");
    expect(prompt).toContain("第6章");
    expect(prompt).toContain("第7章");
    expect(prompt).toContain("summary");
    // 正文被裁剪（预算远小于原文）。
    expect(prompt).not.toContain("第六章正文".repeat(2000));
    expect(prompt.length).toBeLessThan(12000);
  });
});

describe("窗口解析", () => {
  it("notes 产出带章节定位的发现；同窗口复述去重；id 跨运行稳定", () => {
    const raw = JSON.stringify({
      summary: "主角潜入山寨。",
      notes: [
        {
          severity: "error",
          category: "character",
          chapterPosition: 3,
          message: "沈灯的年龄与第 1 章矛盾",
          evidence: "第 3 章写 24 岁",
          suggestion: "统一年龄",
        },
        {
          severity: "error",
          category: "character",
          chapterPosition: 3,
          message: "沈灯的年龄与第 1 章矛盾",
        },
      ],
    });
    const outcome = parseBookReviewWindow(raw, { novelId: "n1", windowIndex: 0 });
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0]).toMatchObject({
      id: expect.stringMatching(/^book:/),
      source: "ai",
      severity: "error",
      chapterPosition: 3,
      suggestion: "统一年龄",
    });
    const again = parseBookReviewWindow(raw, { novelId: "n1", windowIndex: 0 });
    expect(again.findings[0].id).toBe(outcome.findings[0].id);

    // 缺省字段兜底。
    const loose = parseBookReviewWindow(
      JSON.stringify({ summary: "", notes: [{ message: "文风漂移" }] }),
      { novelId: "n1", windowIndex: 2 },
    );
    expect(loose.findings[0]).toMatchObject({
      severity: "warning",
      category: "consistency",
    });
  });
});

describe("人物速览", () => {
  it("每人最新状态 + 时间线尾部 + 未回收伏笔", () => {
    const text = characterDigestText(
      [
        {
          id: "e1",
          novelId: "n1",
          type: "character",
          name: "沈灯",
          summary: "s",
          aliases: [],
          profile: {},
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ],
      [
        {
          id: "s1",
          novelId: "n1",
          characterId: "e1",
          chapterId: "c1",
          summary: "早期",
          location: "",
          appearance: "",
          outfit: "",
          identity: "",
          physical: "",
          emotional: "",
          knowledge: [],
          goals: [],
          inventory: [],
          skills: [],
          source: "manual",
          createdAt: now,
          updatedAt: now,
        },
        {
          id: "s2",
          novelId: "n1",
          characterId: "e1",
          chapterId: "c2",
          summary: "最新：守塔人",
          location: "",
          appearance: "",
          outfit: "",
          identity: "",
          physical: "",
          emotional: "",
          knowledge: [],
          goals: [],
          inventory: [],
          skills: [],
          source: "manual",
          createdAt: now,
          updatedAt: now,
        },
      ],
      [],
      [
        {
          id: "f1",
          novelId: "n1",
          title: "账本之谜",
          detail: "d",
          setupChapterId: "c1",
          payoffChapterId: null,
          status: "planted",
          source: "manual",
          createdAt: now,
          updatedAt: now,
        },
      ],
    );
    expect(text).toContain("沈灯：最新：守塔人");
    expect(text).not.toContain("早期");
    expect(text).toContain("账本之谜");
  });
});

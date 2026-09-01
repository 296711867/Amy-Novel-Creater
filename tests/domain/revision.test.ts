/**
 * AN-034 全局微调：确定性查找与替换预览域测试。
 */
import { describe, expect, it } from "vitest";
import {
  MIN_REVISION_QUERY,
  globalSearchChapters,
  replaceAllInContent,
} from "@domain/revision";
import type { Chapter } from "@domain/novel";

const now = "2026-09-02T00:00:00.000Z";
function chapter(position: number, content: string): Chapter {
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
    wordCount: 10,
    updatedAt: now,
  };
}

describe("全局查找", () => {
  it("跨章命中：计数与首个命中上下文预览正确", () => {
    const matches = globalSearchChapters(
      [
        chapter(1, "深夜，顾行舟推开公寓门。顾行舟愣住。"),
        chapter(2, "夜色沉沉，无命中。"),
        chapter(3, "管家看见顾行舟归来。"),
      ],
      "顾行舟",
    );
    expect(matches.map((item) => item.position)).toEqual([1, 3]);
    expect(matches[0].count).toBe(2);
    expect(matches[0].preview).toMatchObject({ hit: "顾行舟" });
    expect(matches[0].preview.before).toContain("深夜");
  });

  it("空查找词返回空，单字查找允许（逐章确认兜底）", () => {
    expect(globalSearchChapters([chapter(1, "灯")], "")).toEqual([]);
    expect(globalSearchChapters([chapter(1, "灯")], "  ")).toEqual([]);
    expect(MIN_REVISION_QUERY).toBe(1);
    expect(globalSearchChapters([chapter(1, "灯塔亮了")], "灯")).toHaveLength(1);
  });
});

describe("确定性替换", () => {
  it("全部替换并计数（含单字）", () => {
    expect(replaceAllInContent("灯，灯，还是灯。", "灯", "塔")).toEqual({
      content: "塔，塔，还是塔。",
      count: 3,
    });
  });

  it("查找词与替换词相同或为空时不执行", () => {
    expect(replaceAllInContent("正文", "正文", "正文").count).toBe(0);
    expect(replaceAllInContent("正文", " ", "y").count).toBe(0);
  });

  it("替换为空串即删除该词", () => {
    expect(replaceAllInContent("他说：嗯嗯。", "嗯", "").content).toBe(
      "他说：。",
    );
  });
});

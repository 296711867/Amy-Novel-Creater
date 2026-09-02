/**
 * AN-037 书稿导出域测试：只导出正史、按章排序、头部统计与空书兜底。
 */
import { describe, expect, it } from "vitest";
import { buildBookText } from "@domain/book-export";

const chapters = [
  {
    position: 2,
    title: "第二章 归途",
    content: "夜航结束。",
    status: "accepted",
    wordCount: 5,
  },
  {
    position: 1,
    title: "第一章 起航",
    content: "星舰起飞。",
    status: "accepted",
    wordCount: 5,
  },
  {
    position: 3,
    title: "第三章 草稿",
    content: "未入正史。",
    status: "candidate",
    wordCount: 5,
  },
];

describe("书稿导出", () => {
  it("只收已入正史章节并按章序排列；头部含书名/题材/统计", () => {
    const text = buildBookText({
      title: "雾灯航路",
      genre: "悬疑",
      premise: "守灯人世界",
      chapters,
    });
    expect(text).toContain("《雾灯航路》");
    expect(text).toContain("题材：悬疑");
    expect(text).toContain("简介：守灯人世界");
    expect(text).toContain("共 2 章 · 约 10 字");
    expect(text.indexOf("第一章 起航")).toBeLessThan(
      text.indexOf("第二章 归途"),
    );
    expect(text).not.toContain("第三章 草稿");
  });

  it("没有正史章节时输出可读提示", () => {
    const text = buildBookText({
      title: "空书",
      genre: "",
      premise: "",
      chapters: [],
    });
    expect(text).toContain("《空书》");
    expect(text).toContain("还没有已入正史的章节");
  });
});

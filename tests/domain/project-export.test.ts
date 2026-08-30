import { describe, expect, it } from "vitest";
import {
  novelAsMarkdown,
  novelAsText,
  parseNovelProject,
  safeExportName,
} from "../../src/domain/project-export";

const novel = {
  id: "n1",
  title: "星海:余烬",
  genre: "科幻",
  premise: "远航之后。",
  targetWords: 2000,
  targetChapters: 2,
  chapterWords: 1000,
  status: "writing" as const,
  createdAt: "",
  updatedAt: "",
};
const chapters = [
  {
    id: "c2",
    novelId: "n1",
    position: 2,
    volumeId: null,
    title: "第二章",
    outline: "",
    status: "draft" as const,
    targetWords: 1000,
    content: "归来。",
    wordCount: 3,
    updatedAt: "",
  },
  {
    id: "c1",
    novelId: "n1",
    position: 1,
    volumeId: null,
    title: "第一章",
    outline: "",
    status: "accepted" as const,
    targetWords: 1000,
    content: "启航。",
    wordCount: 3,
    updatedAt: "",
  },
];

describe("project export", () => {
  it("按章节顺序生成 Markdown 和 TXT", () => {
    expect(
      novelAsMarkdown(novel, [...chapters]).indexOf("第一章"),
    ).toBeLessThan(novelAsMarkdown(novel, [...chapters]).indexOf("第二章"));
    expect(novelAsText(novel, [...chapters])).toContain("启航。");
  });
  it("清理 Windows 文件名非法字符", () =>
    expect(safeExportName(novel.title)).toBe("星海_余烬"));
  it("拒绝错误格式和不完整数据包", () =>
    expect(() => parseNovelProject({ format: "other", version: 1 })).toThrow());
});

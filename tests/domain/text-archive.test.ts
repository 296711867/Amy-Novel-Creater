import { describe, expect, it } from "vitest";
import type { NovelProjectBundle } from "@domain/project-export";
import { buildTextArchiveEntries, encodeTextZip } from "@domain/text-archive";

const now = "2026-09-04T00:00:00.000Z";
const bundle = {
  format: "amy-novel-project",
  version: 1,
  exportedAt: now,
  novel: {
    id: "n1", title: "雾港：归航", genre: "悬疑", premise: "守灯人寻找失踪的船。",
    targetWords: 2000, targetChapters: 2, chapterWords: 1000, cycleSize: 10,
    status: "writing", createdAt: now, updatedAt: now,
  },
  chapters: [
    { id: "c2", novelId: "n1", position: 2, volumeId: null, title: "候选章", outline: "", status: "candidate", targetWords: 1000, content: "不应导出", wordCount: 4, updatedAt: now },
    { id: "c1", novelId: "n1", position: 1, volumeId: null, title: "灯塔", outline: "", status: "accepted", targetWords: 1000, content: "雾中亮起灯。", wordCount: 7, updatedAt: now },
  ],
  bible: [{ id: "b1", novelId: "n1", kind: "world", content: "午夜不得鸣笛", versionNo: 1, updatedAt: now }],
  entities: [], volumes: [], scenes: [], timeline: [], foreshadow: [], characterStates: [],
  usage: [], candidates: [], versions: [],
} satisfies NovelProjectBundle;

describe("分章文本 ZIP", () => {
  it("只把正史章节连同作品信息和设定拆成 TXT", () => {
    const entries = buildTextArchiveEntries(bundle);
    expect(entries.map((item) => item.name)).toEqual([
      "雾港：归航/00-作品信息.txt",
      "雾港：归航/01-作品设定.txt",
      "雾港：归航/章节/01-灯塔.txt",
    ]);
    expect(entries[1].content).toContain("午夜不得鸣笛");
    expect(entries.some((item) => item.content.includes("不应导出"))).toBe(false);
  });

  it("生成带 UTF-8 文件名的标准 ZIP 目录", () => {
    const entries = buildTextArchiveEntries(bundle), bytes = encodeTextZip(entries);
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(bytes.length - 12, true)).toBe(entries.length);
  });
});

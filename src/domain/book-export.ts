/**
 * AN-037 书稿导出：把已入正史的章节组装成可阅读/可发布的纯文本文稿。
 * 只收 accepted 章节（正史）；草稿与候选不进入导出。
 */

export interface BookExportChapter {
  position: number;
  title: string;
  content: string;
  status: string;
  wordCount: number;
}

export function buildBookText(input: {
  title: string;
  genre: string;
  premise: string;
  chapters: BookExportChapter[];
}): string {
  const accepted = [...input.chapters]
    .filter((item) => item.status === "accepted" && item.content.trim())
    .sort((a, b) => a.position - b.position);
  const totalWords = accepted.reduce((sum, item) => sum + item.wordCount, 0);
  const header = [
    `《${input.title}》`,
    `题材：${input.genre || "未分类"}`,
    input.premise ? `简介：${input.premise}` : "",
    `共 ${accepted.length} 章 · 约 ${totalWords.toLocaleString()} 字 · 导出于 ${new Date().toLocaleDateString()}`,
    "—".repeat(24),
  ]
    .filter(Boolean)
    .join("\n");
  if (!accepted.length)
    return `${header}\n\n（还没有已入正史的章节，先到生成工作台接受候选稿。）`;
  const body = accepted
    .map((item) => `【${item.title}】\n\n${item.content.trim()}`)
    .join("\n\n\n");
  return `${header}\n\n\n${body}\n`;
}

import { buildBookText } from "@domain/book-export";
import type { Chapter } from "@domain/novel";

/** 组装书稿并触发浏览器下载（只导出已入正史章节）。 */
export function downloadBookFile(
  novel: { title: string; genre: string; premise: string },
  chapters: Chapter[],
) {
  const text = buildBookText({
    title: novel.title,
    genre: novel.genre,
    premise: novel.premise,
    chapters,
  });
  const accepted = chapters.filter(
    (item) => item.status === "accepted" && item.content.trim(),
  ).length;
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `《${novel.title}》${accepted}章.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
}

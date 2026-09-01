import type { Chapter } from "./novel";

/**
 * AN-034 全局微调：全书范围内的确定性查找与替换预览。
 *
 * 只做纯文本匹配与替换；应用必须逐章确认并创建版本快照（saveChapter
 * createSnapshot），由 UI 层把关。此处不碰记忆——正文修订后相关正史
 * 记忆的失效传播属 AN-021。
 */

export interface ChapterSearchMatch {
  chapterId: string;
  position: number;
  title: string;
  count: number;
  /** 首个命中的上下文片段（前/命中/后），用于人工确认替换范围。 */
  preview: { before: string; hit: string; after: string };
}

/** 查找词去空白后至少 1 个字符（单字替换合法：逐章确认 + 版本快照兜底）。 */
export const MIN_REVISION_QUERY = 1;

const CLIP = 24;

export function globalSearchChapters(
  chapters: Chapter[],
  query: string,
): ChapterSearchMatch[] {
  const needle = query.trim();
  if (needle.length < MIN_REVISION_QUERY) return [];
  const matches: ChapterSearchMatch[] = [];
  for (const chapter of [...chapters].sort((a, b) => a.position - b.position)) {
    const index = chapter.content.indexOf(needle);
    if (index < 0) continue;
    let count = 0,
      cursor = 0;
    while (true) {
      const at = chapter.content.indexOf(needle, cursor);
      if (at < 0) break;
      count++;
      cursor = at + needle.length;
    }
    matches.push({
      chapterId: chapter.id,
      position: chapter.position,
      title: chapter.title,
      count,
      preview: {
        before: chapter.content.slice(Math.max(0, index - CLIP), index),
        hit: needle,
        after: chapter.content.slice(
          index + needle.length,
          index + needle.length + CLIP,
        ),
      },
    });
  }
  return matches;
}

export function replaceAllInContent(
  content: string,
  query: string,
  replacement: string,
): { content: string; count: number } {
  const needle = query.trim();
  if (needle.length < MIN_REVISION_QUERY || needle === replacement)
    return { content, count: 0 };
  let count = 0,
    cursor = 0,
    result = "";
  while (true) {
    const at = content.indexOf(needle, cursor);
    if (at < 0) break;
    result += content.slice(cursor, at) + replacement;
    cursor = at + needle.length;
    count++;
  }
  return { content: result + content.slice(cursor), count };
}

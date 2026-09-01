import { platform } from "@renderer/platform/web-platform";
import type { NovelStateGet, NovelStateSet } from "./utils";
import {
  checkGlobalConsistency,
} from "@domain/global-consistency";
import { replaceAllInContent } from "@domain/revision";

export function createGlobalReviewActions(set: NovelStateSet, get: NovelStateGet) {
  return {
  async collectGlobalErrors(novelId) {
    if (!get().chapters[novelId]) await get().loadChapters(novelId);
    if (!get().entities[novelId]) await get().loadEntities(novelId);
    if (!get().timelineEvents[novelId] || !get().foreshadowThreads[novelId] ||
        !get().characterStates[novelId])
      await get().loadContinuity(novelId);
    const findings = checkGlobalConsistency({
      chapters: get().chapters[novelId] ?? [],
      entities: get().entities[novelId] ?? [],
      timeline: get().timelineEvents[novelId] ?? [],
      foreshadow: get().foreshadowThreads[novelId] ?? [],
      characterStates: get().characterStates[novelId] ?? [],
    });
    return findings
      .filter((item) => item.severity === "error")
      .map((item) => item.message);
  },
  async loadGlobalFindings(novelId) {
    const findings = await platform.listGlobalFindings(novelId);
    set({ globalFindings: { ...get().globalFindings, [novelId]: findings } });
    return findings;
  },
  async runGlobalConsistencyCheck(novelId) {
    await get().collectGlobalErrors(novelId); // 确保数据已装载
    const ruleFindings = checkGlobalConsistency({
        chapters: get().chapters[novelId] ?? [],
        entities: get().entities[novelId] ?? [],
        timeline: get().timelineEvents[novelId] ?? [],
        foreshadow: get().foreshadowThreads[novelId] ?? [],
        characterStates: get().characterStates[novelId] ?? [],
      }),
      previous = get().globalFindings[novelId] ??
        (await platform.listGlobalFindings(novelId)),
      dismissed = new Set(
        previous
          .filter((item) => item.status === "dismissed")
          .map((item) => item.id),
      ),
      aiFindings = previous.filter((item) => item.source !== "rule"),
      merged = [
        ...ruleFindings.map((item) => ({
          ...item,
          status: dismissed.has(item.id)
            ? ("dismissed" as const)
            : item.status,
        })),
        ...aiFindings,
      ];
    const saved = await platform.saveGlobalFindings(novelId, merged);
    set({ globalFindings: { ...get().globalFindings, [novelId]: saved } });
    return saved;
  },
  async runGlobalReview(novelId) {
    await platform.reviewGlobalConsistency(novelId);
    // 审查会写入新的 AI 发现与设定修复提案，两处都刷新。
    await Promise.all([
      get().loadGlobalFindings(novelId),
      get().loadPlanningProposals(novelId),
    ]);
  },
  async runWholeBookReview(novelId, windowSize) {
    await platform.reviewWholeBook(novelId, windowSize ? { windowSize } : undefined);
    await get().loadGlobalFindings(novelId);
  },
  async dismissGlobalFinding(novelId, id) {
    const previous = get().globalFindings[novelId] ?? [],
      updated = previous.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "dismissed" as const,
            }
          : item,
      );
    const saved = await platform.saveGlobalFindings(novelId, updated);
    set({ globalFindings: { ...get().globalFindings, [novelId]: saved } });
  },
  async addAuthorFinding(novelId, position, message) {
    const text = message.trim();
    if (!text) throw new Error("疑点内容不能为空");
    const previous =
      get().globalFindings[novelId] ??
      (await platform.listGlobalFindings(novelId));
    const now = new Date().toISOString();
    const saved = await platform.saveGlobalFindings(novelId, [
      ...previous,
      {
        id: `author:${now}:${position}`,
        novelId,
        source: "author",
        severity: "warning",
        category: "consistency",
        message: text,
        evidence: `第 ${position} 章连读标记`,
        chapterPosition: position,
        status: "open",
        createdAt: now,
      },
    ]);
    set({ globalFindings: { ...get().globalFindings, [novelId]: saved } });
  },
  async reviseChapterContent(chapterId, query, replacement) {
    const chapter = await get().getChapter(chapterId);
    if (!chapter) throw new Error("章节不存在");
    const { content, count } = replaceAllInContent(
      chapter.content,
      query,
      replacement,
    );
    if (!count) return { count: 0 };
    await platform.saveChapter({
      chapterId,
      title: chapter.title,
      outline: chapter.outline,
      content,
      createSnapshot: true,
      origin: "manual",
    });
    await get().loadChapters(chapter.novelId);
    return { count };
  },
  };
}

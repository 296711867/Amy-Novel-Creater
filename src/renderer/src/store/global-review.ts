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
  /** AN-035：清理悬空正史状态（引用不存在实体的孤儿记录），返回清理条数。 */
  async cleanupDanglingStates(novelId) {
    if (!get().entities[novelId]) await get().loadEntities(novelId);
    if (!get().characterStates[novelId]) await get().loadContinuity(novelId);
    const entityIds = new Set(
      (get().entities[novelId] ?? []).map((item: { id: string }) => item.id),
    );
    const dangling = (get().characterStates[novelId] ?? [])
      .filter((item: { characterId: string }) => !entityIds.has(item.characterId))
      .map((item: { id: string }) => item.id);
    for (const id of dangling) await get().deleteCharacterState(novelId, id);
    await get().loadContinuity(novelId);
    return dangling.length;
  },
  /**
   * AN-035 周期封存时的自动记忆清理：只清确定性垃圾，不做语义判断——
   * ① 悬空状态（引用不存在实体）；② 同人物同章内容完全相同的重复状态；
   * ③ 同名且同埋设章的重复伏笔（保留一条）；④ 同章同名同文的重复时间线。
   * 伪伏笔废弃等语义决策仍归作者（故事总览手动批量处理）。
   */
  async autoCleanupMemory(novelId) {
    if (!get().entities[novelId]) await get().loadEntities(novelId);
    if (!get().characterStates[novelId] || !get().foreshadowThreads[novelId] ||
        !get().timelineEvents[novelId])
      await get().loadContinuity(novelId);
    const entityIds = new Set(
      (get().entities[novelId] ?? []).map((item: { id: string }) => item.id),
    );
    const states = get().characterStates[novelId] ?? [];
    // 悬空 + 重复状态：同 characterId+chapterId+summary 只留最早一条。
    const seenState = new Set<string>();
    let stateCount = 0;
    for (const state of [...states].sort((a: { createdAt: string }, b: { createdAt: string }) =>
      a.createdAt < b.createdAt ? -1 : 1,
    )) {
      const dangling = !entityIds.has(state.characterId);
      const key = `${state.characterId}:${state.chapterId ?? ""}:${state.summary}`;
      if (dangling || seenState.has(key)) {
        await get().deleteCharacterState(novelId, state.id);
        stateCount++;
      } else seenState.add(key);
    }
    // 重复伏笔：同标题 + 同埋设章（含都为空）只留最早一条。
    const seenThread = new Set<string>();
    let threadCount = 0;
    for (const thread of [...(get().foreshadowThreads[novelId] ?? [])].sort(
      (a: { createdAt: string }, b: { createdAt: string }) =>
        a.createdAt < b.createdAt ? -1 : 1,
    )) {
      const key = `${thread.title.trim()}:${thread.setupChapterId ?? ""}`;
      if (seenThread.has(key)) {
        await get().deleteForeshadow(novelId, thread.id);
        threadCount++;
      } else seenThread.add(key);
    }
    // 重复时间线：同章 + 同标题 + 同详情只留最早一条。
    const seenEvent = new Set<string>();
    let eventCount = 0;
    for (const event of [...(get().timelineEvents[novelId] ?? [])].sort(
      (a: { createdAt: string }, b: { createdAt: string }) =>
        a.createdAt < b.createdAt ? -1 : 1,
    )) {
      const key = `${event.chapterId ?? ""}:${event.title}:${event.detail}`;
      if (seenEvent.has(key)) {
        await get().deleteTimeline(novelId, event.id);
        eventCount++;
      } else seenEvent.add(key);
    }
    await get().loadContinuity(novelId);
    return { states: stateCount, foreshadow: threadCount, timeline: eventCount };
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

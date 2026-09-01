import type { Chapter } from "@domain/novel";
import type { StoryEntity } from "@domain/story-bible";
import type {
  CharacterState,
  ForeshadowThread,
  TimelineEvent,
} from "@domain/continuity";
import type { GlobalFinding } from "@domain/global-consistency";
import type { NewGenerationEvent } from "@domain/generation";
import type { SaveUsageInput } from "@domain/usage";
import {
  bookReviewWindowPrompt,
  buildBookWindows,
  characterDigestText,
  parseBookReviewWindow,
} from "@domain/whole-book-review";

/**
 * AN-032 全书分窗口通读审稿编排（Web/Electron 共享）。
 *
 * 顺序窗口 + 滚动摘要逐窗调用模型；每窗口留痕事件与用量；发现以
 * `book:` 前缀落 global_findings，重跑整体替换上一轮通读结果（忽略
 * 状态延续）。两端只负责装配数据源与模型调用。
 */

export interface WholeBookModelResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

export interface WholeBookReviewDeps {
  novel: { title: string; genre: string };
  profile: { provider: string; modelId: string; contextWindow: number };
  listChapters(novelId: string): Promise<Chapter[]>;
  listStoryEntities(novelId: string): Promise<StoryEntity[]>;
  listCharacterStates(novelId: string): Promise<CharacterState[]>;
  listTimelineEvents(novelId: string): Promise<TimelineEvent[]>;
  listForeshadowThreads(novelId: string): Promise<ForeshadowThread[]>;
  listGlobalFindings(novelId: string): Promise<GlobalFinding[]>;
  saveGlobalFindings(
    novelId: string,
    findings: GlobalFinding[],
  ): Promise<unknown>;
  saveUsage(input: SaveUsageInput): Promise<unknown>;
  saveGenerationEvent?(event: NewGenerationEvent): Promise<unknown>;
  callModel(prompt: string): Promise<WholeBookModelResult>;
}

export async function runWholeBookReview(
  novelId: string,
  options: { windowSize?: number } | undefined,
  deps: WholeBookReviewDeps,
): Promise<{ windows: number; findings: GlobalFinding[] }> {
  const [chapters, entities, characterStates, timeline, foreshadow] =
    await Promise.all([
      deps.listChapters(novelId),
      deps.listStoryEntities(novelId),
      deps.listCharacterStates(novelId),
      deps.listTimelineEvents(novelId),
      deps.listForeshadowThreads(novelId),
    ]);
  const windows = buildBookWindows(chapters, options?.windowSize ?? 5);
  if (!windows.length) throw new Error("还没有已入正史的章节可审读");

  const batchId = `book-review:${novelId}`,
    digest = characterDigestText(entities, characterStates, timeline, foreshadow),
    knownIssues = (await deps.listGlobalFindings(novelId))
      .filter((item) => item.status === "open")
      .map((item) => item.message),
    inputBudget = Math.max(
      6000,
      Math.min(30000, deps.profile.contextWindow - 4000),
    );
  const emit = async (
    level: "info" | "success" | "warning",
    message: string,
    data: Record<string, unknown> = {},
  ) => {
    try {
      await deps.saveGenerationEvent?.({
        batchId,
        novelId,
        chapterId: null,
        stage: "global_review",
        level,
        message,
        data,
      });
    } catch {
      // 过程事件失败不影响审稿本体。
    }
  };

  let rolling = "";
  const collected: GlobalFinding[] = [];
  await emit(
    "info",
    `全书通读审稿开始：${windows.length} 个窗口（输入预算 ≤ ${(windows.length * inputBudget).toLocaleString()} tokens，模型 ${deps.profile.modelId}）`,
    { windows: windows.length, model: deps.profile.modelId },
  );
  for (const window of windows) {
    const prompt = bookReviewWindowPrompt({
      novelTitle: deps.novel.title,
      genre: deps.novel.genre,
      windowIndex: window.index,
      windowCount: windows.length,
      windowChapters: window.chapters,
      rollingSummary: rolling,
      characterDigest: digest,
      knownIssues,
      inputBudget,
    });
    const result = await deps.callModel(prompt);
    const outcome = parseBookReviewWindow(result.content, {
      novelId,
      windowIndex: window.index,
    });
    rolling = outcome.summary || rolling;
    collected.push(...outcome.findings);
    await deps.saveUsage({
      novelId,
      chapterId: null,
      operation: "global_review",
      provider: deps.profile.provider,
      model: deps.profile.modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cachedTokens: result.cachedTokens,
      cost: null,
      measurement: result.inputTokens ? "provider" : "estimated",
    });
    await emit(
      "info",
      `通读第 ${window.start}–${window.end} 章完成：${outcome.findings.length} 项发现`,
      { window: window.index, findings: outcome.findings.length },
    );
  }

  // book:* 发现整体替换上一轮通读结果（忽略状态延续）；规则发现、作者
  // 疑点与单次全局审查的 ai 发现原样保留。同一问题跨窗口重复上报按
  // 稳定 id 去重（saveGlobalFindings 以 id 为主键整批写入）。
  const deduped = [...new Map(collected.map((item) => [item.id, item])).values()];
  const previous = await deps.listGlobalFindings(novelId),
    dismissed = new Set(
      previous.filter((item) => item.status === "dismissed").map((item) => item.id),
    ),
    fresh = deduped.map((item) => ({
      ...item,
      status: dismissed.has(item.id) ? ("dismissed" as const) : item.status,
    })),
    merged = [
      ...previous.filter((item) => !item.id.startsWith("book:")),
      ...fresh,
    ];
  await deps.saveGlobalFindings(novelId, merged);
  await emit(
    deduped.some((item) => item.severity === "error") ? "warning" : "success",
    `全书通读审稿完成：共 ${deduped.length} 项发现（${windows.length} 个窗口）`,
    { windows: windows.length, findings: deduped.length },
  );
  return { windows: windows.length, findings: fresh };
}

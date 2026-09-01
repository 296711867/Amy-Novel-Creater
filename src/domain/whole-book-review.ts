import { z } from "zod";
import type { Chapter } from "./novel";
import type { CharacterState, ForeshadowThread, TimelineEvent } from "./continuity";
import type { StoryEntity } from "./story-bible";
import type { GlobalFinding } from "./global-consistency";

/**
 * AN-032 全书分窗口 AI 通读审稿。
 *
 * 整书正文一次塞不进上下文，也不利于抓“跨章呼应”：按窗口（默认 5 章）
 * 顺序通读，每窗口携带前序窗口的滚动摘要，产出带章节定位的发现。
 * 发现以 `book:` 前缀 id 落 global_findings（source=ai），重跑整书审稿
 * 时整体替换上一轮 book:* 发现（忽略状态延续）。
 */

export interface BookWindow {
  index: number;
  start: number;
  end: number;
  chapters: Chapter[];
}

export function buildBookWindows(
  chapters: Chapter[],
  windowSize = 5,
): BookWindow[] {
  const accepted = [...chapters]
    .filter((item) => item.status === "accepted" && item.content.trim())
    .sort((a, b) => a.position - b.position);
  const windows: BookWindow[] = [];
  for (let index = 0; index < accepted.length; index += windowSize) {
    const slice = accepted.slice(index, index + windowSize);
    windows.push({
      index: windows.length,
      start: slice[0].position,
      end: slice[slice.length - 1].position,
      chapters: slice,
    });
  }
  return windows;
}

export interface BookReviewWindowInput {
  novelTitle: string;
  genre: string;
  windowIndex: number;
  windowCount: number;
  windowChapters: Chapter[];
  /** 前序窗口的滚动摘要（首个窗口为空）。 */
  rollingSummary: string;
  /** 出场人物速览：名字 + 最新状态摘要（本地聚合，零 token）。 */
  characterDigest: string;
  /** 已有的未忽略发现消息（避免重复报旧问题）。 */
  knownIssues: string[];
  /** 本窗口输入预算（token）。 */
  inputBudget: number;
}

const clip = (value: string, length: number) =>
  value.length > length ? `${value.slice(0, length - 1)}…` : value;

export function bookReviewWindowPrompt(input: BookReviewWindowInput): string {
  const sections: string[] = [];
  sections.push(
    `你是长篇小说《${input.novelTitle}》（${input.genre}）的连贯性审稿人，正在通读全书。`,
    `当前读到第 ${input.windowIndex + 1}/${input.windowCount} 个窗口（第 ${input.windowChapters[0].position}–${input.windowChapters[input.windowChapters.length - 1].position} 章）。`,
  );
  if (input.rollingSummary)
    sections.push(`\n【前文摘要】\n${clip(input.rollingSummary, 1600)}`);
  if (input.characterDigest)
    sections.push(`\n【人物速览（最新状态）】\n${clip(input.characterDigest, 1600)}`);
  if (input.knownIssues.length)
    sections.push(
      `\n【已知问题（不要重复上报）】\n${input.knownIssues.slice(0, 20).map((item) => `- ${clip(item, 80)}`).join("\n")}`,
    );
  sections.push(
    "\n【本窗口正文】逐章通读，只报告跨章与全局层面的问题：前后矛盾（年龄/身份/时间线/位置/道具归属）、重复桥段或描写、设定冲突、伏笔提及但从未回收、人物行为动机断裂、文风明显漂移。不要报告单章内部的修辞问题。",
    "输出 JSON：{\"summary\":\"本窗口剧情摘要（≤300字，供下个窗口续读）\",\"notes\":[{\"severity\":\"error|warning\",\"category\":\"timeline|character|foreshadow|consistency\",\"chapterPosition\":N,\"message\":\"问题一句话（含对象名）\",\"evidence\":\"出处摘录\",\"suggestion\":\"修复建议（可选）\"}]}；notes 最多 12 条，没有问题输出空数组。",
  );
  // 正文按窗口均分预算，标题与说明另计。
  const overhead = sections.join("\n").length;
  const contentBudget = Math.max(1200, input.inputBudget * 3 - overhead);
  const perChapter = Math.floor(contentBudget / input.windowChapters.length);
  sections.push(
    "\n" +
      input.windowChapters
        .map(
          (chapter) =>
            `### 第${chapter.position}章 ${chapter.title}\n${clip(chapter.content, perChapter)}`,
        )
        .join("\n\n"),
  );
  return sections.join("\n");
}

const noteSchema = z.object({
  severity: z.enum(["error", "warning"]).default("warning"),
  category: z
    .enum(["timeline", "character", "foreshadow", "consistency"])
    .default("consistency"),
  chapterPosition: z.coerce.number().int().min(0).default(0),
  message: z.string().min(1),
  evidence: z.string().default(""),
  suggestion: z.string().default(""),
});

const windowResponse = z.object({
  summary: z.string().default(""),
  notes: z.array(noteSchema).max(12).default([]),
});

export interface BookReviewWindowOutcome {
  summary: string;
  findings: GlobalFinding[];
}

function stableId(prefix: string, parts: string[]): string {
  let hash = 0;
  const source = parts.join("|");
  for (let index = 0; index < source.length; index++)
    hash = (hash * 31 + source.charCodeAt(index)) | 0;
  return `${prefix}:${(hash >>> 0).toString(36)}`;
}

/** 解析单窗口审稿响应；raw 必须是 JSON 文本。 */
export function parseBookReviewWindow(
  raw: string,
  context: { novelId: string; windowIndex: number },
): BookReviewWindowOutcome {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = windowResponse.parse(JSON.parse(text));
  const now = new Date().toISOString();
  const findings: GlobalFinding[] = [];
  const seen = new Set<string>();
  for (const note of parsed.notes) {
    // id 含章节定位与消息：同一问题重跑保持稳定，同窗口复述去重。
    const id = stableId("book", [String(note.chapterPosition), note.message]);
    if (seen.has(id)) continue;
    seen.add(id);
    findings.push({
      id,
      novelId: context.novelId,
      source: "ai",
      severity: note.severity,
      category: note.category,
      message: note.message,
      evidence: note.evidence || `第 ${note.chapterPosition} 章通读发现`,
      suggestion: note.suggestion || undefined,
      targetKind: "chapter",
      chapterPosition: note.chapterPosition || undefined,
      status: "open",
      createdAt: now,
    });
  }
  return { summary: parsed.summary, findings };
}

/** 窗口审稿需要的人物速览（每人物最新一条状态）。 */
export function characterDigestText(
  entities: StoryEntity[],
  characterStates: CharacterState[],
  timeline: TimelineEvent[],
  foreshadow: ForeshadowThread[],
): string {
  const entityById = new Map(entities.map((item) => [item.id, item]));
  const latest = new Map<string, CharacterState>();
  for (const state of [...characterStates].sort((a, b) =>
    (a.chapterId ?? "") < (b.chapterId ?? "") ? -1 : 1,
  )) {
    const name = entityById.get(state.characterId)?.name;
    if (name) latest.set(name, state);
  }
  const lines: string[] = [];
  for (const [name, state] of latest)
    lines.push(`- ${name}：${clip(state.summary, 80)}`);
  if (timeline.length)
    lines.push(
      `- 时间线尾部：${clip(
        timeline[timeline.length - 1].title + "——" + timeline[timeline.length - 1].detail,
        100,
      )}`,
    );
  const openThreads = foreshadow.filter(
    (item) => item.status !== "resolved" && item.status !== "abandoned",
  );
  if (openThreads.length)
    lines.push(
      `- 未回收伏笔（${openThreads.length} 条）：${openThreads
        .slice(0, 12)
        .map((item) => clip(item.title, 20))
        .join("、")}`,
    );
  return lines.join("\n");
}

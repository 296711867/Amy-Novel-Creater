import type { Novel, Chapter, ChapterVersion } from "./novel";
import type { BibleSection, StoryEntity } from "./story-bible";
import type { StoryVolume, StoryScene } from "./story-structure";
import type {
  TimelineEvent,
  ForeshadowThread,
  CharacterState,
} from "./continuity";
import type { UsageRecord } from "./usage";
import type { ChapterCandidate } from "./chapter-generation";
import { z } from "zod";

export interface NovelProjectBundle {
  format: "amy-novel-project";
  version: 1;
  exportedAt: string;
  novel: Novel;
  chapters: Chapter[];
  versions: ChapterVersion[];
  bible: BibleSection[];
  entities: StoryEntity[];
  volumes: StoryVolume[];
  scenes: StoryScene[];
  timeline: TimelineEvent[];
  foreshadow: ForeshadowThread[];
  characterStates: CharacterState[];
  usage: UsageRecord[];
  candidates: ChapterCandidate[];
}

export function novelAsMarkdown(novel: Novel, chapters: Chapter[]): string {
  const body = chapters
    .sort((a, b) => a.position - b.position)
    .map((ch) => `## ${ch.title}\n\n${ch.content.trim()}`)
    .join("\n\n---\n\n");
  return `# ${novel.title}\n\n> 题材：${novel.genre}\n\n${novel.premise.trim()}\n\n---\n\n${body}\n`;
}
export function novelAsText(novel: Novel, chapters: Chapter[]): string {
  const body = chapters
    .sort((a, b) => a.position - b.position)
    .map((ch) => `${ch.title}\r\n\r\n${ch.content.trim()}`)
    .join("\r\n\r\n====================\r\n\r\n");
  return `${novel.title}\r\n题材：${novel.genre}\r\n\r\n${novel.premise.trim()}\r\n\r\n====================\r\n\r\n${body}\r\n`;
}
export function safeExportName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, "_").trim() || "未命名小说";
}

const text = z.string(),
  nullableText = text.nullable(),
  strings = z.array(text);
const novelSchema = z.object({
  id: text,
  title: text.min(1),
  genre: text,
  premise: text,
  targetWords: z.number(),
  targetChapters: z.number().int().positive(),
  chapterWords: z.number().positive(),
  status: z.enum(["planning", "writing", "paused", "completed", "archived"]),
  createdAt: text,
  updatedAt: text,
});
const chapterSchema = z.object({
  id: text,
  novelId: text,
  position: z.number().int().positive(),
  volumeId: nullableText,
  title: text,
  outline: text,
  status: z.enum([
    "planned",
    "generating",
    "candidate",
    "draft",
    "accepted",
    "needs_review",
  ]),
  targetWords: z.number(),
  content: text,
  wordCount: z.number(),
  updatedAt: text,
});
const versionSchema = z.object({
  id: text,
  chapterId: text,
  versionNo: z.number().int().positive(),
  origin: z.enum(["manual", "autosave", "ai", "accepted"]),
  content: text,
  wordCount: z.number(),
  createdAt: text,
});
const bibleSchema = z.object({
  id: text,
  novelId: text,
  kind: z.enum(["intent", "world", "style", "boundaries"]),
  content: text,
  versionNo: z.number(),
  updatedAt: text,
});
const entitySchema = z.object({
  id: text,
  novelId: text,
  type: z.enum(["character", "location", "organization", "item", "term"]),
  name: text,
  summary: text,
  aliases: strings,
  profile: z.record(text, text),
  status: z.enum(["active", "inactive"]),
  createdAt: text,
  updatedAt: text,
});
const volumeSchema = z.object({
  id: text,
  novelId: text,
  position: z.number(),
  title: text,
  outline: text,
  createdAt: text,
  updatedAt: text,
});
const sceneSchema = z.object({
  id: text,
  chapterId: text,
  position: z.number(),
  title: text,
  summary: text,
  viewpoint: text,
  location: text,
  targetWords: z.number(),
  createdAt: text,
  updatedAt: text,
});
const timelineSchema = z.object({
  id: text,
  novelId: text,
  chapterId: nullableText,
  storyTime: text,
  title: text,
  detail: text,
  participantIds: strings,
  source: z.enum(["manual", "accepted_chapter", "ai_candidate"]),
  createdAt: text,
  updatedAt: text,
});
const foreshadowSchema = z.object({
  id: text,
  novelId: text,
  title: text,
  detail: text,
  setupChapterId: nullableText,
  payoffChapterId: nullableText,
  status: z.enum(["planned", "planted", "developing", "resolved", "abandoned"]),
  source: z.enum(["manual", "accepted_chapter", "ai_candidate"]),
  createdAt: text,
  updatedAt: text,
});
const stateSchema = z.object({
  id: text,
  novelId: text,
  characterId: text,
  chapterId: nullableText,
  summary: text,
  location: text,
  physical: text,
  emotional: text,
  knowledge: strings,
  goals: strings,
  inventory: strings,
  source: z.enum(["manual", "accepted_chapter", "ai_candidate"]),
  createdAt: text,
  updatedAt: text,
});
const usageSchema = z.object({
  id: text,
  novelId: text,
  chapterId: nullableText,
  operation: z.enum(["context_build", "generation", "continuity_check"]),
  provider: text,
  model: text,
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedTokens: z.number(),
  cost: z.number().nullable(),
  measurement: z.enum(["estimated", "provider"]),
  createdAt: text,
});
const candidateSchema = z.object({
  id: text,
  novelId: text,
  chapterId: text,
  profileId: text,
  contextHash: text,
  content: text,
  wordCount: z.number(),
  status: z.enum(["candidate", "accepted", "rejected"]),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedTokens: z.number(),
  createdAt: text,
  updatedAt: text,
});
const bundleSchema = z.object({
  format: z.literal("amy-novel-project"),
  version: z.literal(1),
  exportedAt: text,
  novel: novelSchema,
  chapters: z.array(chapterSchema).min(1),
  versions: z.array(versionSchema),
  bible: z.array(bibleSchema),
  entities: z.array(entitySchema),
  volumes: z.array(volumeSchema),
  scenes: z.array(sceneSchema),
  timeline: z.array(timelineSchema),
  foreshadow: z.array(foreshadowSchema),
  characterStates: z.array(stateSchema),
  usage: z.array(usageSchema),
  candidates: z.array(candidateSchema),
});
export function parseNovelProject(value: unknown): NovelProjectBundle {
  return bundleSchema.parse(value);
}

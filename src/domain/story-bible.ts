export type BibleSectionKind = "intent" | "world" | "style" | "boundaries";
export type StoryEntityType =
  "character" | "location" | "organization" | "item" | "term";

export interface BibleSection {
  id: string;
  novelId: string;
  kind: BibleSectionKind;
  content: string;
  versionNo: number;
  updatedAt: string;
}

export interface StoryEntity {
  id: string;
  novelId: string;
  type: StoryEntityType;
  name: string;
  summary: string;
  aliases: string[];
  profile: Record<string, string>;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
}

export interface SaveBibleSectionInput {
  novelId: string;
  kind: BibleSectionKind;
  content: string;
}

export interface SaveStoryEntityInput {
  id?: string;
  novelId: string;
  type: StoryEntityType;
  name: string;
  summary: string;
  aliases: string[];
  profile: Record<string, string>;
}

export const BIBLE_SECTION_LABELS: Record<BibleSectionKind, string> = {
  intent: "创作意图",
  world: "世界观",
  style: "文风圣经",
  boundaries: "创作边界",
};

export const ENTITY_TYPE_LABELS: Record<StoryEntityType, string> = {
  character: "角色",
  location: "地点",
  organization: "势力",
  item: "物品",
  term: "术语",
};

export function normalizeAliases(aliases: string[]): string[] {
  return [...new Set(aliases.map((item) => item.trim()).filter(Boolean))];
}

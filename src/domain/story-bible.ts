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

// 人物分层：卡片强度、上下文注入与正史追踪策略都由 tier 决定（见
// docs/AUTOPILOT_DESIGN.md §3）。tier 存于 character 实体的 profile.tier。
export type CharacterTier = "protagonist" | "support" | "recurring" | "extra";
export const CHARACTER_TIER_LABELS: Record<CharacterTier, string> = {
  protagonist: "主角",
  support: "核心配角",
  recurring: "酱油人物",
  extra: "跑龙套",
};
export const CHARACTER_TIERS = Object.keys(
  CHARACTER_TIER_LABELS,
) as CharacterTier[];
export function characterTierOf(entity: StoryEntity): CharacterTier | null {
  if (entity.type !== "character") return null;
  const tier = entity.profile.tier as CharacterTier | undefined;
  return CHARACTER_TIERS.includes(tier as CharacterTier)
    ? (tier as CharacterTier)
    : null;
}
// 酱油人物仅当章纲/章题提及才注入；跑龙套不进上下文与正史。
export function isCharacterRelevant(
  entity: StoryEntity,
  chapterText: string,
): boolean {
  const tier = characterTierOf(entity);
  if (tier === "extra") return false;
  if (tier === "protagonist" || tier === "support" || tier === null)
    return true;
  return mentions(chapterText, entity);
}
export function mentions(text: string, entity: StoryEntity): boolean {
  return (
    text.includes(entity.name) ||
    entity.aliases.some((alias) => alias.trim() && text.includes(alias.trim()))
  );
}

import type { StoryEntity } from "./story-bible";

// 场景卡约定：location 实体的 profile 携带功能场景字段（见
// docs/AUTOPILOT_DESIGN.md §4）。视觉锚点保证同一场景多次出现时描写一致。
export interface SceneCard {
  purpose: string;
  mood: string;
  visualAnchors: string[];
  residents: string;
  dangerLevel: string;
}
export const SCENE_CARD_FIELDS = [
  "purpose",
  "mood",
  "visualAnchors",
  "residents",
  "dangerLevel",
] as const;
export function parseSceneCard(entity: StoryEntity): SceneCard | null {
  if (entity.type !== "location") return null;
  const raw = entity.profile.visualAnchors;
  const anchors = Array.isArray(raw)
    ? raw.map(String)
    : String(raw ?? "")
        .split(/[、,，;；\n]/)
        .map((item) => item.trim())
        .filter(Boolean);
  if (!entity.profile.purpose && !anchors.length) return null;
  return {
    purpose: String(entity.profile.purpose ?? ""),
    mood: String(entity.profile.mood ?? ""),
    visualAnchors: anchors,
    residents: String(entity.profile.residents ?? ""),
    dangerLevel: String(entity.profile.dangerLevel ?? ""),
  };
}
export function sceneCardText(entity: StoryEntity): string | null {
  const card = parseSceneCard(entity);
  if (!card) return null;
  return [
    `功能：${card.purpose}`,
    card.mood && `氛围：${card.mood}`,
    card.visualAnchors.length &&
      `视觉锚点（每次出现必须保留）：${card.visualAnchors.join("、")}`,
    card.residents && `常驻人物：${card.residents}`,
    card.dangerLevel && `危险等级：${card.dangerLevel}`,
  ]
    .filter(Boolean)
    .join("\n");
}

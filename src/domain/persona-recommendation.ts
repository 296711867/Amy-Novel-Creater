import { z } from "zod";
import type { BibleSection, StoryEntity } from "./story-bible";
import { characterTierOf, CHARACTER_TIER_LABELS, type CharacterTier } from "./story-bible";
import type { Novel } from "./novel";
import { getTemplate, renderTemplate } from "./prompt-templates";

/** 一次推荐整个人物阵容；作者逐个调整后批量确认才写入正式设定。 */
export interface PersonaSuggestion {
  entityName: string;
  tier: CharacterTier;
  /** 主角/核心配角：完整人格模型；常驻次要人物：简化性格标签。 */
  personaType: string;
  reason: string;
  writingConstraints: string;
  speechHabit: string;
}

export function personaRecommendationMaxOutputTokens(): number {
  return 3200;
}

function characterLines(characters: StoryEntity[]): string {
  return characters
    .filter((item) => item.type === "character")
    .map((item) => {
      const tier = characterTierOf(item);
      return `- ${item.name}（${tier ? CHARACTER_TIER_LABELS[tier] : "未分层"}）：${item.summary}${
        item.profile["人格"] ? `；已有人格：${item.profile["人格"]}` : ""
      }`;
    })
    .join("\n");
}

export function personaRecommendationPrompt(input: {
  novel: Novel;
  bible: BibleSection[];
  characters: StoryEntity[];
}): string {
  return renderTemplate(getTemplate("persona_recommendation"), {
    title: input.novel.title,
    genre: input.novel.genre,
    premise: input.novel.premise,
    bible: input.bible.map((item) => item.content.trim()).filter(Boolean).join("\n\n") || "暂无",
    characters: characterLines(input.characters) || "暂无人物",
  }).text;
}

const suggestion = z.object({
  name: z.string().min(1),
  personaType: z.string().min(1),
  reason: z.string().default(""),
  writingConstraints: z.string().default(""),
  speechHabit: z.string().default(""),
});
const response = z.object({
  recommendations: z.array(suggestion).max(40),
});

export function parsePersonaRecommendation(
  raw: string,
  characters: StoryEntity[],
): PersonaSuggestion[] {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const parsed = response.parse(JSON.parse(text));
  const byName = new Map(
    characters
      .filter((item) => item.type === "character")
      .flatMap((item) =>
        [item.name, ...item.aliases].map((name) => [name, item] as const),
      ),
  );
  return parsed.recommendations.flatMap((item) => {
    const entity = byName.get(item.name.trim());
    const tier = entity ? characterTierOf(entity) : null;
    // 未知人物与跑龙套不进入人格阵容：主角/核心配角完整模型，酱油简化标签。
    if (!entity || !tier || tier === "extra") return [];
    return [
      {
        entityName: entity.name,
        tier,
        personaType: item.personaType.trim(),
        reason: item.reason.trim(),
        writingConstraints: item.writingConstraints.trim(),
        speechHabit: item.speechHabit.trim(),
      },
    ];
  });
}

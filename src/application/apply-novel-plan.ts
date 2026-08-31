import type {
  Chapter,
  CreateChapterInput,
  Novel,
  UpdateChapterPlanInput,
} from "@domain/novel";
import type { NamePool } from "@domain/name-pool";
import {
  assertCompleteStructurePlan,
  normalizeVolumeTitle,
  parseBiblePlan,
  parseCastPlan,
  parseScenePlan,
  parseStructurePlan,
  type NovelPlanSummary,
  type PlanRange,
  type PlanPhase,
} from "@domain/planning";
import type {
  PlanningCycle,
  SavePlanningCycleInput,
} from "@domain/planning-cycle";
import type {
  NewPlanningProposal,
  PlanningProposal,
} from "@domain/planning-proposal";
import type {
  BibleSection,
  SaveBibleSectionInput,
  SaveStoryEntityInput,
  StoryEntity,
} from "@domain/story-bible";
import {
  entityShortRef,
  nearStoryEntities,
  normalizeAliases,
  resolveStoryEntity,
} from "@domain/story-bible";
import type {
  SaveVolumeInput,
  StoryStructure,
  StoryVolume,
} from "@domain/story-structure";
import { PlanningJsonStructureError } from "./repair-planning-content";

export interface NovelPlanStore {
  saveBibleSection(input: SaveBibleSectionInput): Promise<BibleSection>;
  saveStoryEntity(input: SaveStoryEntityInput): Promise<StoryEntity>;
  saveNamePool(pool: NamePool): Promise<NamePool>;
  listStoryStructure(novelId: string): Promise<StoryStructure>;
  listChapters(novelId: string): Promise<Chapter[]>;
  saveVolume(input: SaveVolumeInput): Promise<StoryVolume>;
  reorderVolumes(novelId: string, ids: string[]): Promise<StoryVolume[]>;
  updateChapterPlan(input: UpdateChapterPlanInput): Promise<Chapter>;
  createChapter(input: CreateChapterInput): Promise<Chapter>;
  savePlanningCycle(input: SavePlanningCycleInput): Promise<PlanningCycle>;
  replacePlanningProposals(
    novelId: string,
    cycleId: string,
    startChapter: number,
    endChapter: number,
    proposals: NewPlanningProposal[],
  ): Promise<PlanningProposal[]>;
  addPlanningProposals(
    novelId: string,
    cycleId: string,
    startChapter: number,
    endChapter: number,
    proposals: NewPlanningProposal[],
  ): Promise<PlanningProposal[]>;
}

export function validateNovelPlanContent(input: {
  phase: PlanPhase;
  content: string;
  targetChapters: number;
  range?: PlanRange;
}): void {
  try {
    if (input.phase === "bible") {
      parseBiblePlan(input.content);
      return;
    }
    if (input.phase === "cast") {
      parseCastPlan(input.content);
      return;
    }
    if (input.phase === "scenes") {
      parseScenePlan(input.content);
      return;
    }
  } catch (error) {
    throw new PlanningJsonStructureError(
      error instanceof Error ? error.message : "规划 JSON 结构解析失败",
    );
  }
  let plan: ReturnType<typeof parseStructurePlan>;
  try {
    plan = parseStructurePlan(input.content);
  } catch (error) {
    throw new PlanningJsonStructureError(
      error instanceof Error ? error.message : "规划 JSON 结构解析失败",
    );
  }
  assertCompleteStructurePlan(plan, input.targetChapters, input.range);
}

export async function applyNovelPlan(input: {
  novel: Novel;
  phase: PlanPhase;
  content: string;
  entities: StoryEntity[];
  namePool: NamePool;
  range?: PlanRange;
  store: NovelPlanStore;
}): Promise<NovelPlanSummary> {
  const { novel, phase, content, entities, namePool, range, store } = input;
  if (phase === "bible") {
    const plan = parseBiblePlan(content);
    for (const section of plan.sections)
      await store.saveBibleSection({
        novelId: novel.id,
        kind: section.kind,
        content: section.content,
      });
    for (const item of [...plan.characters, ...plan.entities])
      await store.saveStoryEntity({ novelId: novel.id, ...item });
    return summary(phase, {
      sections: plan.sections.length,
      entities: plan.characters.length + plan.entities.length,
    });
  }

  if (phase === "cast") {
    const plan = parseCastPlan(content),
      known = [...entities],
      mergeSuggestions: NewPlanningProposal[] = [];
    for (const character of plan.characters) {
      const existing = resolveStoryEntity(
        known,
        "character",
        character.entityRef,
        character.name,
      );
      if (!existing) {
        const near = nearStoryEntities(known, "character", character.name);
        if (near.length === 1) {
          mergeSuggestions.push({
            action: "merge",
            targetType: "character",
            targetRef: entityShortRef(near[0]),
            targetName: character.name,
            patch: {
              summary: character.summary,
              aliases: normalizeAliases([character.name, ...character.aliases]),
              profile: {
                ...character.profile,
                ...(character.detailedBio
                  ? { 详细小传: character.detailedBio }
                  : {}),
                tier: character.tier,
              },
            },
            reason: `疑似与既有角色“${near[0].name}”为同一实体，请作者确认合并`,
          });
          continue;
        }
      }
      const saved = await store.saveStoryEntity({
        id: existing?.id,
        novelId: novel.id,
        type: "character",
        name: existing?.name ?? character.name,
        summary: character.summary,
        aliases: normalizeAliases([
          ...(existing?.aliases ?? []),
          ...(existing && existing.name !== character.name
            ? [character.name]
            : []),
          ...character.aliases,
        ]),
        profile: {
          ...(existing?.profile ?? {}),
          ...character.profile,
          ...(character.detailedBio
            ? { 详细小传: character.detailedBio }
            : {}),
          tier: character.tier,
        },
      });
      known.push(saved);
    }
    await store.addPlanningProposals(
      novel.id,
      "entity-merge",
      0,
      0,
      mergeSuggestions,
    );
    await store.saveNamePool({
      ...namePool,
      usedNames: [
        ...new Set([
          ...namePool.usedNames,
          ...plan.characters.map((item) => item.name),
          ...plan.extras,
        ]),
      ],
    });
    return summary(phase, {
      entities: plan.characters.length - mergeSuggestions.length,
      extras: plan.extras.length,
    });
  }

  if (phase === "scenes") {
    const plan = parseScenePlan(content),
      known = [...entities],
      mergeSuggestions: NewPlanningProposal[] = [];
    for (const scene of plan.scenes) {
      const existing = resolveStoryEntity(
        known,
        "location",
        scene.entityRef,
        scene.name,
      );
      if (!existing) {
        const near = nearStoryEntities(known, "location", scene.name);
        if (near.length === 1) {
          mergeSuggestions.push({
            action: "merge",
            targetType: "location",
            targetRef: entityShortRef(near[0]),
            targetName: scene.name,
            patch: {
              summary: scene.summary,
              aliases: normalizeAliases([scene.name, ...scene.aliases]),
              profile: {
                purpose: scene.purpose,
                mood: scene.mood,
                visualAnchors: scene.visualAnchors.join("、"),
                residents: scene.residents,
                dangerLevel: scene.dangerLevel,
              },
            },
            reason: `疑似与既有地点“${near[0].name}”为同一实体，请作者确认合并`,
          });
          continue;
        }
      }
      const saved = await store.saveStoryEntity({
        id: existing?.id,
        novelId: novel.id,
        type: "location",
        name: existing?.name ?? scene.name,
        summary: scene.summary,
        aliases: normalizeAliases([
          ...(existing?.aliases ?? []),
          ...(existing && existing.name !== scene.name ? [scene.name] : []),
          ...scene.aliases,
        ]),
        profile: {
          ...(existing?.profile ?? {}),
          purpose: scene.purpose,
          mood: scene.mood,
          visualAnchors: scene.visualAnchors.join("、"),
          residents: scene.residents,
          dangerLevel: scene.dangerLevel,
        },
      });
      known.push(saved);
    }
    for (const item of plan.entities) {
      const existing = resolveStoryEntity(
        known,
        item.type,
        item.entityRef,
        item.name,
      );
      if (!existing) {
        const near = nearStoryEntities(known, item.type, item.name);
        if (near.length === 1) {
          mergeSuggestions.push({
            action: "merge",
            targetType: item.type,
            targetRef: entityShortRef(near[0]),
            targetName: item.name,
            patch: {
              summary: item.summary,
              aliases: normalizeAliases([item.name, ...item.aliases]),
              profile: item.profile,
            },
            reason: `疑似与既有实体“${near[0].name}”为同一实体，请作者确认合并`,
          });
          continue;
        }
      }
      const saved = await store.saveStoryEntity({
        id: existing?.id,
        novelId: novel.id,
        type: item.type,
        name: existing?.name ?? item.name,
        summary: item.summary,
        aliases: normalizeAliases([
          ...(existing?.aliases ?? []),
          ...(existing && existing.name !== item.name ? [item.name] : []),
          ...item.aliases,
        ]),
        profile: { ...(existing?.profile ?? {}), ...item.profile },
      });
      known.push(saved);
    }
    await store.addPlanningProposals(
      novel.id,
      "entity-merge",
      0,
      0,
      mergeSuggestions,
    );
    return summary(phase, {
      entities:
        plan.scenes.length + plan.entities.length - mergeSuggestions.length,
    });
  }

  const plan = parseStructurePlan(content);
  assertCompleteStructurePlan(plan, novel.targetChapters, range);
  const structure = await store.listStoryStructure(novel.id),
    chapters = await store.listChapters(novel.id),
    volumeIds = new Map<string, string>(),
    orderedIds: string[] = [];
  for (const volume of plan.volumes) {
    const existing = structure.volumes.find(
      (item) => item.title === volume.title,
    );
    const saved = await store.saveVolume({
      id: existing?.id,
      novelId: novel.id,
      title: volume.title,
      outline: volume.outline,
    });
    volumeIds.set(normalizeVolumeTitle(saved.title), saved.id);
    orderedIds.push(saved.id);
  }
  const orderedSet = new Set(orderedIds);
  await store.reorderVolumes(novel.id, [
    ...orderedIds,
    ...structure.volumes
      .map((item) => item.id)
      .filter((id) => !orderedSet.has(id)),
  ]);
  const defaultVolumeId = plan.volumes[0]
    ? volumeIds.get(normalizeVolumeTitle(plan.volumes[0].title))!
    : null;
  for (const [index, chapter] of plan.chapters.entries()) {
    const position = chapter.position ?? (range?.startChapter ?? 1) + index;
    const volumeId = chapter.volumeTitle
        ? (volumeIds.get(normalizeVolumeTitle(chapter.volumeTitle)) ??
          defaultVolumeId)
        : defaultVolumeId,
      slot = chapters.find((item) => item.position === position),
      target =
        slot ??
        (await store.createChapter({
          novelId: novel.id,
          volumeId,
          title: chapter.title,
          targetWords: novel.chapterWords,
        }));
    await store.updateChapterPlan({
      chapterId: target.id,
      volumeId,
      title: chapter.title,
      outline: renderChapterPlan(chapter, entities),
      targetWords: novel.chapterWords,
    });
  }
  const cycle = await store.savePlanningCycle({
    novelId: novel.id,
    startChapter: range?.startChapter ?? 1,
    endChapter: range?.endChapter ?? novel.targetChapters,
    status: "plan_review",
    goal: plan.cycle.goal,
    openingState: plan.cycle.openingState,
    climax: plan.cycle.climax,
    expectedClosingState: plan.cycle.expectedClosingState,
    actualClosingState: "",
  });
  await store.replacePlanningProposals(
    novel.id,
    cycle.id,
    cycle.startChapter,
    cycle.endChapter,
    plan.proposals,
  );
  return summary(phase, {
    volumes: plan.volumes.length,
    chapters: plan.chapters.length,
  });
}

export function renderChapterPlan(
  chapter: ReturnType<typeof parseStructurePlan>["chapters"][number],
  entities: StoryEntity[] = [],
): string {
  const label = (value: string) =>
    entities.find((item) => entityShortRef(item) === value.trim().toUpperCase())
      ?.name ?? value;
  const references = [
    chapter.viewpoint && `【视角】${label(chapter.viewpoint)}`,
    chapter.characters.length &&
      `【人物】${chapter.characters.map(label).join("、")}`,
    chapter.scenes.length && `【场景】${chapter.scenes.map(label).join("、")}`,
    chapter.items.length && `【道具】${chapter.items.map(label).join("、")}`,
    chapter.skills.length && `【技能】${chapter.skills.join("、")}`,
  ]
    .filter(Boolean);
  return [chapter.outline, ...references].join("\n");
}

function summary(
  phase: PlanPhase,
  values: Partial<Omit<NovelPlanSummary, "phase">>,
): NovelPlanSummary {
  return {
    phase,
    sections: 0,
    entities: 0,
    volumes: 0,
    chapters: 0,
    extras: 0,
    ...values,
  };
}

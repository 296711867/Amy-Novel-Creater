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
import type {
  SaveVolumeInput,
  StoryStructure,
  StoryVolume,
} from "@domain/story-structure";

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
      byName = new Map(
        entities
          .filter((item) => item.type === "character")
          .map((item) => [item.name, item] as const),
      );
    for (const character of plan.characters) {
      const existing = byName.get(character.name);
      await store.saveStoryEntity({
        id: existing?.id,
        novelId: novel.id,
        type: "character",
        name: character.name,
        summary: character.summary,
        aliases: character.aliases,
        profile: {
          ...(existing?.profile ?? {}),
          ...character.profile,
          tier: character.tier,
        },
      });
    }
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
      entities: plan.characters.length,
      extras: plan.extras.length,
    });
  }

  if (phase === "scenes") {
    const plan = parseScenePlan(content),
      locations = new Map(
        entities
          .filter((item) => item.type === "location")
          .map((item) => [item.name, item] as const),
      );
    for (const scene of plan.scenes) {
      const existing = locations.get(scene.name);
      await store.saveStoryEntity({
        id: existing?.id,
        novelId: novel.id,
        type: "location",
        name: scene.name,
        summary: scene.summary,
        aliases: scene.aliases,
        profile: {
          ...(existing?.profile ?? {}),
          purpose: scene.purpose,
          mood: scene.mood,
          visualAnchors: scene.visualAnchors.join("、"),
          residents: scene.residents,
          dangerLevel: scene.dangerLevel,
        },
      });
    }
    for (const item of plan.entities) {
      const existing = entities.find(
        (value) => value.type === item.type && value.name === item.name,
      );
      await store.saveStoryEntity({
        id: existing?.id,
        novelId: novel.id,
        ...item,
        profile: { ...(existing?.profile ?? {}), ...item.profile },
      });
    }
    return summary(phase, {
      entities: plan.scenes.length + plan.entities.length,
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
      outline: renderChapterPlan(chapter),
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
): string {
  const references = [
    chapter.viewpoint && `【视角】${chapter.viewpoint}`,
    chapter.characters.length && `【人物】${chapter.characters.join("、")}`,
    chapter.scenes.length && `【场景】${chapter.scenes.join("、")}`,
    chapter.items.length && `【道具】${chapter.items.join("、")}`,
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

import type { Chapter, Novel } from "./novel";
import type { BibleSection, StoryEntity } from "./story-bible";
import { characterTierOf } from "./story-bible";
import type { StoryVolume } from "./story-structure";
import type { PlanRange } from "./planning";

export type PlanningReviewStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface PlanningBrief {
  audience: string;
  style: string;
  boundaries: string;
  sellingPoint: string;
  conflict: string;
  protagonistGoal: string;
  ending: string;
}

export interface PlanningWorkflow {
  novelId: string;
  brief: PlanningBrief;
  confirmedSteps: PlanningReviewStep[];
  updatedAt: string;
}

export interface PlanningCheck {
  id: string;
  label: string;
  passed: boolean;
}

export const EMPTY_PLANNING_BRIEF: PlanningBrief = {
  audience: "",
  style: "",
  boundaries: "",
  sellingPoint: "",
  conflict: "",
  protagonistGoal: "",
  ending: "",
};

const REVIEW_STEPS: PlanningReviewStep[] = [1, 2, 3, 4, 5, 6, 7, 8, 9];

export function defaultPlanningWorkflow(
  novelId: string,
  now = new Date().toISOString(),
): PlanningWorkflow {
  return {
    novelId,
    brief: { ...EMPTY_PLANNING_BRIEF },
    confirmedSteps: [],
    updatedAt: now,
  };
}

export function normalizePlanningWorkflow(
  value: PlanningWorkflow,
): PlanningWorkflow {
  const requested = new Set(value.confirmedSteps);
  const contiguous: PlanningReviewStep[] = [];
  for (const step of REVIEW_STEPS) {
    if (!requested.has(step)) break;
    contiguous.push(step);
  }
  return {
    novelId: value.novelId,
    brief: { ...EMPTY_PLANNING_BRIEF, ...value.brief },
    confirmedSteps: contiguous,
    updatedAt: value.updatedAt,
  };
}

export function confirmPlanningStep(
  workflow: PlanningWorkflow,
  step: PlanningReviewStep,
  now = new Date().toISOString(),
): PlanningWorkflow {
  const current = normalizePlanningWorkflow(workflow);
  if (step > 1 && !current.confirmedSteps.includes((step - 1) as PlanningReviewStep))
    throw new Error(`请先确认第 ${step - 1} 步`);
  return normalizePlanningWorkflow({
    ...current,
    confirmedSteps: [...current.confirmedSteps, step],
    updatedAt: now,
  });
}

export function invalidatePlanningFrom(
  workflow: PlanningWorkflow,
  step: PlanningReviewStep,
  now = new Date().toISOString(),
): PlanningWorkflow {
  return {
    ...normalizePlanningWorkflow(workflow),
    confirmedSteps: workflow.confirmedSteps.filter((item) => item < step),
    updatedAt: now,
  };
}

export function nextPlanningStep(workflow: PlanningWorkflow): number {
  return REVIEW_STEPS.find((step) => !workflow.confirmedSteps.includes(step)) ?? 10;
}

export function planningBriefText(brief: PlanningBrief): string {
  return [
    ["目标读者", brief.audience],
    ["文风与阅读体验", brief.style],
    ["禁忌与不可改动项", brief.boundaries],
    ["核心卖点", brief.sellingPoint],
    ["主线矛盾", brief.conflict],
    ["主角目标与失败代价", brief.protagonistGoal],
    ["结局方向", brief.ending],
  ]
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `${label}：${value.trim()}`)
    .join("\n");
}

export function evaluatePlanningChecks(input: {
  novel: Novel;
  sections: BibleSection[];
  entities: StoryEntity[];
  volumes: StoryVolume[];
  chapters: Chapter[];
  range?: PlanRange;
}): PlanningCheck[] {
  const characters = input.entities.filter((item) => item.type === "character"),
    has = (type: StoryEntity["type"]) =>
      input.entities.some((item) => item.type === type),
    chapters = input.range
      ? input.chapters.filter(
          (item) =>
            item.position >= input.range!.startChapter &&
            item.position <= input.range!.endChapter,
        )
      : input.chapters,
    expectedCount = input.range
      ? input.range.endChapter - input.range.startChapter + 1
      : input.novel.targetChapters,
    rangeLabel = input.range
      ? `第 ${input.range.startChapter}–${input.range.endChapter} 章`
      : `目标 ${input.novel.targetChapters} 章`;
  return [
    {
      id: "bible",
      label: "故事圣经四个核心文档均已完善",
      passed:
        input.sections.length >= 4 &&
        input.sections.every((item) => item.content.trim()),
    },
    {
      id: "cast",
      label: "主角、核心配角与常驻酱油人物已经分层",
      passed:
        characters.some((item) => characterTierOf(item) === "protagonist") &&
        characters.some((item) => characterTierOf(item) === "support") &&
        characters.some((item) => characterTierOf(item) === "recurring"),
    },
    {
      id: "entities",
      label: "地点、势力、物品和可复用场景均已建立",
      passed: has("location") && has("organization") && has("item"),
    },
    {
      id: "volumes",
      label: "故事已划分阶段与分卷",
      passed: input.volumes.length > 0,
    },
    {
      id: "chapter_count",
      label: `${rangeLabel}数量完整`,
      passed: chapters.length === expectedCount,
    },
    {
      id: "chapter_plans",
      label: "每章都有独立标题与完整章纲",
      passed:
        chapters.length === expectedCount &&
        chapters.every(
          (item) =>
            item.outline.trim() &&
            !/^第\s*\d+\s*章$/.test(item.title.trim()),
        ),
    },
    {
      id: "chapter_volumes",
      label: "所有章节均已归入分卷",
      passed:
        chapters.length === expectedCount &&
        chapters.every((item) => item.volumeId),
    },
  ];
}

export function assertPlanningReady(
  input: Parameters<typeof evaluatePlanningChecks>[0],
): void {
  const failed = evaluatePlanningChecks(input).filter((item) => !item.passed);
  if (failed.length)
    throw new Error(`小说框架尚未通过一致性检查：${failed[0].label}`);
}

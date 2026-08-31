import { describe, expect, it, vi } from "vitest";
import {
  applyNovelPlan,
  renderChapterPlan,
} from "@application/apply-novel-plan";
import type { Novel } from "@domain/novel";
import type { StoryEntity } from "@domain/story-bible";

describe("rolling chapter plan persistence", () => {
  it("keeps explicit people, scene, item and skill references", () => {
    expect(
      renderChapterPlan({
        position: 1,
        volumeTitle: "第一卷",
        title: "第一章",
        outline: "主角进入灰塔。",
        viewpoint: "林舟",
        characters: ["林舟", "沈岚"],
        scenes: ["灰塔"],
        items: ["旧钥匙"],
        skills: ["星图导航"],
      }),
    ).toContain("【技能】星图导航");
  });
  it("turns a qualified-name collision into a merge proposal instead of a duplicate card", async () => {
    const novel: Novel = {
        id: "n1", title: "灯海", genre: "玄幻", premise: "守灯",
        targetWords: 100_000, targetChapters: 100, chapterWords: 1000,
        cycleSize: 10, status: "planning", createdAt: "t", updatedAt: "t",
      },
      existing: StoryEntity = {
        id: "abc12345-long", novelId: "n1", type: "character",
        name: "守灯人旧部首脑·崔衡", summary: "反派", aliases: [],
        profile: {}, status: "active", createdAt: "t", updatedAt: "t",
      },
      saveEntity = vi.fn(async (input) => ({
        ...existing,
        ...input,
        id: input.id ?? "new",
      })),
      addProposals = vi.fn(async () => []);
    await applyNovelPlan({
      novel,
      phase: "cast",
      content: JSON.stringify({
        characters: [{
          name: "崔衡",
          summary: "旧部首脑",
          tier: "support",
          profile: {},
        }],
        extras: [],
      }),
      entities: [existing],
      namePool: {
        novelId: "n1",
        genre: "fantasy",
        surnames: [],
        givenNames: [],
        usedNames: [],
        updatedAt: "t",
      },
      store: {
        saveBibleSection: vi.fn(),
        saveStoryEntity: saveEntity,
        saveNamePool: vi.fn(async (pool) => pool),
        listStoryStructure: vi.fn(),
        listChapters: vi.fn(),
        saveVolume: vi.fn(),
        reorderVolumes: vi.fn(),
        updateChapterPlan: vi.fn(),
        createChapter: vi.fn(),
        savePlanningCycle: vi.fn(),
        replacePlanningProposals: vi.fn(),
        addPlanningProposals: addProposals,
      },
    });
    expect(saveEntity).not.toHaveBeenCalled();
    expect(addProposals).toHaveBeenCalledWith(
      "n1",
      "entity-merge",
      0,
      0,
      [expect.objectContaining({
        action: "merge",
        targetRef: "E-ABC12345",
        targetName: "崔衡",
      })],
    );
  });
});

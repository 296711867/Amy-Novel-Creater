import { afterEach, describe, expect, it } from "vitest";
import { NovelDatabase } from "../../src/main/db/database";
import type { NovelProjectBundle } from "../../src/domain/project-export";
import { entityShortRef } from "../../src/domain/story-bible";

let database: NovelDatabase | undefined;
afterEach(() => database?.close());

describe("project restore", () => {
  it("作为新作品恢复正文、版本和跨表引用", async () => {
    database = await NovelDatabase.open(":memory:");
    const now = new Date().toISOString(),
      bundle: NovelProjectBundle = {
        format: "amy-novel-project",
        version: 1,
        exportedAt: now,
        novel: {
          id: "old",
          title: "远航",
          genre: "科幻",
          premise: "离开母星",
          targetWords: 1000,
          targetChapters: 1,
          chapterWords: 1000,
          cycleSize: 10,
          status: "writing",
          createdAt: now,
          updatedAt: now,
        },
        chapters: [
          {
            id: "old-c1",
            novelId: "old",
            position: 1,
            volumeId: "old-v1",
            title: "第一章",
            outline: "起飞",
            status: "accepted",
            targetWords: 1000,
            content: "星舰起飞。",
            wordCount: 5,
            updatedAt: now,
          },
        ],
        versions: [
          {
            id: "old-ver",
            chapterId: "old-c1",
            versionNo: 1,
            origin: "accepted",
            content: "星舰起飞。",
            wordCount: 5,
            createdAt: now,
          },
        ],
        bible: [],
        entities: [
          {
            id: "old-e1",
            novelId: "old",
            type: "character",
            name: "林舟",
            summary: "领航员",
            aliases: [],
            profile: {},
            status: "active",
            createdAt: now,
            updatedAt: now,
          },
        ],
        volumes: [
          {
            id: "old-v1",
            novelId: "old",
            position: 1,
            title: "启程",
            outline: "离开",
            createdAt: now,
            updatedAt: now,
          },
        ],
        scenes: [],
        timeline: [
          {
            id: "old-t1",
            novelId: "old",
            chapterId: "old-c1",
            storyTime: "第一日",
            title: "起飞",
            detail: "离开母星",
            participantIds: ["old-e1"],
            source: "manual",
            createdAt: now,
            updatedAt: now,
          },
        ],
        foreshadow: [],
        characterStates: [],
        usage: [],
        candidates: [],
        workflow: {
          novelId: "old",
          scopeAdvice: null,
          brief: {
            audience: "硬科幻读者",
            style: "克制",
            boundaries: "不复活",
            sellingPoint: "代际远航",
            conflict: "资源与时间",
            protagonistGoal: "抵达新家园",
            ending: "开放式",
          },
          confirmedSteps: [1, 2],
          updatedAt: now,
        },
        planningCycles: [{
          id: "old-cycle", novelId: "old", startChapter: 1, endChapter: 1,
          status: "plan_review", goal: "启航", openingState: "母星",
          climax: "起飞", expectedClosingState: "离开", actualClosingState: "",
          createdAt: now, updatedAt: now,
        }],
        planningProposals: [{
          id: "old-proposal", novelId: "old", cycleId: "old-cycle",
          startChapter: 1, endChapter: 1, action: "update",
          targetType: "character", targetRef: "E-OLDE1", targetName: "林舟",
          patch: { summary: "领航员" }, reason: "补充", status: "pending",
          createdAt: now, updatedAt: now,
        }],
      };
    const restored = await database.importNovelProject(bundle),
      chapters = await database.listChapters(restored.id),
      entities = await database.listStoryEntities(restored.id),
      timeline = await database.listTimelineEvents(restored.id);
    expect(restored).toMatchObject({ title: "远航（恢复）" });
    expect(chapters[0]).toMatchObject({ content: "星舰起飞。" });
    expect(await database.listChapterVersions(chapters[0].id)).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      chapterId: chapters[0].id,
      participantIds: [entities[0].id],
    });
    expect(await database.getPlanningWorkflow(restored.id)).toMatchObject({
      novelId: restored.id,
      confirmedSteps: [1, 2],
      brief: { audience: "硬科幻读者" },
    });
    expect((await database.listPlanningProposals(restored.id))[0].targetRef)
      .toBe(entityShortRef(entities[0]));
  });
});

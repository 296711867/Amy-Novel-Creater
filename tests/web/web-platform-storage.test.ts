// @vitest-environment jsdom
/**
 * AN-006：Web 端长篇存储迁移 IndexedDB。
 * 覆盖旧 localStorage 数据一次性迁移、大文本容量与重载恢复、
 * 项目包导入往返和作品删除清理。所有数据操作都走真实 webPlatform
 * 端口，与产品路径同构。
 */
import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { webPlatform } from "../../src/renderer/src/platform/web-platform";
import {
  flushWebStorage,
  initWebStorage,
  resetWebStorageForTests,
} from "../../src/renderer/src/platform/web-storage";
import type { Chapter, Novel } from "@domain/novel";
import type { NovelProjectBundle } from "@domain/project-export";

const now = "2026-08-31T00:00:00.000Z";

function legacyNovel(): Novel {
  return {
    id: "legacy-1",
    title: "旧版本作品",
    genre: "科幻",
    premise: "localStorage 时代的作品",
    targetWords: 6000,
    targetChapters: 2,
    chapterWords: 3000,
    cycleSize: 10,
    status: "writing",
    createdAt: now,
    updatedAt: now,
  };
}

function legacyChapters(novelId: string): Chapter[] {
  return [1, 2].map((position) => ({
    id: `legacy-c${position}`,
    novelId,
    position,
    volumeId: null,
    title: `第${position}章`,
    outline: "旧章纲",
    status: "accepted" as const,
    targetWords: 3000,
    content: "旧正文。".repeat(600),
    wordCount: 2400,
    updatedAt: now,
  }));
}

function legacyBundle(): NovelProjectBundle {
  const novel: Novel = {
    ...legacyNovel(),
    id: "bundle-old",
    title: "远航",
    status: "writing",
  };
  return {
    format: "amy-novel-project",
    version: 1,
    exportedAt: now,
    novel,
    chapters: legacyChapters("bundle-old").map((chapter, index) => ({
      ...chapter,
      id: `bundle-c${index + 1}`,
    })),
    versions: [
      {
        id: "bundle-ver",
        chapterId: "bundle-c1",
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
        id: "bundle-e1",
        novelId: "bundle-old",
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
    volumes: [],
    scenes: [],
    timeline: [],
    foreshadow: [],
    characterStates: [],
    usage: [],
    candidates: [],
    workflow: {
      novelId: "bundle-old",
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
    planningCycles: [],
    planningProposals: [],
  };
}

/** 断言 localStorage 中不再残留任何 amy-novel: 数据键（迁移标记除外）。 */
function expectNoLegacyDataKeys() {
  expect(
    Object.keys(localStorage).filter((key) => key.startsWith("amy-novel:")),
  ).toEqual([]);
}

describe("web platform IndexedDB storage（AN-006）", () => {
  it("旧 localStorage 数据一次性迁入并清源，无关键不受影响", async () => {
    localStorage.setItem("amy-novel:novels", JSON.stringify([legacyNovel()]));
    localStorage.setItem(
      "amy-novel:chapters:legacy-1",
      JSON.stringify(legacyChapters("legacy-1")),
    );
    localStorage.setItem("other-app:data", "keep");

    await resetWebStorageForTests();
    await initWebStorage();

    const novels = await webPlatform.listNovels();
    expect(novels).toHaveLength(1);
    expect(novels[0]).toMatchObject({ id: "legacy-1", cycleSize: 10 });
    const chapters = await webPlatform.listChapters("legacy-1");
    expect(chapters).toHaveLength(2);
    expect(chapters[0].content).toHaveLength(2400);

    expectNoLegacyDataKeys();
    expect(localStorage.getItem("other-app:data")).toBe("keep");

    // 迁移完成后再次重载不会重复导入或覆盖。
    await resetWebStorageForTests();
    await initWebStorage();
    expect(await webPlatform.listNovels()).toHaveLength(1);
  });

  it("大文本写入 IndexedDB，页面重载后完整恢复且不进入 localStorage", async () => {
    await webPlatform.ready();
    const created = await webPlatform.createNovel({
      title: "容量恢复测试",
      genre: "玄幻",
      premise: "六十章长篇压测",
      targetChapters: 60,
      chapterWords: 3000,
    });
    const chapters = await webPlatform.listChapters(created.novel.id);
    expect(chapters).toHaveLength(60);
    for (const chapter of chapters) {
      await webPlatform.saveChapter({
        chapterId: chapter.id,
        title: chapter.title,
        outline: "推进主线",
        content: "灯焰在雾里明明灭灭。".repeat(400),
      });
    }
    await flushWebStorage();

    // 模拟页面重载：清空内存镜像后重新装载。
    await resetWebStorageForTests();
    await initWebStorage();

    const reloaded = await webPlatform.listChapters(created.novel.id);
    expect(reloaded).toHaveLength(60);
    expect(
      reloaded.every((item) => item.content.length === 4000 && item.outline === "推进主线"),
    ).toBe(true);
    expect((await webPlatform.listNovels()).map((item) => item.title)).toContain(
      "容量恢复测试",
    );
    expectNoLegacyDataKeys();
  });

  it("项目包导入后经端口读取一致，删除作品后 IndexedDB 清理", async () => {
    await webPlatform.ready();
    const bundle = legacyBundle(),
      restored = await webPlatform.importNovelProject(bundle),
      chapters = await webPlatform.listChapters(restored.id),
      entities = await webPlatform.listStoryEntities(restored.id),
      workflow = await webPlatform.getPlanningWorkflow(restored.id);

    expect(restored.title).toBe("远航（恢复）");
    expect(chapters).toHaveLength(2);
    expect(chapters[0].content).toHaveLength(2400);
    expect(
      await webPlatform.listChapterVersions(chapters[0].id),
    ).toHaveLength(1);
    expect(entities[0]).toMatchObject({ name: "林舟" });
    expect(workflow).toMatchObject({
      novelId: restored.id,
      confirmedSteps: [1, 2],
      brief: { audience: "硬科幻读者" },
    });

    await flushWebStorage();
    await resetWebStorageForTests();
    await initWebStorage();
    expect(
      (await webPlatform.listChapters(restored.id))[0].content,
    ).toHaveLength(2400);

    await webPlatform.deleteNovel(restored.id);
    await flushWebStorage();
    await resetWebStorageForTests();
    await initWebStorage();
    expect(
      (await webPlatform.listNovels()).some((item) => item.id === restored.id),
    ).toBe(false);
    expect(await webPlatform.listChapters(restored.id)).toEqual([]);
    expect(await webPlatform.getPlanningWorkflow(restored.id)).toMatchObject({
      confirmedSteps: [],
    });
  });
});

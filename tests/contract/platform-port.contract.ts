/**
 * PlatformPort 双端契约套件（AN-011）。
 *
 * 同一组用例分别驱动 Electron 数据适配（NovelDatabase，经与 novel-ipc
 * 相同的方法映射）和 Web 适配（webPlatform + IndexedDB），断言 DTO
 * 形状、归一化规则和错误语义一致。任何一端单独改语义都会在这里暴露。
 */
import { describe, expect, it } from "vitest";
import type { Novel, Chapter, CreateNovelInput, SaveChapterInput } from "@domain/novel";
import type { ChapterVersion } from "@domain/novel";
import type { PlanningWorkflow } from "@domain/planning-workflow";
import type {
  CreateWorkflowRunInput,
  UpdateWorkflowRunInput,
  WorkflowRun,
} from "@domain/workflow-run";
import type {
  SaveStyleTemplateInput,
  StyleTemplate,
} from "@domain/style-template";
import type { NovelProjectBundle } from "@domain/project-export";
import type { StoryEntity } from "@domain/story-bible";
import type { PlanningProposal } from "@domain/planning-proposal";
import type { GenerationPolicy } from "@domain/generation";

/** 契约覆盖的最小端口面：两端都必须提供且语义一致的方法。 */
export interface ContractPort {
  ready(): Promise<void>;
  createNovel(input: CreateNovelInput): Promise<{ novel: Novel; chapters: Chapter[] }>;
  listNovels(): Promise<Novel[]>;
  updateNovelSettings(novelId: string, patch: { cycleSize: number }): Promise<Novel>;
  listChapters(novelId: string): Promise<Chapter[]>;
  saveChapter(input: SaveChapterInput): Promise<Chapter>;
  createChapterSnapshot(chapterId: string): Promise<ChapterVersion>;
  listChapterVersions(chapterId: string): Promise<ChapterVersion[]>;
  createGenerationDraft(
    novelId: string,
    policy: GenerationPolicy,
  ): Promise<{ id: string }>;
  getPlanningWorkflow(novelId: string): Promise<PlanningWorkflow>;
  createWorkflowRun(input: CreateWorkflowRunInput): Promise<WorkflowRun>;
  updateWorkflowRun(input: UpdateWorkflowRunInput): Promise<WorkflowRun>;
  listWorkflowRuns(novelId: string): Promise<WorkflowRun[]>;
  saveStyleTemplate(input: SaveStyleTemplateInput): Promise<StyleTemplate>;
  listStyleTemplates(): Promise<StyleTemplate[]>;
  importNovelProject(bundle: NovelProjectBundle): Promise<Novel>;
  listStoryEntities(novelId: string): Promise<StoryEntity[]>;
  listPlanningProposals(novelId: string): Promise<PlanningProposal[]>;
  deleteGenerationBatch(batchId: string): Promise<void>;
  listGlobalFindings(
    novelId: string,
  ): Promise<import("@domain/global-consistency").GlobalFinding[]>;
  saveGlobalFindings(
    novelId: string,
    findings: import("@domain/global-consistency").GlobalFinding[],
  ): Promise<import("@domain/global-consistency").GlobalFinding[]>;
}

export const CONTRACT_NOVEL_INPUT: CreateNovelInput = {
  title: "契约测试·双端一致",
  genre: "科幻",
  premise: "同一组用例驱动两端适配",
  targetChapters: 3,
  chapterWords: 1000,
};

export const CONTRACT_POLICY: GenerationPolicy = {
  startChapter: 1,
  endChapter: 1,
  chapterWords: 1000,
  continuityCheck: true,
  maxRetries: 2,
  approvalMode: "candidate",
  outputTokenBudget: 6000,
};

export const CONTRACT_BUNDLE: NovelProjectBundle = {
  format: "amy-novel-project",
  version: 1,
  exportedAt: "2026-08-31T00:00:00.000Z",
  novel: {
    id: "ct-old",
    title: "契约远航",
    genre: "科幻",
    premise: "双端往返",
    targetWords: 1000,
    targetChapters: 1,
    chapterWords: 1000,
    cycleSize: 10,
    status: "writing",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  },
  chapters: [
    {
      id: "ct-c1",
      novelId: "ct-old",
      position: 1,
      volumeId: null,
      title: "第一章",
      outline: "起飞",
      status: "accepted",
      targetWords: 1000,
      content: "星舰起飞。",
      wordCount: 5,
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
  ],
  versions: [
    {
      id: "ct-ver",
      chapterId: "ct-c1",
      versionNo: 1,
      origin: "accepted",
      content: "星舰起飞。",
      wordCount: 5,
      createdAt: "2026-08-31T00:00:00.000Z",
    },
  ],
  bible: [],
  entities: [
    {
      id: "ct-e1",
      novelId: "ct-old",
      type: "character",
      name: "林舟",
      summary: "领航员",
      aliases: [],
      profile: {},
      status: "active",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
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
    novelId: "ct-old",
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
    updatedAt: "2026-08-31T00:00:00.000Z",
  },
  planningCycles: [
    {
      id: "ct-cycle",
      novelId: "ct-old",
      startChapter: 1,
      endChapter: 1,
      status: "plan_review",
      goal: "起飞",
      openingState: "母星",
      climax: "点火",
      expectedClosingState: "离开",
      actualClosingState: "",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
  ],
  planningProposals: [
    {
      id: "ct-proposal",
      novelId: "ct-old",
      cycleId: "ct-cycle",
      startChapter: 1,
      endChapter: 1,
      action: "update",
      targetType: "character",
      targetRef: "E-CTE1",
      targetName: "林舟",
      patch: { summary: "领航员" },
      reason: "契约重映射",
      status: "pending",
      createdAt: "2026-08-31T00:00:00.000Z",
      updatedAt: "2026-08-31T00:00:00.000Z",
    },
  ],
};

export function registerPlatformPortContract(
  portName: string,
  load: () => ContractPort,
): void {
  describe(`PlatformPort 契约：${portName}`, () => {
    it("ready 就绪门可用", async () => {
      await expect(load().ready()).resolves.toBeUndefined();
    });

    it("小说创建、章节骨架与 cycleSize 归一化一致", async () => {
      const port = load(),
        created = await port.createNovel(CONTRACT_NOVEL_INPUT);
      expect(created.novel).toMatchObject({
        title: "契约测试·双端一致",
        genre: "科幻",
        targetChapters: 3,
        chapterWords: 1000,
        cycleSize: 10,
      });
      expect(created.chapters).toHaveLength(3);
      expect(created.chapters.map((item) => item.position)).toEqual([1, 2, 3]);
      expect(await port.listNovels()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: created.novel.id })]),
      );

      const clamped = await port.updateNovelSettings(created.novel.id, {
        cycleSize: 99,
      });
      expect(clamped.cycleSize).toBe(15);
    });

    it("章节保存、CJK 字数与不可变版本快照一致", async () => {
      const port = load(),
        created = await port.createNovel(CONTRACT_NOVEL_INPUT),
        chapter = created.chapters[0],
        saved = await port.saveChapter({
          chapterId: chapter.id,
          title: "第一章 起航",
          outline: "主角离开故乡",
          content: "星舰在黎明前起飞。",
        });
      expect(saved).toMatchObject({
        title: "第一章 起航",
        wordCount: 9,
      });
      const version = await port.createChapterSnapshot(chapter.id);
      expect(version).toMatchObject({
        versionNo: 1,
        content: "星舰在黎明前起飞。",
        wordCount: 9,
      });
      expect(await port.listChapterVersions(chapter.id)).toHaveLength(1);
    });

    it("第 9 步未确认时创建正文批次的错误语义一致", async () => {
      const port = load(),
        created = await port.createNovel(CONTRACT_NOVEL_INPUT),
        workflow = await port.getPlanningWorkflow(created.novel.id);
      expect(workflow).toMatchObject({
        novelId: created.novel.id,
        confirmedSteps: [],
      });
      await expect(
        port.createGenerationDraft(created.novel.id, CONTRACT_POLICY),
      ).rejects.toThrow(/十步向导|一致性检查/);
    });

    it("删除不存在批次的错误语义一致（AN-029）", async () => {
      const port = load();
      await expect(
        port.deleteGenerationBatch("no-such-batch"),
      ).rejects.toThrow("Batch not found");
    });

    it("workflow run 创建、部分更新与列表 DTO 一致", async () => {
      const port = load(),
        created = await port.createNovel(CONTRACT_NOVEL_INPUT),
        run = await port.createWorkflowRun({
          novelId: created.novel.id,
          mode: "chapter",
          config: {
            generationPolicy: CONTRACT_POLICY,
            maxPhaseRetries: 2,
          },
        });
      expect(run).toMatchObject({
        novelId: created.novel.id,
        mode: "chapter",
        currentPhase: "bible",
        status: "paused",
        checkpoint: null,
        attempt: 0,
        batchId: null,
      });
      const resumed = await port.updateWorkflowRun({
        id: run.id,
        status: "running",
        checkpoint: null,
        batchId: "batch-contract",
      });
      expect(resumed).toMatchObject({
        currentPhase: "bible",
        status: "running",
        batchId: "batch-contract",
        config: { generationPolicy: CONTRACT_POLICY, maxPhaseRetries: 2 },
      });
      const listed = await port.listWorkflowRuns(created.novel.id);
      expect(listed).toHaveLength(1);
      expect(listed[0]).toEqual(resumed);
    });

    it("文风模板保存与读取一致", async () => {
      const port = load(),
        saved = await port.saveStyleTemplate({
          name: "契约冷雾短句",
          authorAlias: "北港客",
          sourceTitle: "旧港",
          sampleText: "一段本地保存的样章。",
          contentSummary: "旅人夜渡。",
          styleSummary: "短句、克制。",
          styleGuide: "多用短句；不要复用来源情节。",
        });
      expect(saved).toMatchObject({
        name: "契约冷雾短句",
        authorAlias: "北港客",
        styleGuide: "多用短句；不要复用来源情节。",
      });
      expect(await port.listStyleTemplates()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: saved.id })]),
      );
    });

    it("项目包导入：标题、章节、版本与短引用重映射一致", async () => {
      const port = load(),
        restored = await port.importNovelProject(CONTRACT_BUNDLE),
        chapters = await port.listChapters(restored.id),
        entities = await port.listStoryEntities(restored.id);
      expect(restored.title).toBe("契约远航（恢复）");
      expect(restored.cycleSize).toBe(10);
      expect(chapters).toHaveLength(1);
      expect(chapters[0]).toMatchObject({
        position: 1,
        content: "星舰起飞。",
      });
      expect(await port.listChapterVersions(chapters[0].id)).toHaveLength(1);
      expect(entities[0]).toMatchObject({ name: "林舟", type: "character" });
      const workflow = await port.getPlanningWorkflow(restored.id);
      expect(workflow).toMatchObject({
        confirmedSteps: [1, 2],
        brief: { audience: "硬科幻读者" },
      });
      const proposals = await port.listPlanningProposals(restored.id);
      expect(proposals).toHaveLength(1);
      // 短引用必须按恢复后的新实体 ID 重映射，而不是保留导出包里的旧引用。
      const { entityShortRef } = await import("@domain/story-bible");
      expect(proposals[0].targetRef).toBe(entityShortRef(entities[0]));
    });

    it("全局一致性发现：保存、替换与可选字段往返一致", async () => {
      const port = load(),
        novel = (await port.listNovels()).find(
          (item) => item.title === CONTRACT_NOVEL_INPUT.title,
        );
      if (!novel) throw new Error("契约前置作品不存在");
      const now = new Date().toISOString();
      await port.saveGlobalFindings(novel.id, [
        {
          id: "rule:location-jump:e1:s1",
          novelId: novel.id,
          source: "rule",
          severity: "warning",
          category: "location",
          message: "位置跳变",
          evidence: "第 1 章 → 第 3 章",
          suggestion: "补移动事件",
          targetKind: "setting",
          targetName: "林舟",
          chapterPosition: 3,
          status: "open",
          createdAt: now,
        },
      ]);
      let stored = await port.listGlobalFindings(novel.id);
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({
        id: "rule:location-jump:e1:s1",
        source: "rule",
        severity: "warning",
        suggestion: "补移动事件",
        targetKind: "setting",
        chapterPosition: 3,
        status: "open",
      });
      // 第二次保存是整体替换（各端由上层合并规则/AI 来源后写入）。
      await port.saveGlobalFindings(novel.id, []);
      stored = await port.listGlobalFindings(novel.id);
      expect(stored).toHaveLength(0);
    });
  });
}

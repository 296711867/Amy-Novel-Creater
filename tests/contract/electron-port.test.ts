/**
 * Electron 数据适配的契约入口：NovelDatabase（内存 SQLite）经与
 * novel-ipc 相同的方法名映射接入共享契约套件。
 */
import { afterAll, describe } from "vitest";
import { NovelDatabase } from "../../src/main/db/database";
import {
  registerPlatformPortContract,
  type ContractPort,
} from "./platform-port.contract";

const database = await NovelDatabase.open(":memory:");
afterAll(() => database.close());

const port: ContractPort = {
  ready: () => Promise.resolve(),
  createNovel: (input) => database.createNovel(input),
  listNovels: () => database.listNovels(),
  // novel-ipc 将端口的 updateNovelSettings 映射到数据库的 updateCycleSize。
  updateNovelSettings: (novelId, patch) =>
    database.updateCycleSize(novelId, patch.cycleSize),
  listChapters: (novelId) => database.listChapters(novelId),
  saveChapter: (input) => database.saveChapter(input),
  createChapterSnapshot: (chapterId) => database.createChapterSnapshot(chapterId),
  listChapterVersions: (chapterId) => database.listChapterVersions(chapterId),
  createGenerationDraft: (novelId, policy) =>
    database.createGenerationBatch(novelId, policy),
  getPlanningWorkflow: (novelId) => database.getPlanningWorkflow(novelId),
  createWorkflowRun: (input) => database.createWorkflowRun(input),
  updateWorkflowRun: (input) => database.updateWorkflowRun(input),
  listWorkflowRuns: (novelId) => database.listWorkflowRuns(novelId),
  saveStyleTemplate: (input) => database.saveStyleTemplate(input),
  listStyleTemplates: () => database.listStyleTemplates(),
  importNovelProject: (bundle) => database.importNovelProject(bundle),
  listStoryEntities: (novelId) => database.listStoryEntities(novelId),
  listPlanningProposals: (novelId) => database.listPlanningProposals(novelId),
};

describe("Electron（NovelDatabase）", () => {
  registerPlatformPortContract("Electron", () => port);
});

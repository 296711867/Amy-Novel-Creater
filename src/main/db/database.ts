import { createClient, type Client } from "@libsql/client";
import type { NovelProjectBundle } from "@domain/project-export";
import { runMigrations } from "./migrations";
import { createNovelsRepository } from "./repositories/novels";
import { createChaptersRepository } from "./repositories/chapters";
import { createStoryStructureRepository } from "./repositories/story-structure";
import { createStoryBibleRepository } from "./repositories/story-bible";
import { createContinuityRepository } from "./repositories/continuity";
import { createGenerationRepository } from "./repositories/generation";
import { createUsageRepository } from "./repositories/usage";
import { createModelProfilesRepository } from "./repositories/model-profiles";
import { createNamePoolRepository } from "./repositories/name-pools";
import type { NamePool } from "@domain/name-pool";
import { createPlanningWorkflowRepository } from "./repositories/planning-workflow";
import { assertPlanningReady } from "@domain/planning-workflow";
import { createPlanningRunsRepository } from "./repositories/planning-runs";
import { createPlanningCyclesRepository } from "./repositories/planning-cycles";
import type { SavePlanningCycleInput } from "@domain/planning-cycle";
import {
  pendingFactProposalCount,
  type GenerationPolicy,
} from "@domain/generation";
import { createPlanningProposalsRepository } from "./repositories/planning-proposals";
import { createStyleTemplatesRepository } from "./repositories/style-templates";
import { createWorkflowRunsRepository } from "./repositories/workflow-runs";
import {
  createGlobalFindingsRepository,
  type GlobalFindingsRepository,
} from "./repositories/global-findings";
import type { GlobalFinding } from "@domain/global-consistency";

/**
 * Thin facade over the domain repositories. Public API signatures must stay
 * stable: src/main/ipc/novel-ipc.ts and tests/main/*.test.ts depend on them.
 */
export class NovelDatabase {
  private readonly novels;
  private readonly chapters;
  private readonly structure;
  private readonly bible;
  private readonly continuity;
  private readonly generation;
  private readonly usage;
  private readonly profiles;
  private readonly namePools;
  private readonly planningWorkflow;
  private readonly planningRuns;
  private readonly planningCycles;
  private readonly planningProposals;
  private readonly styleTemplates;
  private readonly workflowRuns;
  private readonly globalFindings: GlobalFindingsRepository;

  private constructor(private readonly client: Client) {
    this.novels = createNovelsRepository(client);
    this.chapters = createChaptersRepository(client);
    this.structure = createStoryStructureRepository(client);
    this.bible = createStoryBibleRepository(client);
    this.continuity = createContinuityRepository(client);
    this.generation = createGenerationRepository(client, this.chapters);
    this.usage = createUsageRepository(client);
    this.profiles = createModelProfilesRepository(client);
    this.namePools = createNamePoolRepository(client);
    this.planningWorkflow = createPlanningWorkflowRepository(client);
    this.planningRuns = createPlanningRunsRepository(client);
    this.planningCycles = createPlanningCyclesRepository(client);
    this.planningProposals = createPlanningProposalsRepository(client);
    this.styleTemplates = createStyleTemplatesRepository(client);
    this.workflowRuns = createWorkflowRunsRepository(client);
    this.globalFindings = createGlobalFindingsRepository(client);
  }

  static async open(path: string): Promise<NovelDatabase> {
    const db = new NovelDatabase(createClient({ url: `file:${path}` }));
    await runMigrations(db.client);
    return db;
  }

  close(): void {
    this.client.close();
  }

  getNamePool(novelId: string, genre: string): Promise<NamePool> {
    return this.namePools.getNamePool(novelId, genre);
  }
  saveNamePool(pool: NamePool): Promise<NamePool> {
    return this.namePools.saveNamePool(pool);
  }
  getPlanningWorkflow(novelId: string) {
    return this.planningWorkflow.getPlanningWorkflow(novelId);
  }
  savePlanningWorkflow(
    workflow: Parameters<typeof this.planningWorkflow.savePlanningWorkflow>[0],
  ) {
    return this.planningWorkflow.savePlanningWorkflow(workflow);
  }
  startPlanningRun(input: Parameters<typeof this.planningRuns.start>[0]) {
    return this.planningRuns.start(input);
  }
  recordPlanningResponse(
    id: string,
    response: Parameters<typeof this.planningRuns.received>[1],
  ) {
    return this.planningRuns.received(id, response);
  }
  recordPlanningRepair(
    id: string,
    response: Parameters<typeof this.planningRuns.repaired>[1],
  ) {
    return this.planningRuns.repaired(id, response);
  }
  completePlanningRun(id: string) {
    return this.planningRuns.complete(id);
  }
  failPlanningRun(id: string, error: string) {
    return this.planningRuns.fail(id, error);
  }
  listPlanningRuns(novelId: string) {
    return this.planningRuns.list(novelId);
  }
  listPlanningCycles(novelId: string) {
    return this.planningCycles.list(novelId);
  }
  createWorkflowRun(input: Parameters<typeof this.workflowRuns.create>[0]) {
    return this.workflowRuns.create(input);
  }
  updateWorkflowRun(input: Parameters<typeof this.workflowRuns.update>[0]) {
    return this.workflowRuns.update(input);
  }
  listWorkflowRuns(novelId: string) {
    return this.workflowRuns.list(novelId);
  }
  async savePlanningCycle(input: SavePlanningCycleInput) {
    if (input.status === "completed") {
      const chapters = (await this.listChapters(input.novelId)).filter(
          (item) =>
            item.position >= input.startChapter &&
            item.position <= input.endChapter,
        ),
        candidates = (
          await Promise.all(
            chapters.map((item) => this.listChapterCandidates(item.id)),
          )
        )
          .flat()
          .filter((item) => item.status === "accepted"),
        proposals = (
          await Promise.all(
            candidates.map((item) => this.listFactProposals(item.id)),
          )
        ).flat(),
        pending = pendingFactProposalCount(proposals);
      if (pending)
        throw new Error(`本批仍有 ${pending} 条正史建议未处理，不能封存周期`);
    }
    return this.planningCycles.save(input);
  }
  listPlanningProposals(novelId: string) {
    return this.planningProposals.list(novelId);
  }
  listGlobalFindings(novelId: string): Promise<GlobalFinding[]> {
    return this.globalFindings.list(novelId);
  }
  saveGlobalFindings(
    novelId: string,
    findings: GlobalFinding[],
  ): Promise<GlobalFinding[]> {
    return this.globalFindings.replace(novelId, findings);
  }
  replacePlanningProposals(
    ...args: Parameters<typeof this.planningProposals.replacePending>
  ) {
    return this.planningProposals.replacePending(...args);
  }
  addPlanningProposals(
    ...args: Parameters<typeof this.planningProposals.addUnique>
  ) {
    return this.planningProposals.addUnique(...args);
  }
  updatePlanningProposalStatus(
    ...args: Parameters<typeof this.planningProposals.updateStatus>
  ) {
    return this.planningProposals.updateStatus(...args);
  }

  listNovels() {
    return this.novels.listNovels();
  }
  deleteNovel(id: string) {
    return this.novels.deleteNovel(id);
  }
  importNovelProject(bundle: NovelProjectBundle) {
    return this.novels.importNovelProject(bundle);
  }
  getNovel(id: string) {
    return this.novels.getNovel(id);
  }
  createNovel(input: Parameters<typeof this.novels.createNovel>[0]) {
    return this.novels.createNovel(input);
  }
  updateCycleSize(id: string, cycleSize: number) {
    return this.novels.updateCycleSize(id, cycleSize);
  }

  listChapters(novelId: string) {
    return this.chapters.listChapters(novelId);
  }
  getChapter(chapterId: string) {
    return this.chapters.getChapter(chapterId);
  }
  saveChapter(input: Parameters<typeof this.chapters.saveChapter>[0]) {
    return this.chapters.saveChapter(input);
  }
  createChapter(input: Parameters<typeof this.chapters.createChapter>[0]) {
    return this.chapters.createChapter(input);
  }
  updateChapterPlan(
    input: Parameters<typeof this.chapters.updateChapterPlan>[0],
  ) {
    return this.chapters.updateChapterPlan(input);
  }
  deleteChapter(id: string) {
    return this.chapters.deleteChapter(id);
  }
  reorderChapters(novelId: string, ids: string[]) {
    return this.chapters.reorderChapters(novelId, ids);
  }
  listChapterVersions(chapterId: string) {
    return this.chapters.listChapterVersions(chapterId);
  }
  createChapterSnapshot(
    chapterId: string,
    origin?: Parameters<typeof this.chapters.createChapterSnapshot>[1],
  ) {
    return this.chapters.createChapterSnapshot(chapterId, origin);
  }

  listStoryStructure(novelId: string) {
    return this.structure.listStoryStructure(novelId);
  }
  saveVolume(input: Parameters<typeof this.structure.saveVolume>[0]) {
    return this.structure.saveVolume(input);
  }
  deleteVolume(id: string) {
    return this.structure.deleteVolume(id);
  }
  reorderVolumes(novelId: string, ids: string[]) {
    return this.structure.reorderVolumes(novelId, ids);
  }
  saveScene(input: Parameters<typeof this.structure.saveScene>[0]) {
    return this.structure.saveScene(input);
  }
  deleteScene(id: string) {
    return this.structure.deleteScene(id);
  }
  reorderScenes(chapterId: string, ids: string[]) {
    return this.structure.reorderScenes(chapterId, ids);
  }

  saveContextSnapshot(
    novelId: string,
    pack: Parameters<typeof this.generation.saveContextSnapshot>[1],
  ) {
    return this.generation.saveContextSnapshot(novelId, pack);
  }
  listContextSnapshots(novelId: string, chapterId?: string) {
    return this.generation.listContextSnapshots(novelId, chapterId);
  }

  saveUsage(input: Parameters<typeof this.usage.saveUsage>[0]) {
    return this.usage.saveUsage(input);
  }
  listUsage(novelId?: string) {
    return this.usage.listUsage(novelId);
  }

  listModelProfiles() {
    return this.profiles.listModelProfiles();
  }
  getModelProfile(id: string) {
    return this.profiles.getModelProfile(id);
  }
  saveModelProfile(
    input: Parameters<typeof this.profiles.saveModelProfile>[0],
    hasSecret: boolean,
  ) {
    return this.profiles.saveModelProfile(input, hasSecret);
  }
  deleteModelProfile(id: string) {
    return this.profiles.deleteModelProfile(id);
  }

  listStyleTemplates() {
    return this.styleTemplates.list();
  }
  getStyleTemplate(id: string) {
    return this.styleTemplates.get(id);
  }
  saveStyleTemplate(input: Parameters<typeof this.styleTemplates.save>[0]) {
    return this.styleTemplates.save(input);
  }
  deleteStyleTemplate(id: string) {
    return this.styleTemplates.remove(id);
  }

  createChapterCandidate(
    input: Parameters<typeof this.generation.createChapterCandidate>[0],
  ) {
    return this.generation.createChapterCandidate(input);
  }
  getChapterCandidate(id: string) {
    return this.generation.getChapterCandidate(id);
  }
  listChapterCandidates(chapterId: string) {
    return this.generation.listChapterCandidates(chapterId);
  }
  updateChapterCandidateContent(id: string, content: string) {
    return this.generation.updateChapterCandidateContent(id, content);
  }
  setCandidateStatus(id: string, status: "accepted" | "rejected") {
    return this.generation.setCandidateStatus(id, status);
  }
  async createGenerationBatch(
    novelId: string,
    policy: GenerationPolicy,
  ) {
    const workflow = await this.getPlanningWorkflow(novelId);
    if (!workflow.confirmedSteps.includes(9))
      throw new Error("请先完成小说框架十步向导和一致性检查");
    const novel = await this.getNovel(novelId);
    if (!novel) throw new Error("作品不存在");
    const [sections, entities, structure, chapters, cycles] = await Promise.all([
      this.listBibleSections(novelId),
      this.listStoryEntities(novelId),
      this.listStoryStructure(novelId),
      this.listChapters(novelId),
      this.listPlanningCycles(novelId),
    ]);
    const cycle = cycles.find(
      (item) =>
        policy.startChapter >= item.startChapter &&
        policy.endChapter <= item.endChapter &&
        ["ready", "generating"].includes(item.status),
    );
    if (!cycle)
      throw new Error(
        `第 ${policy.startChapter}–${policy.endChapter} 章不在已通过一致性检查的策划包范围内`,
      );
    assertPlanningReady({
      novel,
      sections,
      entities,
      volumes: structure.volumes,
      chapters,
      range: {
        startChapter: policy.startChapter,
        endChapter: policy.endChapter,
      },
    });
    const batch = await this.generation.createGenerationBatch(novelId, policy);
    await this.savePlanningCycle({ ...cycle, status: "generating" });
    return batch;
  }
  listGenerationBatches() {
    return this.generation.listGenerationBatches();
  }
  async deleteGenerationBatch(id: string) {
    // AN-029：只允许清理已完结的批次记录；进行中/等待审核的批次先停止再删，
    // 防止误删运行中的任务与待审正史链。
    const batch = await this.generation.getGenerationBatch(id);
    if (!batch) throw new Error("Batch not found");
    if (batch.status !== "completed" && batch.status !== "cancelled")
      throw new Error("仅已完成或已取消的批次可删除；请先停止该批次");
    return this.generation.deleteGenerationBatch(id);
  }
  getGenerationBatch(id: string) {
    return this.generation.getGenerationBatch(id);
  }
  listGenerationJobs(batchId: string) {
    return this.generation.listGenerationJobs(batchId);
  }
  recoverGenerationJobs(batchId: string) {
    return this.generation.recoverGenerationJobs(batchId);
  }
  saveFindings(
    candidateId: string,
    chapterId: string,
    items: Parameters<typeof this.generation.saveFindings>[2],
  ) {
    return this.generation.saveFindings(candidateId, chapterId, items);
  }
  listFindings(candidateId: string) {
    return this.generation.listFindings(candidateId);
  }
  updateFinding(
    id: string,
    status: Parameters<typeof this.generation.updateFinding>[1],
  ) {
    return this.generation.updateFinding(id, status);
  }
  listFactProposals(candidateId: string) {
    return this.generation.listFactProposals(candidateId);
  }
  saveFactProposals(
    candidateId: string,
    chapterId: string,
    items: Parameters<typeof this.generation.saveFactProposals>[2],
  ) {
    return this.generation.saveFactProposals(candidateId, chapterId, items);
  }
  updateFactProposal(
    id: string,
    status: Parameters<typeof this.generation.updateFactProposal>[1],
  ) {
    return this.generation.updateFactProposal(id, status);
  }
  setBatchStatus(
    id: string,
    status: Parameters<typeof this.generation.setBatchStatus>[1],
    patch?: Parameters<typeof this.generation.setBatchStatus>[2],
  ) {
    return this.generation.setBatchStatus(id, status, patch);
  }
  completeJobByCandidate(candidateId: string) {
    return this.generation.completeJobByCandidate(candidateId);
  }
  getJobByCandidate(candidateId: string) {
    return this.generation.getJobByCandidate(candidateId);
  }
  saveGenerationEvent(
    input: Parameters<typeof this.generation.saveGenerationEvent>[0],
  ) {
    return this.generation.saveGenerationEvent(input);
  }
  listGenerationEvents(batchId: string, limit?: number) {
    return this.generation.listGenerationEvents(batchId, limit);
  }
  updateGenerationJob(
    id: string,
    status: Parameters<typeof this.generation.updateGenerationJob>[1],
    patch?: Parameters<typeof this.generation.updateGenerationJob>[2],
  ) {
    return this.generation.updateGenerationJob(id, status, patch);
  }

  listBibleSections(novelId: string) {
    return this.bible.listBibleSections(novelId);
  }
  saveBibleSection(input: Parameters<typeof this.bible.saveBibleSection>[0]) {
    return this.bible.saveBibleSection(input);
  }
  listStoryEntities(
    novelId: string,
    type?: Parameters<typeof this.bible.listStoryEntities>[1],
  ) {
    return this.bible.listStoryEntities(novelId, type);
  }
  saveStoryEntity(input: Parameters<typeof this.bible.saveStoryEntity>[0]) {
    return this.bible.saveStoryEntity(input);
  }
  deleteStoryEntity(entityId: string) {
    return this.bible.deleteStoryEntity(entityId);
  }

  listTimelineEvents(novelId: string) {
    return this.continuity.listTimelineEvents(novelId);
  }
  saveTimelineEvent(
    input: Parameters<typeof this.continuity.saveTimelineEvent>[0],
  ) {
    return this.continuity.saveTimelineEvent(input);
  }
  deleteTimelineEvent(id: string) {
    return this.continuity.deleteTimelineEvent(id);
  }
  listForeshadowThreads(novelId: string) {
    return this.continuity.listForeshadowThreads(novelId);
  }
  saveForeshadowThread(
    input: Parameters<typeof this.continuity.saveForeshadowThread>[0],
  ) {
    return this.continuity.saveForeshadowThread(input);
  }
  deleteForeshadowThread(id: string) {
    return this.continuity.deleteForeshadowThread(id);
  }
  listCharacterStates(novelId: string, characterId?: string) {
    return this.continuity.listCharacterStates(novelId, characterId);
  }
  saveCharacterState(
    input: Parameters<typeof this.continuity.saveCharacterState>[0],
  ) {
    return this.continuity.saveCharacterState(input);
  }
  deleteCharacterState(id: string) {
    return this.continuity.deleteCharacterState(id);
  }
}

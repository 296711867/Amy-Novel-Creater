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

  listNovels() {
    return this.novels.listNovels();
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
  setCandidateStatus(id: string, status: "accepted" | "rejected") {
    return this.generation.setCandidateStatus(id, status);
  }
  createGenerationBatch(
    novelId: string,
    policy: Parameters<typeof this.generation.createGenerationBatch>[1],
  ) {
    return this.generation.createGenerationBatch(novelId, policy);
  }
  listGenerationBatches() {
    return this.generation.listGenerationBatches();
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
  ) {
    return this.generation.setBatchStatus(id, status);
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

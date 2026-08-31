/**
 * 真实 API 滚动十章闭环评估（默认跳过，仅 AMY_E2E_REAL=1 时执行）。
 *
 * 驱动方式与产品完全同构：
 * - 规划调用镜像 src/main/ipc/novel-ipc.ts 的 generateNovelPlan 处理器；
 * - 正文生成复用 src/main/generation/batch-runner.ts 的 BatchRunner；
 * - 提案审核复用 @application/review-planning-proposal；
 * - 接受正文与记忆回写镜像 renderer store 的 reviewCandidate / reviewFactProposal；
 * - 步骤确认镜像 PlanningWorkflowPage 的 confirmStep / finishCycle。
 *
 * 所有状态落在临时 SQLite 库（仓库外），可跨次续跑。
 */
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NovelDatabase } from "../../src/main/db/database";
import type { SecretVault } from "../../src/main/security/secret-vault";
import { BatchRunner } from "../../src/main/generation/batch-runner";
import { streamOpenAICompatible } from "../../src/main/model/openai-compatible";
import {
  novelPlanningPrompt,
  planningMaxOutputTokens,
  type PlanPhase,
  type PlanRange,
} from "@domain/planning";
import { applyNovelPlan } from "@application/apply-novel-plan";
import { reviewPlanningProposal } from "@application/review-planning-proposal";
import {
  confirmPlanningStep,
  evaluatePlanningChecks,
  invalidatePlanningFrom,
  type PlanningBrief,
} from "@domain/planning-workflow";
import { planningCycleRange } from "@domain/planning-cycle";
import type { PlanningCycle } from "@domain/planning-cycle";
import { namePoolText } from "@domain/name-pool";
import { buildContextPack, estimateTokens, selectRecentChapters } from "@domain/context-pack";
import { parseProposalPayload } from "@domain/fact-extraction";
import type { GenerationBatch } from "@domain/generation";

const REAL = process.env.AMY_E2E_REAL === "1";
const NOVEL_TITLE = "滚动十章评估·雾灯航路";
const BRIEF: PlanningBrief = {
  audience: "喜欢东方玄幻、成长流与规则怪谈结合的年轻读者",
  style: "第三人称限知，节奏明快，对话口语化，每章结尾留钩子",
  boundaries: "主角不能死亡；不后宫；不洗白主要反派；灯塔规则不可自相矛盾",
  sellingPoint: "必须靠点灯推进航路的规则世界，每章解一条规则并付出代价",
  conflict: "守灯人旧部想把灯塔权柄据为己有，主角要保住航路开放",
  protagonistGoal: "修好母亲留下的雾灯并驶出雾海；失败则航路永闭、同伴失散",
  ending: "主角重定灯约，雾海退去，代价是失去与灯灵的联结",
};

const WORK_DIR = join(tmpdir(), "amy-e2e");
const DB_FILE = join(WORK_DIR, "rolling-cycle.db");
const KEY_FILE = join(tmpdir(), "amy-e2e-key.txt");

interface ChapterMetrics {
  position: number;
  title: string;
  words: number;
  targetWords: number;
  errorFindings: number;
  factProposals: Record<string, number>;
  memoryFailures: string[];
}

const planningRunMetrics: Array<{
  phase: string;
  range: string;
  status: string;
  error: string;
  inputTokens: number;
  outputTokens: number;
  rawLength: number;
}> = [];
const chapterMetrics: ChapterMetrics[] = [];
const planningProposalFailures: string[] = [];
const issues: string[] = [];

function log(message: string): void {
  console.log(`[E2E ${new Date().toISOString().slice(11, 19)}] ${message}`);
}

let db: NovelDatabase;
let apiKey = "";
let novelId = "";

async function generatePlan(
  phase: PlanPhase,
  range?: PlanRange,
  attempts = 3,
): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await generatePlanOnce(phase, range);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`规划失败（第 ${attempt}/${attempts} 次）：${message}`);
      if (attempt === attempts) throw error;
    }
  }
}

async function generatePlanOnce(phase: PlanPhase, range?: PlanRange) {
  const novel = await db.getNovel(novelId);
  if (!novel) throw new Error("作品不存在");
  const profiles = await db.listModelProfiles();
  const profile = profiles.find((item) => item.isDefault) ?? profiles[0];
  const [bible, workflow, entities, chapters, namePool] = await Promise.all([
    db.listBibleSections(novelId),
    db.getPlanningWorkflow(novelId),
    db.listStoryEntities(novelId),
    db.listChapters(novelId),
    db.getNamePool(novelId, novel.genre),
  ]);
  const prompt = novelPlanningPrompt({
    phase,
    novel,
    bible,
    brief: workflow.brief,
    entities,
    chapters,
    range,
    namePoolText: namePoolText(namePool),
  });
  const run = await db.startPlanningRun({
    novelId,
    phase,
    startChapter: range?.startChapter,
    endChapter: range?.endChapter,
    profileId: profile.id,
    provider: profile.provider,
    model: profile.modelId,
    prompt,
  });
  log(
    `规划 ${phase}${range ? ` ${range.startChapter}-${range.endChapter}` : ""} run=${run.id} prompt=${prompt.length} 字符`,
  );
  try {
    const result = await streamOpenAICompatible(
      profile,
      apiKey,
      prompt,
      planningMaxOutputTokens(phase),
      0.7,
      () => {},
      fetch,
      undefined,
      "disabled",
    );
    const inputTokens = result.inputTokens || estimateTokens(prompt);
    const outputTokens = result.outputTokens || estimateTokens(result.content);
    await db.recordPlanningResponse(run.id, {
      rawResponse: result.content,
      inputTokens,
      outputTokens,
      cachedTokens: result.cachedTokens,
    });
    await db.saveUsage({
      novelId,
      chapterId: null,
      operation: "planning",
      provider: profile.provider,
      model: profile.modelId,
      inputTokens,
      outputTokens,
      cachedTokens: result.cachedTokens,
      cost: null,
      measurement:
        result.inputTokens || result.outputTokens ? "provider" : "estimated",
    });
    const summary = await applyNovelPlan({
      novel,
      phase,
      content: result.content,
      entities,
      namePool,
      range,
      store: db,
    });
    await db.completePlanningRun(run.id);
    planningRunMetrics.push({
      phase,
      range: range ? `${range.startChapter}-${range.endChapter}` : "-",
      status: "completed",
      error: "",
      inputTokens,
      outputTokens,
      rawLength: result.content.length,
    });
    log(`规划完成：${JSON.stringify(summary)}，输出 ${outputTokens} tokens`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "规划生成失败";
    await db.failPlanningRun(run.id, message);
    planningRunMetrics.push({
      phase,
      range: range ? `${range.startChapter}-${range.endChapter}` : "-",
      status: "failed",
      error: message,
      inputTokens: 0,
      outputTokens: 0,
      rawLength: 0,
    });
    throw error;
  }
}

async function confirmStep(step: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9) {
  const workflow = await db.getPlanningWorkflow(novelId);
  await db.savePlanningWorkflow(confirmPlanningStep(workflow, step));
  log(`已确认第 ${step} 步`);
}

async function currentCycle(): Promise<PlanningCycle | undefined> {
  const cycles = await db.listPlanningCycles(novelId);
  return cycles.find(
    (item) => !["completed", "superseded"].includes(item.status),
  );
}

/** 镜像 store.reviewFactProposal：接受候选稿并把事实提案写入正史记忆。 */
async function acceptCandidateWithMemory(candidateId: string) {
  const candidate = await db.getChapterCandidate(candidateId);
  if (!candidate) throw new Error("候选稿不存在");
  if (candidate.status === "candidate")
    await db.setCandidateStatus(candidateId, "accepted");
  const chapter = (await db.getChapter(candidate.chapterId))!;
  const metrics: ChapterMetrics = {
    position: chapter.position,
    title: chapter.title,
    words: candidate.content.replace(/\s+/g, "").length,
    targetWords: chapter.targetWords,
    errorFindings: 0,
    factProposals: {},
    memoryFailures: [],
  };
  const findings = await db.listFindings(candidateId);
  metrics.errorFindings = findings.filter(
    (item) => item.severity === "error" && item.status === "open",
  ).length;
  const proposals = await db.listFactProposals(candidateId);
  for (const proposal of proposals.filter((item) => item.status === "proposed")) {
    metrics.factProposals[proposal.kind] =
      (metrics.factProposals[proposal.kind] ?? 0) + 1;
    try {
      const parsed = parseProposalPayload(proposal);
      if (parsed.kind === "timeline") {
        const entities = await db.listStoryEntities(novelId);
        const names = parsed.payload.participants.map((name) => name.trim());
        const participantIds = entities
          .filter((entity) =>
            names.some(
              (name) => entity.name === name || entity.aliases.includes(name),
            ),
          )
          .map((entity) => entity.id);
        await db.saveTimelineEvent({
          novelId,
          chapterId: chapter.id,
          storyTime: parsed.payload.storyTime,
          title: proposal.title,
          detail: parsed.payload.detail,
          participantIds,
          source: "ai_candidate",
        });
      } else if (parsed.kind === "character_state") {
        const entities = await db.listStoryEntities(novelId, "character");
        const character = entities.find(
          (entity) =>
            entity.name === parsed.payload.characterName ||
            entity.aliases.includes(parsed.payload.characterName),
        );
        if (!character)
          throw new Error(
            `未找到角色“${parsed.payload.characterName}”，事实提案无法回写`,
          );
        await db.saveCharacterState({
          novelId,
          characterId: character.id,
          chapterId: chapter.id,
          summary: parsed.payload.summary,
          location: parsed.payload.location,
          physical: parsed.payload.physical,
          emotional: parsed.payload.emotional,
          knowledge: parsed.payload.knowledge,
          goals: parsed.payload.goals,
          inventory: parsed.payload.inventory,
          skills: parsed.payload.skills,
          source: "ai_candidate",
        });
      } else {
        await db.saveForeshadowThread({
          novelId,
          title: proposal.title,
          detail: parsed.payload.detail,
          setupChapterId:
            parsed.payload.status === "planned" ? null : chapter.id,
          payoffChapterId:
            parsed.payload.status === "resolved" ? chapter.id : null,
          status: parsed.payload.status,
          source: "ai_candidate",
        });
      }
      await db.updateFactProposal(proposal.id, "accepted");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      metrics.memoryFailures.push(
        `${proposal.kind}｜${proposal.title}｜${message}`,
      );
      await db.updateFactProposal(proposal.id, "rejected");
    }
  }
  chapterMetrics.push(metrics);
  log(
    `第 ${chapter.position} 章已接受：${metrics.words} 字，` +
      `事实提案 ${JSON.stringify(metrics.factProposals)}，` +
      `回写失败 ${metrics.memoryFailures.length} 条`,
  );
}

async function reviewCycleProposals(range: PlanRange) {
  const proposals = (await db.listPlanningProposals(novelId)).filter(
    (item) =>
      item.status === "pending" &&
      item.startChapter === range.startChapter &&
      item.endChapter === range.endChapter,
  );
  log(`待审核前置设定提案 ${proposals.length} 项`);
  for (const proposal of proposals) {
    try {
      await reviewPlanningProposal(db, novelId, proposal.id, "accepted");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      planningProposalFailures.push(
        `${proposal.action} ${proposal.targetType} ${proposal.targetName}｜${message}`,
      );
      await db.updatePlanningProposalStatus(proposal.id, "rejected");
    }
  }
}

async function passChecksAndReady(range: PlanRange) {
  const [novel, sections, entities, structure, chapters] = await Promise.all([
    db.getNovel(novelId),
    db.listBibleSections(novelId),
    db.listStoryEntities(novelId),
    db.listStoryStructure(novelId),
    db.listChapters(novelId),
  ]);
  const checks = evaluatePlanningChecks({
    novel: novel!,
    sections,
    entities,
    volumes: structure.volumes,
    chapters,
    range,
  });
  const failed = checks.filter((item) => !item.passed);
  if (failed.length)
    throw new Error(`一致性检查未通过：${failed.map((item) => item.label).join("；")}`);
  const cycle = await currentCycle();
  if (cycle) await db.savePlanningCycle({ ...cycle, status: "ready" });
  log(`范围 ${range.startChapter}-${range.endChapter} 七项检查全部通过，周期 ready`);
}

async function waitBatch(
  batchId: string,
  timeoutMs: number,
): Promise<GenerationBatch> {
  const started = Date.now();
  let lastLog = 0;
  for (;;) {
    const batch = await db.getGenerationBatch(batchId);
    if (!batch) throw new Error("批次不存在");
    if (["completed", "failed", "paused", "cancelled"].includes(batch.status))
      return batch;
    if (Date.now() - started > timeoutMs) throw new Error("批次执行超时");
    if (Date.now() - lastLog > 30_000) {
      const jobs = await db.listGenerationJobs(batchId);
      const counts = jobs.reduce((acc: Record<string, number>, item) => {
        acc[item.status] = (acc[item.status] ?? 0) + 1;
        return acc;
      }, {});
      log(
        `批次进行中：${JSON.stringify(counts)}，已用输出 ${batch.outputTokensUsed} tokens`,
      );
      lastLog = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
}

describe.skipIf(!REAL)("真实 API：滚动十章 1-10 生成 → 封存 → 11-20 规划", () => {
  beforeAll(async () => {
    mkdirSync(WORK_DIR, { recursive: true });
    apiKey = readFileSync(KEY_FILE, "utf8").trim();
    if (!apiKey) throw new Error(`缺少密钥文件 ${KEY_FILE}`);
    db = await NovelDatabase.open(`/${DB_FILE.replaceAll("\\", "/")}`);
    const existing = (await db.listNovels()).find(
      (item) => item.title === NOVEL_TITLE,
    );
    if (existing) {
      novelId = existing.id;
    } else {
      const created = await db.createNovel({
        title: NOVEL_TITLE,
        genre: "玄幻",
        premise:
          "雾海把大陆割成孤岛，只有点灯人驾驶灯船沿航路穿雾。少年林昭继承母亲留下的旧雾灯，" +
          "发现灯油烧的是记忆：每点亮一座雾中灯塔，就要交出一段过去。他想修好雾灯驶出雾海，" +
          "而守灯人旧部想夺回灯约，把航路重新锁进雾里。",
        targetChapters: 20,
        chapterWords: 800,
      });
      novelId = created.novel.id;
    }
    const profiles = await db.listModelProfiles();
    if (!profiles.length)
      await db.saveModelProfile(
        {
          name: "智谱 GLM（Coding Plan）",
          provider: "glm",
          modelId: "GLM-5.2",
          baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
          contextWindow: 128000,
          inputPricePerMillion: null,
          outputPricePerMillion: null,
          isDefault: true,
        },
        true,
      );
    log(`novel=${novelId} db=${DB_FILE}`);
  }, 60_000);

  afterAll(() => {
    if (db) db.close();
  });

  it(
    "步骤 1-2：创作简报",
    { timeout: 30_000 },
    async () => {
      const workflow = await db.getPlanningWorkflow(novelId);
      if (workflow.confirmedSteps.includes(2)) return log("已确认，跳过");
      await db.savePlanningWorkflow({
        ...workflow,
        novelId,
        brief: BRIEF,
        confirmedSteps: [1, 2],
        updatedAt: new Date().toISOString(),
      });
      log("简报已保存并确认步骤 1、2");
    },
  );

  it(
    "步骤 3：故事圣经",
    { timeout: 300_000 },
    async () => {
      const workflow = await db.getPlanningWorkflow(novelId);
      if (workflow.confirmedSteps.includes(3)) return log("已确认，跳过");
      await generatePlan("bible");
      await confirmStep(3);
    },
  );

  it(
    "步骤 4-6：人物体系与场景实体",
    { timeout: 900_000 },
    async () => {
      const workflow = await db.getPlanningWorkflow(novelId);
      if (!workflow.confirmedSteps.includes(4)) await confirmStep(4);
      if (!workflow.confirmedSteps.includes(5)) {
        await generatePlan("cast");
        await confirmStep(5);
      }
      if (!workflow.confirmedSteps.includes(6)) {
        await generatePlan("scenes", undefined, 5).catch(async (error) => {
          const entitiesNow = await db.listStoryEntities(novelId);
          const covered = ["location", "organization", "item"].every((type) =>
            entitiesNow.some((item) => item.type === type),
          );
          if (!covered)
            throw error;
          issues.push(
            `scenes 规划连续失败（${error instanceof Error ? error.message.slice(0, 120) : String(error)}），以圣经阶段实体顶替场景库继续`,
          );
          log("scenes 规划失败，但实体三类齐全，按作者确认继续");
        });
        await confirmStep(6);
      }
      const [entities, sections] = await Promise.all([
        db.listStoryEntities(novelId),
        db.listBibleSections(novelId),
      ]);
      log(
        `当前 ${sections.length} 份圣经文档、${entities.length} 张实体卡` +
          `（character=${entities.filter((i) => i.type === "character").length}，` +
          `location=${entities.filter((i) => i.type === "location").length}，` +
          `organization=${entities.filter((i) => i.type === "organization").length}，` +
          `item=${entities.filter((i) => i.type === "item").length}）`,
      );
    },
  );

  it(
    "步骤 7-9：第 1-10 章策划包 → 提案审核 → ready",
    { timeout: 900_000 },
    async () => {
      const workflow = await db.getPlanningWorkflow(novelId);
      const novel = (await db.getNovel(novelId))!;
      if (workflow.confirmedSteps.includes(9) && (await currentCycle())?.status === "ready")
        return log("周期 1 已 ready，跳过");
      const chapters = await db.listChapters(novelId);
      const range = planningCycleRange(chapters, novel.targetChapters);
      if (!range) throw new Error("找不到待规划范围");
      const alreadyPlanned =
        (await currentCycle())?.startChapter === range.startChapter &&
        chapters
          .filter((item) => item.position >= range.startChapter && item.position <= range.endChapter)
          .every((item) => item.outline.trim());
      if (!workflow.confirmedSteps.includes(7) && !alreadyPlanned) {
        await generatePlan("structure", range);
      }
      await confirmStep(7);
      const fresh = await currentCycle();
      if (!fresh) throw new Error("策划周期未建立");
      if (!workflow.confirmedSteps.includes(8)) {
        await reviewCycleProposals(range);
        await confirmStep(8);
      }
      if (!workflow.confirmedSteps.includes(9)) {
        await passChecksAndReady(range);
        await confirmStep(9);
      }
    },
  );

  it(
    "步骤 10：第 1-10 章正文生成（BatchRunner 真实流水线）",
    { timeout: 3_600_000 },
    async () => {
      const novel = (await db.getNovel(novelId))!;
      const cycle = await currentCycle();
      if (!cycle) return log("没有进行中的周期，跳过");
      const chapters = await db.listChapters(novelId);
      const inRange = chapters.filter(
        (item) =>
          item.position >= cycle.startChapter && item.position <= cycle.endChapter,
      );
      if (inRange.every((item) => item.status === "accepted"))
        return log("范围正文已全部接受，跳过生成");
      const runner = new BatchRunner(db, {
        get: async () => apiKey,
      } as unknown as SecretVault);
      const existing = (await db.listGenerationBatches())
        .filter(
          (item) =>
            item.novelId === novelId &&
            item.policy.startChapter === cycle.startChapter,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      let batch: GenerationBatch;
      if (
        existing &&
        ["queued", "running", "paused", "completed"].includes(existing.status)
      ) {
        batch = existing;
        if (batch.status !== "completed") {
          log(`恢复已有批次 ${batch.id}（${batch.status}）`);
          runner.start(batch.id);
          batch = await waitBatch(batch.id, 3_000_000);
        }
      } else {
        if (!["ready", "generating"].includes(cycle.status))
          throw new Error(`周期状态 ${cycle.status}，不能创建正文批次`);
        const created = await db.createGenerationBatch(novelId, {
          startChapter: cycle.startChapter,
          endChapter: cycle.endChapter,
          chapterWords: novel.chapterWords,
          continuityCheck: true,
          maxRetries: 2,
          approvalMode: "candidate",
          outputTokenBudget: 120_000,
          deepThinking: false,
        });
        log(`批次 ${created.id} 已创建，启动 BatchRunner`);
        runner.start(created.id);
        batch = await waitBatch(created.id, 3_000_000);
      }
      const jobs = await db.listGenerationJobs(batch.id);
      const failed = jobs.filter((item) => item.status === "failed");
      log(`批次结束：${batch.status}，jobs=${jobs.length}，failed=${failed.length}`);
      failed.forEach((item) => log(`失败任务：${item.error}`));
      expect(batch.status).toBe("completed");
    },
  );

  it(
    "步骤 10：接受 1-10 章正史并回写记忆",
    { timeout: 300_000 },
    async () => {
      const cycle = await currentCycle();
      if (!cycle) return log("周期已封存，跳过");
      const batches = await db.listGenerationBatches();
      const batch = batches
        .filter(
          (item) =>
            item.novelId === novelId &&
            item.policy.startChapter === cycle.startChapter,
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!batch) throw new Error("找不到正文批次");
      const jobs = (await db.listGenerationJobs(batch.id)).sort(
        (a, b) => a.position - b.position,
      );
      for (const job of jobs) {
        if (!job.candidateId) continue;
        const candidate = await db.getChapterCandidate(job.candidateId);
        if (candidate?.status === "accepted") continue;
        await acceptCandidateWithMemory(job.candidateId);
      }
      const chapters = await db.listChapters(novelId);
      const inRange = chapters.filter(
        (item) =>
          item.position >= cycle.startChapter && item.position <= cycle.endChapter,
      );
      expect(inRange.every((item) => item.status === "accepted")).toBe(true);
      log(`第 ${cycle.startChapter}-${cycle.endChapter} 章全部进入正史`);
    },
  );

  it(
    "封存周期 1：填写实际结束状态并回滚到第 7 步",
    { timeout: 60_000 },
    async () => {
      const cycle = await currentCycle();
      if (!cycle) return log("周期已封存，跳过");
      const guardChapters = await db.listChapters(novelId);
      const guardRange = guardChapters.filter(
        (item) =>
          item.position >= cycle.startChapter && item.position <= cycle.endChapter,
      );
      if (!guardRange.every((item) => item.status === "accepted"))
        throw new Error(
          `范围内仍有 ${guardRange.filter((item) => item.status !== "accepted").length} 章未接受，禁止封存`,
        );
      const [chapters, states, foreshadow, characters] = await Promise.all([
        db.listChapters(novelId),
        db.listCharacterStates(novelId),
        db.listForeshadowThreads(novelId),
        db.listStoryEntities(novelId, "character"),
      ]);
      const positionOf = (chapterId: string) =>
        chapters.find((item) => item.id === chapterId)?.position ?? 0;
      const latest = new Map<string, (typeof states)[number]>();
      for (const state of states) {
        const known = latest.get(state.characterId);
        if (!known || positionOf(state.chapterId) >= positionOf(known.chapterId))
          latest.set(state.characterId, state);
      }
      const stateLines = [...latest.values()]
        .map((state) => {
          const character = characters.find(
            (item) => item.id === state.characterId,
          );
          return character
            ? `${character.name}（第${positionOf(state.chapterId)}章）：位于${state.location || "未知"}；目标：${state.goals.join("、") || "无"}；持有：${state.inventory.join("、") || "无"}；技能：${state.skills.join("、") || "无"}`
            : "";
        })
        .filter(Boolean);
      const openThreads = foreshadow
        .filter((item) => !["resolved", "abandoned"].includes(item.status))
        .map((item) => `${item.title}（${item.status}）`);
      const actual = [
        `第 ${cycle.startChapter}-${cycle.endChapter} 章实际结束状态：`,
        ...stateLines,
        openThreads.length ? `未决伏笔：${openThreads.join("；")}` : "无未决伏笔",
      ].join("\n");
      await db.savePlanningCycle({
        ...cycle,
        status: "completed",
        actualClosingState: actual,
      });
      const workflow = await db.getPlanningWorkflow(novelId);
      await db.savePlanningWorkflow(invalidatePlanningFrom(workflow, 7));
      log(`周期 1 已封存，实际结束状态 ${actual.length} 字；工作流回滚到第 7 步`);
    },
  );

  it(
    "下一循环：第 11-20 章滚动规划 → 提案审核 → ready",
    { timeout: 900_000 },
    async () => {
      const workflow = await db.getPlanningWorkflow(novelId);
      const novel = (await db.getNovel(novelId))!;
      const cycle = await currentCycle();
      if (cycle?.status === "ready" && workflow.confirmedSteps.includes(9))
        return log("周期 2 已 ready，跳过");
      const chapters = await db.listChapters(novelId);
      const range = cycle
        ? { startChapter: cycle.startChapter, endChapter: cycle.endChapter }
        : planningCycleRange(chapters, novel.targetChapters);
      if (!range) throw new Error("找不到待规划范围");
      expect(range.startChapter).toBe(11);
      if (!workflow.confirmedSteps.includes(7)) {
        await generatePlan("structure", range);
        await confirmStep(7);
      }
      if (!workflow.confirmedSteps.includes(8)) {
        await reviewCycleProposals(range);
        await confirmStep(8);
      }
      if (!workflow.confirmedSteps.includes(9)) {
        await passChecksAndReady(range);
        await confirmStep(9);
      }
      const fresh = await db.listChapters(novelId);
      const planned = fresh.filter(
        (item) => item.position >= range.startChapter && item.position <= range.endChapter,
      );
      log(
        `第 11-20 章标题：${planned.map((item) => `${item.position}.${item.title}`).join("｜")}`,
      );
    },
  );

  it(
    "一致性评估：记忆进入第 11 章上下文 + 汇总",
    { timeout: 120_000 },
    async () => {
      const [novel, chapters, bible, entities, structure, timeline, foreshadow, states, usage] =
        await Promise.all([
          db.getNovel(novelId),
          db.listChapters(novelId),
          db.listBibleSections(novelId),
          db.listStoryEntities(novelId),
          db.listStoryStructure(novelId),
          db.listTimelineEvents(novelId),
          db.listForeshadowThreads(novelId),
          db.listCharacterStates(novelId),
          db.listUsage(novelId),
        ]);
      const chapter11 = chapters.find((item) => item.position === 11)!;
      const pack = buildContextPack({
        novel: novel!,
        chapter: chapter11,
        volume: structure.volumes.find((item) => item.id === chapter11.volumeId),
        scenes: structure.scenes.filter((item) => item.chapterId === chapter11.id),
        bible,
        entities,
        timeline: timeline.filter(
          (item) =>
            !item.chapterId ||
            (chapters.find((value) => value.id === item.chapterId)?.position ?? Infinity) <= 11,
        ),
        foreshadow,
        characterStates: states,
        recentChapters: selectRecentChapters(chapters, 11, []),
        inputBudget: 12000,
        outputTokensReserved: 1200,
      });
      const stateInContext = states.filter((state) =>
        pack.renderedText.includes(state.summary.slice(0, 8)),
      ).length;
      const totalInput = usage.reduce((acc, item) => acc + item.inputTokens, 0);
      const totalOutput = usage.reduce((acc, item) => acc + item.outputTokens, 0);
      log(
        `第 11 章 Context Pack ${pack.renderedText.length} 字符；` +
          `人物状态条目 ${states.length}，进入上下文 ${stateInContext}；` +
          `时间线 ${timeline.length}；伏笔 ${foreshadow.length}；` +
          `累计输入 ${totalInput} / 输出 ${totalOutput} tokens`,
      );
      issues.push(
        states.length && stateInContext === 0
          ? "封存记忆未出现在第 11 章 Context Pack"
          : "封存记忆已进入第 11 章 Context Pack",
      );
      const failedRuns = planningRunMetrics.filter((item) => item.status === "failed");
      log(
        `规划调用 ${planningRunMetrics.length} 次（失败 ${failedRuns.length} 次）；` +
          `设定提案回写失败 ${planningProposalFailures.length} 项；` +
          `记忆回写失败 ${chapterMetrics.flatMap((c) => c.memoryFailures).length} 条`,
      );
      console.log(
        JSON.stringify(
          {
            planningRuns: planningRunMetrics,
            chapters: chapterMetrics,
            planningProposalFailures,
            issues,
            usage: { totalInput, totalOutput },
          },
          null,
          2,
        ),
      );
      expect(
        chapters
          .filter((item) => item.position <= 10)
          .every((item) => item.status === "accepted"),
      ).toBe(true);
    },
  );
});

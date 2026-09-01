import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  Feather,
  Layers,
  Loader2,
  LockKeyhole,
  Map,
  Play,
  Sparkles,
  Users,
} from "lucide-react";
import { Navigate, NavLink, useParams } from "react-router-dom";
import type { PlanPhase } from "@domain/planning";
import { composeClosingState, planningCycleRange } from "@domain/planning-cycle";
import { CYCLE_SIZE_MAX, CYCLE_SIZE_MIN } from "@domain/novel";
import {
  characterTierOf,
  CHARACTER_TIER_LABELS,
} from "@domain/story-bible";
import type { PlanningProposalStatus } from "@domain/planning-proposal";
import type { PersonaSuggestion } from "@domain/persona-recommendation";
import {
  previousWorkflowPhase,
  WORKFLOW_CHECKPOINT_LABELS,
  WORKFLOW_MODE_LABELS,
  WORKFLOW_PHASE_LABELS,
  WORKFLOW_STATUS_LABELS,
  type WorkflowMode,
  type WorkflowPhase,
} from "@domain/workflow-run";
import {
  EMPTY_PLANNING_BRIEF,
  evaluatePlanningChecks,
  nextPlanningStep,
  type PlanningBrief,
  type PlanningReviewStep,
} from "@domain/planning-workflow";
import { useNovelStore } from "@renderer/store/novel-store";
import "../planning-workflow.css";

const PROPOSAL_STATUS_LABELS: Record<PlanningProposalStatus, string> = {
  pending: "待审核",
  accepted: "已接受",
  rejected: "已拒绝",
};

function wizardSteps(cycleSize: number) {
  return [
    [1, "创作目标", "题材、读者、篇幅与边界"],
    [2, "核心创意", "卖点、矛盾、目标与结局"],
    [3, "世界观与故事圣经", "建立可执行的世界规则"],
    [4, "主角及核心人物", "确认人物动机与成长弧线"],
    [5, "完整人物体系", "配角、反派、酱油与名称池"],
    [6, "场景与故事实体", "地点、势力、物品和复用场景"],
    [7, `滚动路线与当前 ${cycleSize} 章`, "只规划当前批次，不一次写完百章"],
    [8, "当前策划包审核", "审核标题、场景、人物和增补设定"],
    [9, "当前范围一致性检查", `检查当前 ${cycleSize} 章的结构和设定缺口`],
    [10, "当前范围正文生成", "生成后回写记忆，再进入下一循环"],
  ] as const;
}

/** 每步静态审核要点：告诉作者“看什么、什么算有问题”，不花 token。 */
const REVIEW_POINTS: Record<number, string[]> = {
  1: [
    "禁忌与不可改动项是全书死设定：AI 只是代笔占位，请务必逐条过目。",
    "文风要写成可操作规范（视角、节奏、对话密度、章末钩子），不是形容词。",
    "此步改动会使第 3 步以后的确认失效，需要重新审核后续步骤。",
  ],
  2: [
    "核心卖点用一句话说清“读者为什么追读”。",
    "主线矛盾必须不可回避：谁与谁因为什么必有一战。",
    "结局方向可以留细节，但成败与主角的最终变化要先定。",
  ],
  3: [
    "世界规则要可执行：约束、代价、例外缺一不可。",
    "文风圣经应给出具体文字规范，而不是氛围词。",
    "创作边界要与本第 1 步禁忌一致；发现冲突先回去改禁忌。",
  ],
  4: [
    "主角要有明确欲望与失败代价；对手与主角的矛盾要正面碰撞。",
    "人物卡只写设定，不写剧情。",
    "检查主角关系网是否支撑主线矛盾。",
  ],
  5: [
    "检查重名与功能重复：两个角色干同一件事就删掉或合并一个。",
    "酱油人物看“出现条件”是否具体可执行。",
    "名称池风格应与题材一致，新角色起名会参照它查重。",
    "人格批量确认后才会写入正式人物设定：主角/核心配角用完整人格模型，酱油只要简化标签。",
  ],
  6: [
    "每个场景 3–5 个视觉锚点，重复出场靠锚点保持一致。",
    "势力与关键物品必须服务主线冲突，不能只有名字。",
    "危险等级影响后续剧情尺度，注意前后一致。",
  ],
  7: [
    "只规划当前批次；全书只到卷级路线，属正常设计。",
    "每章标题独立、章纲两到四句、有冲突结果与章末钩子。",
    "章纲引用的人物/场景/道具名要与既有实体对得上。",
  ],
  8: [
    "逐项处理设定提案：接受=写入正史，拒绝=不影响。",
    "锁定设定不能被提案改写，尝试会直接报错。",
    "可手动改标题与章纲，改完再确认。",
  ],
  9: [
    "七项检查全过才会开放本批正文生成。",
    "未过的项目按提示回到对应步骤修改。",
  ],
  10: [
    "候选稿接受后才进入正史；全部接受后填写实际结束状态并封存。",
    "「由本批记忆生成」可从人物状态与未决伏笔拼草稿，改两笔即可。",
    "封存后本批成为下一批的开场记忆，不能再改。",
  ],
};

const EMPTY_LIST: never[] = [];

/** 三档检查点的运行语义，与 AUTOPILOT_WORKFLOW.md 第 6 节保持一致。 */
const WORKFLOW_MODE_OPTIONS: Array<{ value: WorkflowMode; caption: string }> = [
  {
    value: "checkpoint",
    caption:
      "圣经、人物、场景、卷章规划逐项生成后暂停，作者确认后续跑；正文按单章审批生成",
  },
  {
    value: "chapter",
    caption: "规划阶段连续推进；设定提案和每章候选稿仍暂停等待作者处理",
  },
  {
    value: "autopilot",
    caption: "当前批次候选稿连续生成，不自动接受、不写正史；设定提案仍需作者处理",
  },
];

/** 规划阶段对应的向导步骤：阶段审核暂停时引导作者直达审核位置。 */
const WORKFLOW_PHASE_STEPS: Record<WorkflowPhase, number> = {
  bible: 3,
  cast: 5,
  scenes: 6,
  structure: 7,
  generation: 10,
};

export function PlanningWorkflowPage(): React.JSX.Element {
  const { novelId = "" } = useParams();
  const novel = useNovelStore((state) =>
    state.novels.find((item) => item.id === novelId),
  );
  const chapters = useNovelStore(
    (state) => state.chapters[novelId] ?? EMPTY_LIST,
  );
  const sections = useNovelStore(
    (state) => state.bibleSections[novelId] ?? EMPTY_LIST,
  );
  const entities = useNovelStore(
    (state) => state.entities[novelId] ?? EMPTY_LIST,
  );
  const volumes = useNovelStore(
    (state) => state.volumes[novelId] ?? EMPTY_LIST,
  );
  const workflow = useNovelStore(
    (state) => state.planningWorkflows[novelId],
  );
  const planningCycles = useNovelStore(
    (state) => state.planningCycles[novelId] ?? EMPTY_LIST,
  );
  const planningRuns = useNovelStore(
    (state) => state.planningRuns[novelId] ?? EMPTY_LIST,
  );
  const planningProposals = useNovelStore(
    (state) => state.planningProposals[novelId] ?? EMPTY_LIST,
  );
  const workflowRuns = useNovelStore(
    (state) => state.workflowRuns[novelId] ?? EMPTY_LIST,
  );
  const loadBible = useNovelStore((state) => state.loadBible);
  const loadEntities = useNovelStore((state) => state.loadEntities);
  const loadStructure = useNovelStore((state) => state.loadStructure);
  const loadPlanningWorkflow = useNovelStore(
    (state) => state.loadPlanningWorkflow,
  );
  const loadPlanningCycles = useNovelStore(
    (state) => state.loadPlanningCycles,
  );
  const loadPlanningRuns = useNovelStore((state) => state.loadPlanningRuns);
  const loadPlanningProposals = useNovelStore(
    (state) => state.loadPlanningProposals,
  );
  const loadWorkflowRuns = useNovelStore((state) => state.loadWorkflowRuns);
  const startWorkflowRun = useNovelStore((state) => state.startWorkflowRun);
  const resumeWorkflowRun = useNovelStore(
    (state) => state.resumeWorkflowRun,
  );
  const cruise = useNovelStore((state) => state.cruise[novelId]);
  const startCruise = useNovelStore((state) => state.startCruise);
  const stopCruise = useNovelStore((state) => state.stopCruise);
  const resumeCruise = useNovelStore((state) => state.resumeCruise);
  const [cruiseTarget, setCruiseTarget] = useState(novel?.targetChapters ?? 30);
  const reviewPlanningProposal = useNovelStore(
    (state) => state.reviewPlanningProposal,
  );
  const savePlanningCycle = useNovelStore((state) => state.savePlanningCycle);
  const savePlanningBrief = useNovelStore((state) => state.savePlanningBrief);
  const confirmPlanningReview = useNovelStore(
    (state) => state.confirmPlanningReview,
  );
  const invalidatePlanning = useNovelStore((state) => state.invalidatePlanning);
  const generateNovelPlan = useNovelStore((state) => state.generateNovelPlan);
  const updateNovelSettings = useNovelStore(
    (state) => state.updateNovelSettings,
  );
  const suggestBrief = useNovelStore((state) => state.suggestBrief);
  const draftedBrief = useNovelStore((state) => state.draftedBrief);
  const briefDraftBusy = useNovelStore((state) => state.briefDraftBusy);
  const briefDraftError = useNovelStore((state) => state.briefDraftError);
  const clearDraftedBrief = useNovelStore((state) => state.clearDraftedBrief);
  const loadContinuity = useNovelStore((state) => state.loadContinuity);
  const characterStates = useNovelStore(
    (state) => state.characterStates[novelId] ?? EMPTY_LIST,
  );
  const foreshadowThreads = useNovelStore(
    (state) => state.foreshadowThreads[novelId] ?? EMPTY_LIST,
  );
  const busy = useNovelStore((state) => state.planningBusy[novelId] ?? null);
  const message = useNovelStore((state) => state.planningMessage[novelId] ?? "");
  const setPlanningMessage = useNovelStore(
    (state) => state.setPlanningMessage,
  );
  const planEvents = useNovelStore(
    (state) => state.activityEvents[`planning:${novelId}`] ?? EMPTY_LIST,
  );
  const loadActivity = useNovelStore((state) => state.loadActivity);
  const ensureActivityListener = useNovelStore(
    (state) => state.ensureActivityListener,
  );
  const [activeStep, setActiveStep] = useState(1);
  const [brief, setBrief] = useState<PlanningBrief>(EMPTY_PLANNING_BRIEF);
  const [closingState, setClosingState] = useState("");
  const [cycleSizeInput, setCycleSizeInput] = useState(novel?.cycleSize ?? 10);
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>("checkpoint");
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [aiElapsed, setAiElapsed] = useState(0);
  const [reviewingProposal, setReviewingProposal] = useState("");
  const aiBusy = briefDraftBusy || Boolean(busy);
  useEffect(() => {
    if (!aiBusy) {
      setAiElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const update = () => setAiElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [aiBusy]);
  useEffect(() => {
    setCycleSizeInput(novel?.cycleSize ?? 10);
  }, [novel?.cycleSize]);

  // 规划生成期间的阶段事件流：Electron 走广播，Web 用轮询兜底。
  useEffect(() => {
    ensureActivityListener();
    if (!aiBusy) return;
    void loadActivity(`planning:${novelId}`);
    const timer = window.setInterval(
      () => void loadActivity(`planning:${novelId}`),
      2000,
    );
    return () => window.clearInterval(timer);
  }, [aiBusy, novelId]);

  async function saveCycleSize() {
    setPlanningMessage(novelId, "");
    try {
      await updateNovelSettings(novelId, { cycleSize: cycleSizeInput });
      setPlanningMessage(novelId, `已保存：后续新批次按每批 ${Math.min(CYCLE_SIZE_MAX, Math.max(CYCLE_SIZE_MIN, Math.round(cycleSizeInput)))} 章规划。`);
    } catch (error) {
      setPlanningMessage(
        novelId,
        error instanceof Error ? error.message : "批次大小保存失败",
      );
    }
  }

  /** AI 代笔第 1–2 步七项简报；结果进草稿态，作者改完再确认。 */
  async function draftBrief() {
    if (!novel || briefDraftBusy) return;
    setPlanningMessage(novelId, "");
    const result = await suggestBrief({
      title: novel.title,
      genre: novel.genre,
      premise: novel.premise,
    });
    if (result) {
      setBrief(result);
      setPlanningMessage(
        novelId,
        "Amy 已起草七项简报（含第 2 步）。请逐项过目修改——尤其“禁忌与不可改动项”是全书死设定，务必亲自确认。",
      );
    }
  }

  /** 从本批已回写记忆拼装实际结束状态草稿，不调模型。 */
  function composeClosingFromMemory() {
    if (!currentRange) return;
    setClosingState(
      composeClosingState({
        characterStates,
        characters: entities
          .filter((item) => item.type === "character")
          .map((item) => ({ id: item.id, name: item.name })),
        chapters: chapters.map((item) => ({
          id: item.id,
          position: item.position,
        })),
        foreshadow: foreshadowThreads.map((item) => ({
          title: item.title,
          status: item.status,
        })),
        range: currentRange,
      }),
    );
  }

  useEffect(() => {
    if (!novelId) return;
    void Promise.all([
      loadBible(novelId),
      loadEntities(novelId),
      loadStructure(novelId),
      loadPlanningWorkflow(novelId),
      loadPlanningCycles(novelId),
      loadPlanningRuns(novelId),
      loadPlanningProposals(novelId),
      loadWorkflowRuns(novelId),
      loadContinuity(novelId),
    ]);
  }, [
    loadBible,
    loadContinuity,
    loadEntities,
    loadPlanningCycles,
    loadPlanningRuns,
    loadPlanningProposals,
    loadWorkflowRuns,
    loadPlanningWorkflow,
    loadStructure,
    novelId,
  ]);

  useEffect(() => {
    if (!workflow) return;
    const empty = Object.values(workflow.brief).every((value) => !value.trim());
    setBrief(empty && draftedBrief ? draftedBrief : workflow.brief);
    setActiveStep(nextPlanningStep(workflow));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.novelId, workflow?.updatedAt]);

  // 起草完成（含切页回来后草稿才返回的场景）只填充表单，不重置当前步骤。
  useEffect(() => {
    if (draftedBrief && Object.values(brief).every((value) => !value.trim()))
      setBrief(draftedBrief);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftedBrief]);

  const confirmed = workflow?.confirmedSteps ?? EMPTY_LIST;

  const characters = entities.filter((item) => item.type === "character");
  const tieredCharacters = characters.filter((item) => {
    const tier = characterTierOf(item);
    return tier !== null && tier !== "extra";
  });
  const personasConfirmed =
    tieredCharacters.length > 0 &&
    tieredCharacters.every((item) => (item.profile["人格"] ?? "").trim());
  const locations = entities.filter((item) => item.type === "location");
  const organizations = entities.filter((item) => item.type === "organization");
  const items = entities.filter((item) => item.type === "item");
  const currentCycle = planningCycles.find(
    (item) => !["completed", "superseded"].includes(item.status),
  );
  useEffect(() => {
    if (currentCycle)
      setClosingState(
        currentCycle.actualClosingState || currentCycle.expectedClosingState,
      );
  }, [currentCycle?.id]);
  const currentRange = currentCycle
    ? {
        startChapter: currentCycle.startChapter,
        endChapter: currentCycle.endChapter,
      }
    : planningCycleRange(
        chapters,
        novel?.targetChapters ?? 0,
        novel?.cycleSize,
      );
  const rangeChapters = currentRange
    ? chapters.filter(
        (item) =>
          item.position >= currentRange.startChapter &&
          item.position <= currentRange.endChapter,
      )
    : [];
  const checks = useMemo(
    () =>
      novel
        ? evaluatePlanningChecks({
            novel,
            sections,
            entities,
            volumes,
            chapters,
            range: currentRange ?? undefined,
          })
        : [],
    [chapters, currentRange?.endChapter, currentRange?.startChapter, entities, novel, sections, volumes],
  );

  if (!novel) return <Navigate to="/novels" replace />;

  const steps = wizardSteps(novel.cycleSize);
  const current = steps[activeStep - 1];
  const nextRequired = steps.find(
    ([id]) => id < 10 && !confirmed.includes(id as PlanningReviewStep),
  )?.[0] ?? 10;
  const stepOneMissing = [
    ["audience", "这本小说主要写给哪类读者？"],
    ["style", "你希望正文采用什么叙事风格和节奏？"],
    ["boundaries", "有哪些绝对不能出现的内容或不能改动的设定？"],
  ].filter(([key]) => !brief[key as keyof PlanningBrief].trim());
  const stepTwoMissing = [
    ["sellingPoint", "读者为什么要继续追读？请用一句话说出核心卖点。"],
    ["conflict", "贯穿全书的主线矛盾是什么？"],
    ["protagonistGoal", "主角最想得到什么，失败会失去什么？"],
    ["ending", "结局大致走向是什么？可以保留细节，但要确定方向。"],
  ].filter(([key]) => !brief[key as keyof PlanningBrief].trim());
  const bibleReady =
    sections.length >= 4 && sections.every((item) => item.content.trim());
  const coreCastReady = characters.length >= 2;
  const fullCastReady =
    characters.some((item) => characterTierOf(item) === "protagonist") &&
    characters.some((item) => characterTierOf(item) === "support") &&
    characters.some((item) => characterTierOf(item) === "recurring");
  const scenesReady =
    locations.length > 0 && organizations.length > 0 && items.length > 0;
  const volumesReady = volumes.length > 0;
  const cyclePlanned =
    !!currentCycle &&
    ["plan_review", "ready", "generating", "memory_review"].includes(
      currentCycle.status,
    );
  const chaptersReady =
    !!currentRange &&
    rangeChapters.length === currentRange.endChapter - currentRange.startChapter + 1 &&
    rangeChapters.every(
      (item) =>
        item.outline.trim() && !/^第\s*\d+\s*章$/.test(item.title.trim()),
    );
  const checksReady = checks.every((item) => item.passed);
  const acceptedCount = rangeChapters.filter(
    (item) => item.status === "accepted",
  ).length;
  const rangeAccepted =
    rangeChapters.length > 0 && acceptedCount === rangeChapters.length;
  const lastStructureRun = planningRuns.find(
    (item) =>
      item.phase === "structure" &&
      item.startChapter === currentRange?.startChapter &&
      item.endChapter === currentRange?.endChapter,
  );
  const currentProposals = planningProposals.filter(
    (item) =>
      item.cycleId === "entity-merge" ||
      (item.startChapter === currentRange?.startChapter &&
        item.endChapter === currentRange?.endChapter),
  );
  const pendingProposals = currentProposals.filter(
    (item) => item.status === "pending",
  );
  const latestWorkflowRun = workflowRuns[0];

  async function runAutopilot(resume = false) {
    if (!novel || !currentRange) return;
    setPlanningMessage(novelId, "");
    setWorkflowBusy(true);
    try {
      if (resume && latestWorkflowRun)
        await resumeWorkflowRun(latestWorkflowRun.id);
      else
        await startWorkflowRun(novel.id, workflowMode, {
          startChapter: currentRange.startChapter,
          endChapter: currentRange.endChapter,
          chapterWords: novel.chapterWords,
          continuityCheck: true,
          maxRetries: 2,
          approvalMode: "candidate",
          outputTokenBudget:
            (currentRange.endChapter - currentRange.startChapter + 1) * 6000,
        });
    } catch (error) {
      setPlanningMessage(
        novelId,
        error instanceof Error ? error.message : "自动运行启动失败",
      );
    } finally {
      setWorkflowBusy(false);
    }
  }

  async function confirmStep(step: PlanningReviewStep) {
    setPlanningMessage(novelId, "");
    try {
      if (step === 9 && currentCycle)
        await savePlanningCycle({ ...currentCycle, status: "ready" });
      await confirmPlanningReview(novelId, step);
      setActiveStep(Math.min(10, step + 1));
    } catch (error) {
      setPlanningMessage(
        novelId,
        error instanceof Error ? error.message : "确认失败",
      );
    }
  }

  async function saveBrief(step: 1 | 2) {
    setPlanningMessage(novelId, "");
    try {
      await savePlanningBrief(novelId, brief, step);
      clearDraftedBrief();
      setActiveStep(step + 1);
    } catch (error) {
      setPlanningMessage(
        novelId,
        error instanceof Error ? error.message : "保存失败",
      );
    }
  }

  async function reviewProposal(id: string, accept: boolean) {
    setPlanningMessage(novelId, "");
    setReviewingProposal(id);
    try {
      await reviewPlanningProposal(novelId, id, accept);
      setPlanningMessage(
        novelId,
        accept ? "设定提案已确认并写入故事实体。" : "设定提案已拒绝，正史未改变。",
      );
    } catch (error) {
      setPlanningMessage(
        novelId,
        error instanceof Error ? error.message : "提案审核失败",
      );
    } finally {
      setReviewingProposal("");
    }
  }

  async function finishCycle() {
    if (!currentCycle || !rangeAccepted || !closingState.trim()) return;
    setPlanningMessage(novelId, "");
    try {
      // AN-027 封存门禁：本批记忆将成为下一批的开场正史，先过全局校验。
      const globalErrors = await useNovelStore
        .getState()
        .collectGlobalErrors(novelId);
      if (globalErrors.length) {
        setPlanningMessage(
          novelId,
          `全局一致性校验发现 ${globalErrors.length} 项 error（例如：${globalErrors[0]}）。请到「连续性」页处理后再封存本批。`,
        );
        return;
      }
      await savePlanningCycle({
        ...currentCycle,
        status: "completed",
        actualClosingState: closingState.trim(),
      });
      await invalidatePlanning(novelId, 7);
      setActiveStep(7);
      setPlanningMessage(
        novelId,
        "本批次已封存，人物与剧情状态将作为下一批的开场记忆。",
      );
    } catch (error) {
      setPlanningMessage(
        novelId,
        error instanceof Error ? error.message : "批次封存失败",
      );
    }
  }

  async function runPlan(phase: PlanPhase) {
    if (phase === "structure" && !currentRange) {
      setPlanningMessage(
        novelId,
        "全部章节已经规划完成，无需创建新的批次策划包",
      );
      return;
    }
    // 进行中状态与结果文案都由 store 维护：切页回来按钮仍显示“正在生成”。
    try {
      await generateNovelPlan(
        novelId,
        phase,
        phase === "structure" ? currentRange ?? undefined : undefined,
      );
    } catch {
      // 失败文案已写入 store 的 planningMessage。
    }
  }

  function askText(): string {
    if (activeStep === 1)
      return stepOneMissing[0]?.[1] ?? "创作目标已经完整，请确认后进入核心创意。";
    if (activeStep === 2)
      return stepTwoMissing[0]?.[1] ?? "核心创意已经完整，请确认后让我建立世界观。";
    if (activeStep === 3)
      return bibleReady
        ? "故事圣经已生成。请打开检查世界规则、文风和边界，满意后再确认。"
        : "信息已足够。现在可以生成世界观与故事圣经初稿。";
    if (activeStep === 4)
      return coreCastReady
        ? "请重点检查主角欲望、代价、对手关系和成长弧线。"
        : "还没有核心人物，请先回到上一步生成故事圣经。";
    if (activeStep === 5)
      if (!fullCastReady)
        return "我会补齐核心配角、反派、酱油人物和龙套名称池。";
      return personasConfirmed
        ? "人格阵容已批量确认。请最后检查重名、功能重复和人物关系。"
        : "人物已经分层。接下来我会一次推荐整个阵容的人格，你逐个调整后批量确认。";
    if (activeStep === 6)
      return scenesReady
        ? "场景库已建立，请确认视觉锚点和叙事用途是否清晰。"
        : "我会生成可反复使用、细节保持一致的场景卡。";
    if (activeStep === 7)
      return cyclePlanned
        ? `第 ${currentRange?.startChapter}–${currentRange?.endChapter} 章策划包已生成。请审核阶段目标、人物、场景和增补设定。`
        : `我会参考前六步，只规划第 ${currentRange?.startChapter}–${currentRange?.endChapter} 章，同时保留全书宏观路线。`;
    if (activeStep === 8)
      return chaptersReady && pendingProposals.length === 0
        ? "请逐章检查标题、登场人物、使用场景、事件推进、伏笔和章末钩子。可扩展设定可以补充，锁定设定不能静默改写。"
        : pendingProposals.length
          ? `AI 提出了 ${pendingProposals.length} 项前置设定增补，请逐项接受或拒绝。`
          : `当前 ${novel?.cycleSize ?? 10} 章策划包还不完整，请返回上一步重新生成或手动补齐。`;
    if (activeStep === 9)
      return checksReady
        ? "当前范围七项硬性检查全部通过。确认后只开放这一批正文生成。"
        : `还有 ${checks.filter((item) => !item.passed).length} 项未通过，请先修正。`;
    return `第 ${currentRange?.startChapter}–${currentRange?.endChapter} 章已通过审核。正文完成并确认后，系统会回写人物、道具、技能、时间线和伏笔状态，再规划下一批。`;
  }

  return (
    <main className="workflow-shell">
      <header className="workflow-head">
        <NavLink to="/novels">
          <ArrowLeft size={16} /> 我的作品
        </NavLink>
        <div>
          <span>{novel.genre} · 框架向导</span>
          <h1>{novel.title}</h1>
        </div>
        <b>第 {activeStep} / 10 步</b>
      </header>

      <div className="workflow-layout">
        <aside className="workflow-steps" aria-label="小说框架工作流">
          <div className="workflow-progress">
            <span style={{ width: `${((nextRequired - 1) / 9) * 100}%` }} />
          </div>
          {steps.map(([id, title, caption]) => {
            const done =
              id < 10 && confirmed.includes(id as PlanningReviewStep);
            const locked = id > nextRequired && !done;
            return (
              <button
                key={id}
                className={activeStep === id ? "active" : done ? "done" : ""}
                disabled={locked}
                onClick={() => setActiveStep(id)}
              >
                <i>
                  {done ? (
                    <Check size={14} />
                  ) : locked ? (
                    <LockKeyhole size={13} />
                  ) : (
                    id
                  )}
                </i>
                <span>
                  <b>{title}</b>
                  <small>{caption}</small>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="workflow-canvas">
          <div className="workflow-title">
            <span className="kicker">STEP {activeStep}</span>
            <h2>{current[1]}</h2>
            <p>{current[2]}</p>
          </div>

          <div className="workflow-guide">
            <div className="amy-avatar"><Sparkles size={18} /></div>
            <div>
              <b>Amy 正在引导这一步</b>
              <p>{askText()}</p>
            </div>
          </div>

          <div className="workflow-card review-points">
            <b>审核要点</b>
            <ul>
              {REVIEW_POINTS[activeStep].map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>

          {activeStep === 1 && (
            <div className="workflow-card">
              {workflow?.scopeAdvice && (
                <details className="saved-scope-strategy" open>
                  <summary>创建项目时保存的篇幅策略</summary>
                  <div className="brief-facts">
                    <span><b>{workflow.scopeAdvice.recommendation.totalChapters}</b>建议章节</span>
                    <span><b>{workflow.scopeAdvice.recommendation.chapterWords}</b>单章字数</span>
                    <span><b>{workflow.scopeAdvice.recommendation.estimatedDays}</b>预计天数</span>
                  </div>
                  <p>{workflow.scopeAdvice.recommendation.reason}</p>
                  <small>
                    {workflow.scopeAdvice.recommendation.tierLabel} · 日更 {workflow.scopeAdvice.recommendation.dailyChapters} 章 ·
                    {workflow.scopeAdvice.volumeSkeleton.length} 卷 · {workflow.scopeAdvice.milestones.length} 个关键里程碑
                  </small>
                </details>
              )}
              <div className="brief-draft-bar">
                <button
                  className="secondary"
                  disabled={briefDraftBusy}
                  onClick={() => void draftBrief()}
                >
                  <Sparkles size={15} />
                  {briefDraftBusy
                    ? "Amy 正在起草…"
                    : draftedBrief
                      ? "重新起草七项简报"
                      : "让 Amy 起草全部简报（第 1–2 步）"}
                </button>
                <span>
                  AI 只代笔占位，尤其“禁忌与不可改动项”是全书死设定，请务必逐条过目再确认。
                </span>
              </div>
              {briefDraftError && <div className="error">{briefDraftError}</div>}
              <div className="brief-facts">
                <span><b>{novel.genre}</b>题材</span>
                <span><b>{novel.targetChapters}</b>章</span>
                <span><b>{novel.targetWords.toLocaleString()}</b>目标字数</span>
              </div>
              <label>
                目标读者
                <input
                  value={brief.audience}
                  onChange={(event) => setBrief({ ...brief, audience: event.target.value })}
                  placeholder="例如：喜欢成长、系统流和轻松冒险的年轻读者"
                />
              </label>
              <label>
                文风与阅读体验
                <textarea
                  rows={3}
                  value={brief.style}
                  onChange={(event) => setBrief({ ...brief, style: event.target.value })}
                  placeholder="例如：第三人称限知，节奏明快，对话自然，每章结尾留钩子"
                />
              </label>
              <label className="boundaries-field">
                禁忌与不可改动项
                <small>全书死设定红线：AI 后续任何提案都不得触碰这里写下的内容。</small>
                <textarea
                  rows={3}
                  value={brief.boundaries}
                  onChange={(event) => setBrief({ ...brief, boundaries: event.target.value })}
                  placeholder="例如：不后宫、不洗白反派；主角不能失去已有记忆"
                />
              </label>
              <button
                className="primary workflow-next"
                disabled={stepOneMissing.length > 0}
                onClick={() => void saveBrief(1)}
              >
                保存并确认 <ArrowRight size={16} />
              </button>
            </div>
          )}

          {activeStep === 2 && (
            <div className="workflow-card">
              <div className="premise-note">
                <b>最初的核心设定</b>
                <p>{novel.premise || "尚未填写核心设定"}</p>
              </div>
              {([
                ["sellingPoint", "核心卖点", "一句话说明这本书最吸引人的独特体验"],
                ["conflict", "主线矛盾", "谁与谁因为什么产生无法回避的冲突"],
                ["protagonistGoal", "主角目标与失败代价", "主角想得到什么，失败会失去什么"],
                ["ending", "结局方向", "胜利、失败、开放式，及主角最终发生的变化"],
              ] as const).map(([key, label, placeholder]) => (
                <label key={key}>
                  {label}
                  <textarea
                    rows={2}
                    value={brief[key]}
                    onChange={(event) => setBrief({ ...brief, [key]: event.target.value })}
                    placeholder={placeholder}
                  />
                </label>
              ))}
              <button
                className="primary workflow-next"
                disabled={stepTwoMissing.length > 0}
                onClick={() => void saveBrief(2)}
              >
                保存并确认 <ArrowRight size={16} />
              </button>
            </div>
          )}

          {activeStep === 3 && (
            <StageCard
              icon={BookOpen}
              count={`${sections.filter((item) => item.content.trim()).length} / 4 份文档`}
              ready={bibleReady}
              busy={busy === "bible"}
              generateLabel="生成故事圣经"
              reviewLabel="审核故事圣经"
              reviewTo={`/novels/${novelId}/bible?mode=documents`}
              onGenerate={() => void runPlan("bible")}
              onConfirm={() => confirmStep(3)}
            />
          )}

          {activeStep === 4 && (
            <ReviewCard
              icon={Users}
              summary={`已建立 ${characters.length} 名核心人物`}
              ready={coreCastReady}
              reviewTo={`/novels/${novelId}/bible?mode=entities&type=character`}
              reviewLabel="审核人物卡"
              onConfirm={() => confirmStep(4)}
            />
          )}

          {activeStep === 5 && (
            <>
              <StageCard
                icon={Users}
                count={`${characters.length} 名人物`}
                ready={fullCastReady && personasConfirmed}
                busy={busy === "cast"}
                generateLabel="生成人物体系与名称池"
                reviewLabel="审核人物分层"
                reviewTo={`/novels/${novelId}/bible?mode=entities&type=character`}
                onGenerate={() => void runPlan("cast")}
                onConfirm={() => confirmStep(5)}
              />
              <PersonaPanel novelId={novelId} confirmed={personasConfirmed} />
            </>
          )}

          {activeStep === 6 && (
            <StageCard
              icon={Map}
              count={`${locations.length} 个场景 · ${organizations.length} 个势力 · ${items.length} 个物品`}
              ready={scenesReady}
              busy={busy === "scenes"}
              generateLabel="生成场景与故事实体"
              reviewLabel="审核场景库"
              reviewTo={`/novels/${novelId}/bible?mode=entities&type=location`}
              onGenerate={() => void runPlan("scenes")}
              onConfirm={() => confirmStep(6)}
            />
          )}

          {activeStep === 7 && (
            <>
              <StageCard
                icon={Layers}
                count={`当前：第 ${currentRange?.startChapter ?? "–"}–${currentRange?.endChapter ?? "–"} 章 · ${rangeChapters.filter((item) => item.outline.trim()).length} 章已规划`}
                ready={volumesReady && cyclePlanned && chaptersReady}
                busy={busy === "structure"}
                generateLabel={`生成当前 ${novel.cycleSize} 章策划包`}
                reviewLabel="审核当前章节规划"
                reviewTo={`/novels/${novelId}/structure`}
                onGenerate={() => void runPlan("structure")}
                onConfirm={() => confirmStep(7)}
              />
              <div className="workflow-card cycle-size-card">
                <label>
                  每批规划章数（{CYCLE_SIZE_MIN}–{CYCLE_SIZE_MAX}）
                  <div className="workflow-actions">
                    <input
                      type="number"
                      min={CYCLE_SIZE_MIN}
                      max={CYCLE_SIZE_MAX}
                      step="1"
                      value={cycleSizeInput}
                      onChange={(event) =>
                        setCycleSizeInput(Number(event.target.value))
                      }
                    />
                    <button
                      className="secondary"
                      disabled={
                        !Number.isFinite(cycleSizeInput) ||
                        cycleSizeInput < CYCLE_SIZE_MIN ||
                        cycleSizeInput > CYCLE_SIZE_MAX ||
                        cycleSizeInput === novel.cycleSize
                      }
                      onClick={() => void saveCycleSize()}
                    >
                      保存批次大小
                    </button>
                  </div>
                </label>
                <p>
                  已开始的批次不受影响，调整后从下一个新批次生效。批次越大单次规划
                  JSON 越长、失败率越高；越小则周期审核越频繁。
                </p>
              </div>
              {lastStructureRun && (
                <details className="workflow-card planning-run-log">
                  <summary>
                    最近生成记录 · {lastStructureRun.status} · 输入 {lastStructureRun.inputTokens} / 输出 {lastStructureRun.outputTokens} Token
                  </summary>
                  {lastStructureRun.error && <p className="error">{lastStructureRun.error}</p>}
                  <p>原始响应</p>
                  <pre>{lastStructureRun.rawResponse || "模型尚未返回内容"}</pre>
                  {lastStructureRun.repairResponse && (
                    <>
                      <p>低温修复响应</p>
                      <pre>{lastStructureRun.repairResponse}</pre>
                    </>
                  )}
                </details>
              )}
            </>
          )}

          {activeStep === 8 && (
            <>
              <ReviewCard
                icon={Feather}
                summary={`第 ${currentRange?.startChapter ?? "–"}–${currentRange?.endChapter ?? "–"} 章：${rangeChapters.filter((item) => item.outline.trim()).length} / ${rangeChapters.length} 章已完成标题与章纲`}
                ready={chaptersReady && pendingProposals.length === 0}
                reviewTo={`/novels/${novelId}/structure`}
                reviewLabel="逐章审核与修改"
                onConfirm={() => confirmStep(8)}
              />
              {currentProposals.length > 0 && (
                <div className="workflow-card proposal-list">
                  <h3>前六步设定增补提案</h3>
                  <p>AI 只能提交提案，未接受前不会进入正史；名称、类型和锁定字段不能被提案改写。</p>
                  {currentProposals.map((item) => (
                    <article key={item.id}>
                      <div>
                        <b>{item.action === "add" ? "新增" : item.action === "merge" ? "合并" : "更新"} · {item.targetName}</b>
                        <span>{item.targetType} · {PROPOSAL_STATUS_LABELS[item.status]}</span>
                      </div>
                      <p>{item.reason}</p>
                      <pre>{JSON.stringify(item.patch, null, 2)}</pre>
                      {item.status === "pending" && (
                        <div className="workflow-actions">
                          <button
                            className="secondary"
                            disabled={reviewingProposal === item.id}
                            onClick={() => void reviewProposal(item.id, false)}
                          >
                            拒绝
                          </button>
                          <button
                            className="primary"
                            disabled={reviewingProposal === item.id}
                            onClick={() => void reviewProposal(item.id, true)}
                          >
                            {reviewingProposal === item.id ? (
                              <Loader2 size={15} className="workflow-busy-spin" />
                            ) : null}
                            {reviewingProposal === item.id ? "写入中…" : "接受并写入设定"}
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}

          {activeStep === 9 && (
            <div className="workflow-card check-list">
              {checks.map((item) => (
                <div key={item.label} className={item.passed ? "passed" : ""}>
                  {item.passed ? <CheckCircle2 size={19} /> : <Circle size={19} />}
                  <span>{item.label}</span>
                </div>
              ))}
              <div className="workflow-actions">
                <NavLink className="secondary" to={`/novels/${novelId}/structure`}>
                  返回修改
                </NavLink>
                <button
                  className="primary"
                  disabled={!checksReady}
                  onClick={() => confirmStep(9)}
                >
                  通过总检 <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {activeStep === 10 && (
            <>
              <div className="workflow-card cruise-card">
                <h3>全自动巡航</h3>
                {cruise?.enabled ? (
                  <>
                    <p className="cruise-status" data-status={cruise.status}>
                      <b>{cruise.status === "active" ? "巡航中" : "已暂停"}</b>
                      {cruise.message}
                    </p>
                    <div className="workflow-actions">
                      {cruise.status === "paused" && (
                        <button
                          className="primary"
                          onClick={() => resumeCruise(novelId)}
                        >
                          继续巡航（从中断处续跑）
                        </button>
                      )}
                      <button
                        className="secondary"
                        onClick={() =>
                          stopCruise(novelId, "巡航已手动停止，自动接受一并收工。")
                        }
                      >
                        停止巡航
                      </button>
                    </div>
                    <small>
                      停止条件：到达目标章数 / 运行报错 / 批次 Token 预算耗尽 /
                      全局校验出现 error。暂停原因会记录在上面的状态里，
                      处理后点「继续巡航」即可；中途关闭应用，重启后自动续跑。
                    </small>
                  </>
                ) : (
                  <>
                    <p>
                      一个按钮循环跑到目标章数：周期规划（设定提案自动接受）→
                      正文连写与正史建议自动接受 → 封存（实际结束状态自动起草）→
                      下一周期。全程留痕，事后可用故事总览/整书连读回看审计。
                    </p>
                    <div className="cruise-form">
                      <label>
                        巡航到第几章
                        <input
                          type="number"
                          min={1}
                          max={novel?.targetChapters ?? 999}
                          value={cruiseTarget}
                          onChange={(event) =>
                            setCruiseTarget(Number(event.target.value) || 0)
                          }
                        />
                      </label>
                      <button
                        className="primary"
                        disabled={!novel || cruiseTarget < 1}
                        onClick={() => {
                          if (!novel) return;
                          const target = Math.min(
                            cruiseTarget,
                            novel.targetChapters,
                          );
                          if (
                            !window.confirm(
                              `开启全自动巡航：从当前进度连跑到第 ${target} 章。期间设定提案与正文候选将由 AI 自动接受（写入正史），只在出错、批次 Token 预算耗尽或全局校验异常时暂停。确定开始吗？`,
                            )
                          )
                            return;
                          setCruiseTarget(target);
                          startCruise(novelId, target);
                        }}
                      >
                        开启巡航
                      </button>
                    </div>
                    <small>
                      建议先跑完一卷人工确认质量后再开；十步向导完成后即可使用。
                    </small>
                  </>
                )}
              </div>
              <div className="workflow-card autopilot-card">
                <h3>Autopilot 自动运行</h3>
                <p>
                  选定检查点档位后，Amy 自动推进规划与当前批次正文。候选稿和设定提案
                  仍受正史门禁约束，任何未审核内容都不会写入正史。
                </p>
                <div className="autopilot-modes">
                  {WORKFLOW_MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={workflowMode === option.value ? "selected" : ""}
                      disabled={workflowBusy}
                      onClick={() => setWorkflowMode(option.value)}
                    >
                      <b>{WORKFLOW_MODE_LABELS[option.value]}</b>
                      <small>{option.caption}</small>
                    </button>
                  ))}
                </div>
                {latestWorkflowRun && (
                  <div
                    className="autopilot-run"
                    data-status={latestWorkflowRun.status}
                  >
                    <header>
                      <b>
                        {WORKFLOW_MODE_LABELS[latestWorkflowRun.mode]} ·{" "}
                        {WORKFLOW_PHASE_LABELS[latestWorkflowRun.currentPhase]}
                      </b>
                      <span>
                        {WORKFLOW_STATUS_LABELS[latestWorkflowRun.status]}
                      </span>
                    </header>
                    {latestWorkflowRun.checkpoint && (
                      <p>
                        等待{WORKFLOW_CHECKPOINT_LABELS[latestWorkflowRun.checkpoint]}
                        ，处理后点“继续运行”。
                      </p>
                    )}
                    {latestWorkflowRun.error && (
                      <p className="error">{latestWorkflowRun.error}</p>
                    )}
                    <small>
                      启动于{" "}
                      {new Date(latestWorkflowRun.createdAt).toLocaleString()}
                      {latestWorkflowRun.batchId
                        ? ` · 批次 ${latestWorkflowRun.batchId}`
                        : ""}
                    </small>
                  </div>
                )}
                <div className="workflow-actions autopilot-actions">
                  {latestWorkflowRun?.status === "running" || workflowBusy ? (
                    <span className="autopilot-state">
                      <Loader2 size={15} className="workflow-busy-spin" />
                      {latestWorkflowRun
                        ? `Amy 正在推进：${WORKFLOW_PHASE_LABELS[latestWorkflowRun.currentPhase]}`
                        : "正在启动…"}
                    </span>
                  ) : latestWorkflowRun &&
                    (latestWorkflowRun.status === "paused" ||
                      latestWorkflowRun.status === "failed") ? (
                    <button
                      className="primary"
                      disabled={workflowBusy}
                      onClick={() => void runAutopilot(true)}
                    >
                      {workflowBusy ? (
                        <Loader2 size={15} className="workflow-busy-spin" />
                      ) : (
                        <Play size={15} />
                      )}
                      {latestWorkflowRun.status === "failed"
                        ? "重试运行"
                        : "继续运行"}
                    </button>
                  ) : (
                    <button
                      className="primary"
                      disabled={workflowBusy || !currentRange}
                      onClick={() => void runAutopilot(false)}
                    >
                      <Play size={15} /> 启动自动运行
                    </button>
                  )}
                  {latestWorkflowRun?.checkpoint === "phase_review" && (
                    <button
                      className="secondary"
                      onClick={() =>
                        setActiveStep(
                          WORKFLOW_PHASE_STEPS[
                            previousWorkflowPhase(latestWorkflowRun!.currentPhase)
                          ] ?? 3,
                        )
                      }
                    >
                      查看待审核步骤
                    </button>
                  )}
                  {latestWorkflowRun?.checkpoint === "proposal_review" && (
                    <button
                      className="secondary"
                      onClick={() => setActiveStep(8)}
                    >
                      去第 8 步审核提案
                    </button>
                  )}
                  {(latestWorkflowRun?.checkpoint === "chapter_review" ||
                    latestWorkflowRun?.currentPhase === "generation") && (
                    <NavLink
                      className="secondary"
                      to={`/novels/${novelId}/generate`}
                    >
                      生成工作台
                    </NavLink>
                  )}
                </div>
              </div>
              <div className="workflow-card workflow-finish">
              <div className="finish-icon"><CheckCircle2 size={36} /></div>
              <h3>小说框架已准备完成</h3>
              <p>
                Amy 将只生成第 {currentRange?.startChapter}–{currentRange?.endChapter} 章候选稿。候选内容审核后才进入正史，并触发本批次记忆回写。
              </p>
              <p>正史确认进度：{acceptedCount} / {rangeChapters.length} 章</p>
              {!rangeAccepted ? (
                <NavLink className="primary" to={`/novels/${novelId}/generate`}>
                  <Play size={17} /> 配置当前范围正文生成
                </NavLink>
              ) : (
                <>
                  <label>
                    本批次实际结束状态
                    <textarea
                      rows={4}
                      value={closingState}
                      onChange={(event) => setClosingState(event.target.value)}
                      placeholder="概括人物位置、状态、已获得或失去的道具技能、未决矛盾和下一批开场条件"
                    />
                  </label>
                  <div className="workflow-actions closing-actions">
                    <button
                      className="secondary"
                      onClick={composeClosingFromMemory}
                    >
                      <Sparkles size={15} /> 由本批记忆生成
                    </button>
                    <button
                      className="primary"
                      disabled={!closingState.trim()}
                      onClick={() => void finishCycle()}
                    >
                      确认记忆回写，规划下一批 <ArrowRight size={16} />
                    </button>
                  </div>
                </>
              )}
              </div>
            </>
          )}

          {message && <div className="model-result">{message}</div>}
        </section>
      </div>
      {aiBusy && (
        <div className="scope-busy-backdrop" role="dialog" aria-modal="true" aria-label="Amy 正在生成规划内容">
          <div className="scope-busy-card">
            <span className="scope-busy-spinner" aria-hidden="true" />
            <h2>{briefDraftBusy ? "Amy 正在起草创作简报" : "Amy 正在生成规划内容"}</h2>
            <p>
              {briefDraftBusy
                ? "正在整理目标读者、文风边界、核心卖点与主线冲突。"
                : "正在读取本项目设定并生成结构化结果，完成后会自动保存到当前小说。"}
            </p>
            {planEvents.length > 0 && (
              <ul className="plan-busy-events">
                {planEvents.slice(-5).map((event) => (
                  <li key={event.id} data-level={event.level}>
                    {event.message}
                  </li>
                ))}
              </ul>
            )}
            <strong>已用时 {aiElapsed} 秒</strong>
            <small>简报最长等待 120 秒，后续大型规划最长等待 300 秒。完成前页面暂时锁定。</small>
          </div>
        </div>
      )}
    </main>
  );
}

export function PersonaPanel({
  novelId,
  confirmed,
}: {
  novelId: string;
  confirmed: boolean;
}) {
  const store = useNovelStore(),
    drafts = useNovelStore((s) => s.personaDrafts[novelId]) ?? EMPTY_LIST,
    busy = useNovelStore((s) => s.personaBusy[novelId] ?? false),
    message = useNovelStore((s) => s.personaMessage[novelId] ?? ""),
    [confirming, setConfirming] = useState(false),
    [result, setResult] = useState("");
  async function suggest() {
    setResult("");
    const suggestions = await store.suggestPersonas(novelId);
    if (suggestions)
      setResult(
        `Amy 已为 ${suggestions.length} 名人物推荐人格，请逐个调整后批量确认。`,
      );
  }
  async function confirm() {
    setConfirming(true);
    setResult("");
    try {
      const written = await store.confirmPersonas(novelId, drafts);
      setResult(
        written
          ? `已批量确认 ${written} 名人物的人格并写入正式设定。`
          : "没有可写入的人物，请先生成人物体系。",
      );
    } catch (error) {
      setResult(error instanceof Error ? error.message : "批量确认失败");
    } finally {
      setConfirming(false);
    }
  }
  function patch(name: string, key: keyof PersonaSuggestion, value: string) {
    store.updatePersonaDraft(novelId, name, { [key]: value });
  }
  return (
    <div className="workflow-card persona-panel">
      <h3>人格阵容 · 批量确认</h3>
      <p>
        Amy 一次推荐整个人物阵容的人格与写作行为约束；主角和核心配角用完整人格模型，
        常驻酱油人物只要简化性格标签，跑龙套不推荐。你逐个调整后点“批量确认”，
        确认前不会写入正式人物设定。
      </p>
      {message && <div className="error">{message}</div>}
      {result && <div className="persona-result">{result}</div>}
      {confirmed && !drafts.length ? (
        <div className="persona-confirmed">
          <CheckCircle2 size={16} /> 人物阵容人格已确认，将参与正文生成与一致性检查。
        </div>
      ) : (
        <div className="workflow-actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void suggest()}
          >
            <Sparkles size={15} />
            {busy ? "Amy 正在推荐…" : drafts.length ? "重新推荐人格阵容" : "让 Amy 推荐人格阵容"}
          </button>
          {drafts.length > 0 && (
            <button
              className="primary"
              disabled={confirming || busy}
              onClick={() => void confirm()}
            >
              {confirming ? (
                <Loader2 size={15} className="workflow-busy-spin" />
              ) : (
                <Check size={15} />
              )}
              {confirming ? "写入中…" : `批量确认人物阵容（${drafts.length} 名）`}
            </button>
          )}
        </div>
      )}
      {drafts.length > 0 && (
        <div className="persona-list">
          {drafts.map((item) => (
            <article key={item.entityName}>
              <header>
                <b>{item.entityName}</b>
                <span>
                  {CHARACTER_TIER_LABELS[item.tier]}
                  {item.tier === "recurring" ? " · 简化标签" : " · 完整人格"}
                </span>
              </header>
              <label>
                {item.tier === "recurring" ? "性格标签" : "人格类型"}
                <input
                  value={item.personaType}
                  onChange={(event) =>
                    patch(item.entityName, "personaType", event.target.value)
                  }
                />
              </label>
              {item.reason && <small>推荐理由：{item.reason}</small>}
              <label>
                写作行为约束
                <textarea
                  rows={2}
                  value={item.writingConstraints}
                  onChange={(event) =>
                    patch(
                      item.entityName,
                      "writingConstraints",
                      event.target.value,
                    )
                  }
                />
              </label>
              {item.tier !== "recurring" && (
                <label>
                  语言习惯
                  <input
                    value={item.speechHabit}
                    onChange={(event) =>
                      patch(item.entityName, "speechHabit", event.target.value)
                    }
                  />
                </label>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function StageCard({
  icon: Icon,
  count,
  ready,
  busy,
  generateLabel,
  reviewLabel,
  reviewTo,
  onGenerate,
  onConfirm,
}: {
  icon: typeof Sparkles;
  count: string;
  ready: boolean;
  busy: boolean;
  generateLabel: string;
  reviewLabel: string;
  reviewTo: string;
  onGenerate(): void;
  onConfirm(): void;
}) {
  return (
    <div className="workflow-card stage-card">
      <div className="stage-summary"><Icon size={24} /><b>{count}</b></div>
      <div className="workflow-actions">
        <button className={ready ? "secondary" : "primary"} disabled={busy} onClick={onGenerate}>
          <Sparkles size={16} /> {busy ? "Amy 正在生成…" : ready ? "重新生成" : generateLabel}
        </button>
        {ready && <NavLink className="secondary" to={reviewTo}>{reviewLabel}</NavLink>}
        <button className="primary" disabled={!ready || busy} onClick={onConfirm}>
          确认这一步 <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

function ReviewCard({
  icon: Icon,
  summary,
  ready,
  reviewTo,
  reviewLabel,
  onConfirm,
}: {
  icon: typeof Sparkles;
  summary: string;
  ready: boolean;
  reviewTo: string;
  reviewLabel: string;
  onConfirm(): void;
}) {
  return (
    <div className="workflow-card stage-card">
      <div className="stage-summary"><Icon size={24} /><b>{summary}</b></div>
      <div className="workflow-actions">
        <NavLink className="secondary" to={reviewTo}>{reviewLabel}</NavLink>
        <button className="primary" disabled={!ready} onClick={onConfirm}>
          确认这一步 <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}

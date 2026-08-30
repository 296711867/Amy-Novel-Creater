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
import { characterTierOf } from "@domain/story-bible";
import {
  EMPTY_PLANNING_BRIEF,
  evaluatePlanningChecks,
  nextPlanningStep,
  type PlanningBrief,
  type PlanningReviewStep,
} from "@domain/planning-workflow";
import { useNovelStore } from "@renderer/store/novel-store";
import "../planning-workflow.css";

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
  const [activeStep, setActiveStep] = useState(1);
  const [brief, setBrief] = useState<PlanningBrief>(EMPTY_PLANNING_BRIEF);
  const [closingState, setClosingState] = useState("");
  const [cycleSizeInput, setCycleSizeInput] = useState(novel?.cycleSize ?? 10);
  useEffect(() => {
    setCycleSizeInput(novel?.cycleSize ?? 10);
  }, [novel?.cycleSize]);

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
      loadContinuity(novelId),
    ]);
  }, [
    loadBible,
    loadContinuity,
    loadEntities,
    loadPlanningCycles,
    loadPlanningRuns,
    loadPlanningProposals,
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
      item.startChapter === currentRange?.startChapter &&
      item.endChapter === currentRange?.endChapter,
  );
  const pendingProposals = currentProposals.filter(
    (item) => item.status === "pending",
  );

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
    }
  }

  async function finishCycle() {
    if (!currentCycle || !rangeAccepted || !closingState.trim()) return;
    setPlanningMessage(novelId, "");
    try {
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
      return fullCastReady
        ? "人物已经分层，请检查重名、功能重复和人物关系。"
        : "我会补齐核心配角、反派、酱油人物和龙套名称池。";
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
            <StageCard
              icon={Users}
              count={`${characters.length} 名人物`}
              ready={fullCastReady}
              busy={busy === "cast"}
              generateLabel="生成人物体系与名称池"
              reviewLabel="审核人物分层"
              reviewTo={`/novels/${novelId}/bible?mode=entities&type=character`}
              onGenerate={() => void runPlan("cast")}
              onConfirm={() => confirmStep(5)}
            />
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
                  <pre>{lastStructureRun.rawResponse || "模型尚未返回内容"}</pre>
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
                        <b>{item.action === "add" ? "新增" : "更新"} · {item.targetName}</b>
                        <span>{item.targetType} · {item.status}</span>
                      </div>
                      <p>{item.reason}</p>
                      <pre>{JSON.stringify(item.patch, null, 2)}</pre>
                      {item.status === "pending" && (
                        <div className="workflow-actions">
                          <button className="secondary" onClick={() => void reviewProposal(item.id, false)}>拒绝</button>
                          <button className="primary" onClick={() => void reviewProposal(item.id, true)}>接受并写入设定</button>
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
          )}

          {message && <div className="model-result">{message}</div>}
        </section>
      </div>
    </main>
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

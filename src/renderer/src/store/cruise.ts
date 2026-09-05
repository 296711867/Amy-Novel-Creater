import { platform } from "@renderer/platform/web-platform";
import { useNovelStore } from "./novel-store";
import type { NovelStateGet, NovelStateSet } from "./utils";
import {
  WORKFLOW_PHASE_LABELS,
  workflowRunUpdateFromBatch,
} from "@domain/workflow-run";
import {
  cruisePolicy,
  draftClosingState,
  nextCycleRange,
  type CruiseState,
} from "@domain/workflow-cruise";
import { omitKey } from "./utils";

/** AN-035 巡航：定时器、防重入锁、失败计数与持久化。 */
const CRUISE_INTERVAL_MS = 3000;
const CRUISE_STORAGE_KEY = "amy-novel:cruise";
const cruiseTimers = new Map<string, number>();
const cruiseTicking = new Set<string>();
const cruiseFailures = new Map<string, number>();
/** 单轮检查看门狗时限：规划模型调用最长等待 300 秒，留足余量。 */
const CRUISE_TICK_TIMEOUT_MS = 390_000;
const CRUISE_BUDGET_TOP_UP = 60_000;

export function readPersistedCruise(): Record<string, CruiseState> {
  try {
    const raw = window.localStorage.getItem(CRUISE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, CruiseState>)
      : {};
  } catch {
    return {};
  }
}

function persistCruiseStates(states: Record<string, CruiseState>) {
  try {
    window.localStorage.setItem(CRUISE_STORAGE_KEY, JSON.stringify(states));
  } catch {
    // 持久化失败不阻断巡航本身。
  }
}

export function armCruiseTimer(novelId: string) {
  const timer = cruiseTimers.get(novelId);
  if (timer !== undefined) window.clearInterval(timer);
  cruiseTimers.set(
    novelId,
    window.setInterval(
      () => void useNovelStore.getState().tickCruise(novelId),
      CRUISE_INTERVAL_MS,
    ),
  );
}

function noteCruise(novelId: string, message: string) {
  const state = useNovelStore.getState();
  const current = state.cruise[novelId];
  if (!current?.enabled || current.message === message) return;
  const next = { ...current, message, updatedAt: new Date().toISOString() };
  useNovelStore.setState({
    cruise: { ...state.cruise, [novelId]: next },
  });
}

/** 巡航暂停：停在原地、记录原因、等待作者「继续巡航」。 */
function pauseCruise(novelId: string, message: string) {
  const state = useNovelStore.getState();
  const current = state.cruise[novelId];
  if (!current?.enabled || current.status === "paused") return;
  const next = {
    ...current,
    status: "paused" as const,
    message,
    updatedAt: new Date().toISOString(),
  };
  useNovelStore.setState({ cruise: { ...state.cruise, [novelId]: next } });
  persistCruiseStates(useNovelStore.getState().cruise);
}

export function createCruiseActions(set: NovelStateSet, get: NovelStateGet) {
  return {
  startCruise(novelId, targetChapter) {
    const entry: CruiseState = {
      enabled: true,
      status: "active",
      targetChapter,
      message: "巡航已开启：正在检查当前进度（首轮可能含 1–5 分钟模型规划，实时动态见「生成任务」页）…",
      updatedAt: new Date().toISOString(),
    };
    set({ cruise: { ...get().cruise, [novelId]: entry } });
    persistCruiseStates(get().cruise);
    get().setAutoReview(novelId, true, "巡航模式：自动接受已联动开启。");
    cruiseFailures.delete(novelId);
    armCruiseTimer(novelId);
    void get().tickCruise(novelId);
  },
  stopCruise(novelId, message = "") {
    set({ cruise: omitKey(get().cruise, novelId) });
    persistCruiseStates(get().cruise);
    const timer = cruiseTimers.get(novelId);
    if (timer !== undefined) {
      window.clearInterval(timer);
      cruiseTimers.delete(novelId);
    }
    cruiseFailures.delete(novelId);
    if (message) get().setAutoReview(novelId, false, message);
  },
  async resumeCruise(novelId) {
    const current = get().cruise[novelId];
    if (!current?.enabled) return;
    let resumeMessage = "已继续巡航";
    if (current.message.includes("Token 预算耗尽")) {
      try {
        const runs =
          get().workflowRuns[novelId] ??
          (await get().loadWorkflowRuns(novelId), get().workflowRuns[novelId] ?? []);
        const run = runs[0];
        const batches = await get().loadBatches();
        const batch =
          (run?.batchId
            ? batches.find((item) => item.id === run.batchId)
            : null) ??
          batches.find(
            (item) =>
              item.novelId === novelId &&
              item.outputTokensUsed >= item.policy.outputTokenBudget,
          );
        if (batch) {
          const outputTokenBudget =
            Math.max(batch.policy.outputTokenBudget, batch.outputTokensUsed) +
            CRUISE_BUDGET_TOP_UP;
          await get().setBatchStatus(batch.id, "paused", { outputTokenBudget });
          resumeMessage = `已追加 ${CRUISE_BUDGET_TOP_UP.toLocaleString()} 输出 token 并继续巡航`;
        }
      } catch (error) {
        noteCruise(
          novelId,
          `追加批次预算失败（${error instanceof Error ? error.message : "未知错误"}），巡航仍保持暂停。`,
        );
        return;
      }
    }
    set({
      cruise: {
        ...get().cruise,
        [novelId]: {
          ...current,
          status: "active",
          message: `${resumeMessage}：正在检查进度（可能含 1–5 分钟模型规划，实时动态见「生成任务」页）…`,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    persistCruiseStates(get().cruise);
    get().setAutoReview(novelId, true, "巡航模式：自动接受已联动开启。");
    cruiseFailures.delete(novelId);
    armCruiseTimer(novelId);
    void get().tickCruise(novelId);
  },
  async tickCruise(novelId) {
    const cruise = get().cruise[novelId];
    if (!cruise?.enabled || cruise.status !== "active" || cruiseTicking.has(novelId))
      return;
    // 巡航的正文段依赖自动审阅（候选稿 + 正史建议 + 续写下一章）。
    const autoReview = get().autoReview[novelId];
    if (!autoReview)
      get().setAutoReview(novelId, true, "巡航模式：自动接受已联动开启。");
    else if (!autoReview.enabled) {
      pauseCruise(
        novelId,
        `自动接受已停止（${autoReview.message || "原因未知"}），巡航已暂停，避免绕过质量门。`,
      );
      return;
    }
    cruiseTicking.add(novelId);
    // 底层模型请求自带超时；这里只报告慢任务。强制解锁会让旧轮与新轮
    // 并发，可能重复建批次、重复规划或重复封存。
    const watchdog = window.setTimeout(() => {
      if (cruiseTicking.has(novelId)) {
        noteCruise(
          novelId,
          "本轮检查耗时较长（可能含数分钟模型调用），仍在等待，未启动重复任务。",
        );
      }
    }, CRUISE_TICK_TIMEOUT_MS);
    try {
      const novel =
        get().novels.find((item) => item.id === novelId) ??
        (await platform.listNovels()).find((item) => item.id === novelId);
      if (!novel) throw new Error("作品不存在");
      const runs =
        get().workflowRuns[novelId] ??
        (await get().loadWorkflowRuns(novelId), get().workflowRuns[novelId] ?? []);
      const run = runs[0];
      if (!run) {
        // 没有运行记录：从已封存进度推起始周期并启动规划。
        const cycles =
          get().planningCycles[novelId] ??
          ((await get().loadPlanningCycles(novelId)),
          get().planningCycles[novelId] ?? []);
        const lastSealedEnd = cycles
          .filter((item) => item.status === "completed")
          .reduce((max, item) => Math.max(max, item.endChapter), 0);
        const totalCeiling = Math.min(
          cruise.targetChapter,
          novel.targetChapters,
        );
        const startChapter = lastSealedEnd + 1;
        if (startChapter > totalCeiling) {
          get().stopCruise(
            novelId,
            `巡航目标已达成（第 ${totalCeiling} 章），自动接受已收工。`,
          );
          return;
        }
        const endChapter = Math.min(
          startChapter + novel.cycleSize - 1,
          totalCeiling,
        );
        await get().startWorkflowRun(novelId, "autopilot", {
          startChapter,
          endChapter,
          chapterWords: novel.chapterWords,
          continuityCheck: true,
          maxRetries: 2,
          approvalMode: "chapter_review",
          outputTokenBudget: 120000,
          concurrency: 1,
          deepThinking: false,
          // AN-023：巡航无人值守，error 稿自动重写最多 2 轮；重写后仍有
          // error 时自动接受的质量门会拦下并暂停转人工。
          autoRewriteRounds: 2,
        }, startChapter > 1 ? "structure" : undefined);
        noteCruise(novelId, `开始规划第 ${startChapter}–${endChapter} 章…`);
        return;
      }
      if (run.status === "running") {
        // 事件驱动的状态收敛可能丢失（批次完成事件未送达/监听未绑定）：
        // 主动对账——批次已是终态就把运行状态收敛过去，否则巡航会永远
        // 停在“推进中”而不封存（线上形态：卡在“确认记忆回写”按钮）。
        const batch = (await get().loadBatches()).find(
          (item) => item.id === run.batchId,
        );
        if (
          batch &&
          ["completed", "failed", "cancelled"].includes(batch.status)
        ) {
          await get().syncWorkflowRunFromBatch(batch.id);
          return;
        }
        if (run.currentPhase === "generation" && batch) {
          // 正文阶段给章级进度，而不是一句静态的“正文候选生成”。
          const policy = run.config.generationPolicy;
          const all = ((await get().loadChapters(novelId)),
            get().chapters[novelId] ?? []);
          const range = all.filter(
            (item) =>
              item.position >= policy.startChapter &&
              item.position <= policy.endChapter,
          );
          const acceptedNow = range.filter(
            (item) => item.status === "accepted",
          ).length;
          noteCruise(
            novelId,
            `正文生成中：第 ${policy.startChapter}–${policy.endChapter} 章已入正史 ${acceptedNow}/${range.length}（批次 ${batch.outputTokensUsed.toLocaleString()} tokens；最新动作见「生成任务」页；总目标第 ${cruise.targetChapter} 章）`,
          );
        } else {
          noteCruise(
            novelId,
            `推进中：${WORKFLOW_PHASE_LABELS[run.currentPhase]}（目标第 ${cruise.targetChapter} 章）`,
          );
        }
        return;
      }
      // 代作者确认策划包：检查点模式的运行停在 plan_review（策划包待审核），
      // 不确认就直接建批次会被“范围未通过一致性检查”门禁拒绝（线上形态）。
      const confirmCycleForRun = async () => {
        const policy = run.config.generationPolicy;
        const cycles =
          get().planningCycles[novelId] ??
          ((await get().loadPlanningCycles(novelId)),
          get().planningCycles[novelId] ?? []);
        const review = cycles.find(
          (item) =>
            policy.startChapter >= item.startChapter &&
            policy.endChapter <= item.endChapter &&
            item.status === "plan_review",
        );
        if (review) {
          await get().savePlanningCycle({ ...review, status: "ready" });
          return true;
        }
        return false;
      };
      if (run.status === "failed") {
        if (run.error.includes("策划包")) {
          // 已知形态自愈：代确认待审策划包后续跑，不停巡航。
          const confirmed = await confirmCycleForRun();
          if (confirmed) {
            await get().resumeWorkflowRun(run.id);
            noteCruise(novelId, "已代为确认待审策划包，继续推进。");
            return;
          }
        }
        pauseCruise(
          novelId,
          `运行失败已暂停：${run.error || "未知错误"}。排查后点「继续巡航」从中断处续跑。`,
        );
        return;
      }
      if (run.status === "paused") {
        if (run.checkpoint === "proposal_review") {
          // 巡航核心授权：设定提案由作者委托自动接受（与正文建议同一语义）。
          // 撞上“新增设定已存在”（跨周期规划与正史记忆重复）时该提案的意图
          // 已满足：自动拒绝跳过继续，不让整条巡航停摆；其他错误照常计失败。
          const proposals =
            get().planningProposals[novelId] ??
            ((await get().loadPlanningProposals(novelId)),
            get().planningProposals[novelId] ?? []);
          const pending = proposals.filter((item) => item.status === "pending");
          let accepted = 0,
            satisfied = 0;
          for (const item of pending) {
            try {
              await get().reviewPlanningProposal(novelId, item.id, true);
              accepted++;
            } catch (error) {
              const message = error instanceof Error ? error.message : "";
              if (message.includes("已存在")) {
                await get().reviewPlanningProposal(novelId, item.id, false);
                satisfied++;
              } else throw error;
            }
          }
          await get().resumeWorkflowRun(run.id);
          noteCruise(
            novelId,
            `已自动处理 ${pending.length} 条设定提案（接受 ${accepted}${
              satisfied ? `、重复新增跳过 ${satisfied}` : ""
            }），继续规划。`,
          );
          return;
        }
        if (run.checkpoint === "phase_review") {
          // 非巡航创建的检查点运行：代点「继续运行」；结构阶段之后的暂停
          // 意味着策划包在 plan_review，先代确认再续，避免建批次被门禁拒绝。
          if (run.mode === "checkpoint") await confirmCycleForRun();
          await get().resumeWorkflowRun(run.id);
          return;
        }
        if (run.checkpoint === "chapter_review") {
          // 状态对账：批次已终态（事件丢失残留的 chapter_review）→ 直接按
          // 批次终态收敛运行。syncWorkflowRunFromBatch 只处理 running 运行，
          // 对 paused 会空返回，造成每轮静默空转（线上形态：文案永远停在
          // “正在检查”，看门狗也抓不到的秒回死洞）。
          const batch = (await get().loadBatches()).find(
            (item) => item.id === run.batchId,
          );
          if (
            batch &&
            ["completed", "failed", "cancelled"].includes(batch.status)
          ) {
            const update = workflowRunUpdateFromBatch(batch);
            if (update) {
              await platform.updateWorkflowRun({ id: run.id, ...update });
              await get().loadWorkflowRuns(novelId);
            }
            return;
          }
          // 进度可见：本周期已入正史 X/Y，而不是一句静态的“正在处理”。
          const policy = run.config.generationPolicy;
          const all = ((await get().loadChapters(novelId)),
            get().chapters[novelId] ?? []);
          const range = all.filter(
            (item) =>
              item.position >= policy.startChapter &&
              item.position <= policy.endChapter,
          );
          const acceptedNow = range.filter(
            (item) => item.status === "accepted",
          ).length;
          noteCruise(
            novelId,
            `正文审阅中：第 ${policy.startChapter}–${policy.endChapter} 章已入正史 ${acceptedNow}/${range.length}，自动接受正在处理候选稿与正史建议。`,
          );
          return;
        }
        // 无检查点的暂停：批次被暂停（预算耗尽或手动）。
        const batch = (await get().loadBatches()).find(
          (item) => item.id === run.batchId,
        );
        if (!batch) {
          pauseCruise(novelId, "运行对应的批次不存在，请人工检查。");
          return;
        }
        if (batch.outputTokensUsed >= batch.policy.outputTokenBudget) {
          pauseCruise(
            novelId,
            `批次 Token 预算耗尽（${batch.outputTokensUsed.toLocaleString()} / ${batch.policy.outputTokenBudget.toLocaleString()}）。续费或调高预算后点「继续巡航」。`,
          );
          return;
        }
        await get().dispatchBatch(batch.id);
        return;
      }
      // run.status === "completed"：本周期批次已写完，收尾入正史 → 封存 → 下一周期。
      const policy = run.config.generationPolicy;
      const allChapters = ((await get().loadChapters(novelId)),
        get().chapters[novelId] ?? []);
      const rangeChapters = allChapters.filter(
        (item) =>
          item.position >= policy.startChapter && item.position <= policy.endChapter,
      );
      if (!rangeChapters.length) {
        pauseCruise(novelId, "周期范围内没有章节，请人工检查章节目录。");
        return;
      }
      const acceptedCount = rangeChapters.filter(
        (item) => item.status === "accepted",
      ).length;
      if (acceptedCount < rangeChapters.length) {
        const auto = get().autoReview[novelId];
        if (!auto?.enabled) {
          // 自动接受被全局门拦下时先试自愈：悬空状态属孤儿垃圾，清掉即可
          // 恢复（线上形态：一条悬空状态让自动接受自停、巡航跟着停摆）。
          if ((auto?.message ?? "").includes("全局一致性校验")) {
            const removed = await get().cleanupDanglingStates(novelId);
            const remaining = await get().collectGlobalErrors(novelId);
            if (!remaining.length) {
              get().setAutoReview(
                novelId,
                true,
                `巡航自愈：已清理 ${removed} 条悬空正史状态，自动接受恢复。`,
              );
              return;
            }
          }
          pauseCruise(
            novelId,
            `自动接受已停止（${auto?.message ?? "原因未知"}），第 ${policy.startChapter}–${policy.endChapter} 章还有 ${rangeChapters.length - acceptedCount} 章未入正史。处理后续跑。`,
          );
          return;
        }
        noteCruise(
          novelId,
          `正文入正史中：${acceptedCount}/${rangeChapters.length} 章（第 ${policy.startChapter}–${policy.endChapter} 章）。`,
        );
        return;
      }
      // AN-035 周期封存例行动作：自动记忆清理（每 10 章一次）——只清确定性
      // 垃圾：悬空状态、同章重复状态、同名同埋设章的重复伏笔、重复时间线；
      // 语义层面的伪伏笔废弃仍归作者（故事总览手动批量处理）。
      try {
        const cleaned = await get().autoCleanupMemory(novelId);
        const total = cleaned.states + cleaned.foreshadow + cleaned.timeline;
        if (total > 0)
          noteCruise(
            novelId,
            `记忆体检：清理 ${total} 条冗余记录（状态 ${cleaned.states}、伏笔 ${cleaned.foreshadow}、时间线 ${cleaned.timeline}）。`,
          );
      } catch {
        // 清理失败不阻断封存（门禁仍会拦截 error 级数据问题）。
      }
      // AN-027 封存门禁：全局校验 error 阻断。悬空状态引用属于孤儿垃圾数据
      // （指向不存在的实体，无人能读到），巡航自动清理后复查（线上形态：
      // 一条悬空状态卡住整条巡航的封存与自动接受）。
      let globalErrors = await get().collectGlobalErrors(novelId);
      if (globalErrors.length) {
        const allDangling = globalErrors.every((message) =>
          message.includes("不存在的人物实体"),
        );
        if (allDangling) {
          const removed = await get().cleanupDanglingStates(novelId);
          if (removed > 0)
            noteCruise(novelId, `已自动清理 ${removed} 条悬空正史状态（孤儿记录）。`);
          globalErrors = await get().collectGlobalErrors(novelId);
        }
      }
      if (globalErrors.length) {
        pauseCruise(
          novelId,
          `全局一致性校验发现 ${globalErrors.length} 项 error（${globalErrors[0]}）。到「连续性 → 故事总览/全局审查」处理后续跑。`,
        );
        return;
      }
      const cycles =
        get().planningCycles[novelId] ??
        ((await get().loadPlanningCycles(novelId)),
        get().planningCycles[novelId] ?? []);
      const cycle = cycles.find(
        (item) =>
          policy.startChapter >= item.startChapter &&
          policy.endChapter <= item.endChapter &&
          ["ready", "generating", "memory_review", "completed"].includes(
            item.status,
          ),
      );
      if (!cycle) {
        pauseCruise(novelId, "未找到本周期策划包，请人工检查。");
        return;
      }
      if (cycle.status === "completed") {
        // 周期已被封存（作者手动确认或上一轮巡航完成）：跳过封存直接
        // 进入下一周期，不再视为异常（线上形态：手动点过“确认记忆回写”）。
      } else {
        // 封存：实际结束状态从最新正史记忆确定性起草（作者可事后改写）。
        await get().loadContinuity(novelId);
        if (!get().entities[novelId]) await get().loadEntities(novelId);
        const draft = draftClosingState({
          cycle,
          chapters: rangeChapters,
          entities: get().entities[novelId] ?? [],
          timeline: get().timelineEvents[novelId] ?? [],
          characterStates: get().characterStates[novelId] ?? [],
          foreshadow: get().foreshadowThreads[novelId] ?? [],
        });
        await get().savePlanningCycle({
          ...cycle,
          status: "completed",
          actualClosingState: draft,
        });
        await get().invalidatePlanning(novelId, 7);
      }
      const totalCeiling = Math.min(cruise.targetChapter, novel.targetChapters);
      const next = nextCycleRange({
        sealedEndChapter: policy.endChapter,
        targetChapter: cruise.targetChapter,
        cycleSize: novel.cycleSize,
        totalChapters: novel.targetChapters,
      });
      if (!next || next.startChapter > totalCeiling) {
        get().stopCruise(
          novelId,
          `巡航完成：已写到第 ${Math.min(policy.endChapter, totalCeiling)} 章（目标 ${cruise.targetChapter} 章），本批已封存。`,
        );
        return;
      }
      // 下一周期若已有策划包（作者手动规划或上一轮遗留），复用而不重跑：
      // 代确认后处理其待审提案（重复新增跳过），直接进入正文阶段。
      const prepared = cycles.find(
        (item) =>
          next.startChapter >= item.startChapter &&
          next.endChapter <= item.endChapter &&
          ["plan_review", "ready"].includes(item.status),
      );
      if (prepared?.status === "plan_review")
        await get().savePlanningCycle({ ...prepared, status: "ready" });
      if (prepared) {
        const pendingNext = (
          get().planningProposals[novelId] ??
          ((await get().loadPlanningProposals(novelId)),
          get().planningProposals[novelId] ?? [])
        ).filter((item) => item.status === "pending");
        for (const item of pendingNext) {
          try {
            await get().reviewPlanningProposal(novelId, item.id, true);
          } catch (error) {
            if ((error instanceof Error ? error.message : "").includes("已存在"))
              await get().reviewPlanningProposal(novelId, item.id, false);
            else throw error;
          }
        }
      }
      // 第 2 周期起地基（第 1–6 步）已存在：直接从结构规划开始，
      // 省去每周期三次圣经/人物/场景的重复模型调用。
      await get().startWorkflowRun(
        novelId,
        "autopilot",
        { ...cruisePolicy(policy, next) },
        prepared
          ? "generation"
          : next.startChapter > 1
            ? "structure"
            : undefined,
      );
      get().setAutoReview(novelId, true, "巡航模式：新周期自动接受已启动。");
      noteCruise(
        novelId,
        `第 ${policy.startChapter}–${policy.endChapter} 章已封存，开始规划第 ${next.startChapter}–${next.endChapter} 章。`,
      );
      cruiseFailures.delete(novelId);
    } catch (error) {
      const failures = (cruiseFailures.get(novelId) ?? 0) + 1;
      cruiseFailures.set(novelId, failures);
      if (failures >= 3) {
        pauseCruise(
          novelId,
          `巡航连续 ${failures} 次失败（${
            error instanceof Error ? error.message : "未知错误"
          }）。排查后点「继续巡航」从中断处续跑。`,
        );
      }
    } finally {
      window.clearTimeout(watchdog);
      cruiseTicking.delete(novelId);
    }
  },
  };
}

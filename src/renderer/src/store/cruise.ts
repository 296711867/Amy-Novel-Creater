import { platform } from "@renderer/platform/web-platform";
import { useNovelStore } from "./novel-store";
import type { NovelStateGet, NovelStateSet } from "./utils";
import { WORKFLOW_PHASE_LABELS } from "@domain/workflow-run";
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
      message: "巡航已开启：正在检查当前进度…",
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
  resumeCruise(novelId) {
    const current = get().cruise[novelId];
    if (!current?.enabled) return;
    set({
      cruise: {
        ...get().cruise,
        [novelId]: {
          ...current,
          status: "active",
          message: "已继续巡航：正在检查进度…",
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
    if (!get().autoReview[novelId]?.enabled)
      get().setAutoReview(novelId, true, "巡航模式：自动接受已联动开启。");
    cruiseTicking.add(novelId);
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
          approvalMode: "candidate",
          outputTokenBudget: 120000,
          concurrency: 1,
          deepThinking: false,
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
        noteCruise(
          novelId,
          `推进中：${WORKFLOW_PHASE_LABELS[run.currentPhase]}（目标第 ${cruise.targetChapter} 章）`,
        );
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
          // 状态对账：批次已终态（事件丢失残留的 chapter_review）→ 收敛运行。
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
          // 进度可见：本周期已入正史 X/Y，而不是一句静态的“正在处理”。
          const policy = run.config.generationPolicy;
          const all =
            get().chapters[novelId] ??
            ((await get().loadChapters(novelId)),
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
      const allChapters =
        get().chapters[novelId] ??
        ((await get().loadChapters(novelId)), get().chapters[novelId] ?? []);
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
      // AN-027 封存门禁：全局校验 error 阻断（含悬空引用等数据完整性问题）。
      const globalErrors = await get().collectGlobalErrors(novelId);
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
          ["ready", "generating", "memory_review"].includes(item.status),
      );
      if (!cycle) {
        pauseCruise(novelId, "未找到本周期策划包，请人工检查。");
        return;
      }
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
      cruiseTicking.delete(novelId);
    }
  },
  };
}

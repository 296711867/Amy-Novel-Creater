import { platform } from "@renderer/platform/web-platform";
import { useNovelStore } from "./novel-store";
import type { NovelStateGet, NovelStateSet } from "./utils";

const autoReviewTimers = new Map<string, number>();
const autoReviewTicking = new Set<string>();
const autoReviewFailures = new Map<string, number>();

const AUTO_REVIEW_INTERVAL_MS = 2000;
const AUTO_REVIEW_MAX_FAILURES = 3;
/** 单轮自动审阅看门狗时限：全部为快速 DB 操作，60 秒足矣。 */
const AUTO_REVIEW_TICK_TIMEOUT_MS = 60_000;
const autoReviewTickGen = new Map<string, number>();
/** 任务状态超过该时长无更新视为运行器丢失（应用重启等），自动重新接管。 */
const AUTO_REVIEW_STALE_MS = 5 * 60_000;
const AUTO_REVIEW_STORAGE_KEY = "amy-novel:auto-review";

/** 读取持久化的自动审阅作品列表（刷新/重启后断点续跑，AN-028）。 */
export function readPersistedAutoReview(): string[] {
  try {
    const raw = window.localStorage.getItem(AUTO_REVIEW_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function persistAutoReviewIds(ids: string[]) {
  try {
    window.localStorage.setItem(AUTO_REVIEW_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // 持久化失败不阻断开关本身（隐身模式/配额满）。
  }
}

/** 仅更新横幅文案（不重建定时器）；内容不变时跳过，避免 2 秒一次的重渲染。 */
function noteAutoReview(novelId: string, message: string) {
  const state = useNovelStore.getState();
  const current = state.autoReview[novelId];
  if (!current?.enabled || current.message === message) return;
  useNovelStore.setState({
    autoReview: {
      ...state.autoReview,
      [novelId]: { ...current, message },
    },
  });
}


export function createAutoReviewActions(set: NovelStateSet, get: NovelStateGet) {
  return {
  setAutoReview(novelId, enabled, message = "") {
    set({
      autoReview: {
        ...get().autoReview,
        [novelId]: { enabled, message },
      },
    });
    // AN-028：开关持久化到 localStorage——刷新/重启不再静默丢掉全自动模式；
    // 关闭（含各类自动停用）时同步清除，重启后不会复活已停用的模式。
    const persisted = new Set(readPersistedAutoReview());
    if (enabled) persisted.add(novelId);
    else persisted.delete(novelId);
    persistAutoReviewIds([...persisted]);
    autoReviewFailures.delete(novelId);
    const timer = autoReviewTimers.get(novelId);
    if (timer !== undefined) {
      window.clearInterval(timer);
      autoReviewTimers.delete(novelId);
    }
    if (!enabled) return;
    void get().tickAutoReview(novelId);
    autoReviewTimers.set(
      novelId,
      window.setInterval(
        () => void get().tickAutoReview(novelId),
        AUTO_REVIEW_INTERVAL_MS,
      ),
    );
  },
  async tickAutoReview(novelId) {
    if (!get().autoReview[novelId]?.enabled || autoReviewTicking.has(novelId))
      return;
    autoReviewTicking.add(novelId);
    // 看门狗（与巡航同款）：自动审阅全部是快速 DB 操作，任一步挂起超过
    // 60 秒即强制解锁并明示，防止防重入锁被永久占死后“已开启却不动”
    // （线上形态：候选稿就绪 9/10，自动审阅静默停摆）。
    const generation = (autoReviewTickGen.get(novelId) ?? 0) + 1;
    autoReviewTickGen.set(novelId, generation);
    const watchdog = window.setTimeout(() => {
      if (
        autoReviewTicking.has(novelId) &&
        autoReviewTickGen.get(novelId) === generation
      ) {
        autoReviewTicking.delete(novelId);
        noteAutoReview(novelId, "上一轮自动审阅超时，已解锁，下一轮自动重试。");
      }
    }, AUTO_REVIEW_TICK_TIMEOUT_MS);
    try {
      const batches = await get().loadBatches();
      const active =
        batches.find(
          (item) => item.novelId === novelId && item.awaitingReview,
        ) ??
        batches.find(
          (item) =>
            item.novelId === novelId &&
            item.status !== "completed" &&
            item.status !== "cancelled",
        );
      if (!active) {
        // 没有进行中的批次：本批已完成则自动收工，否则保持待命等新批次。
        if (
          batches.some(
            (item) =>
              item.novelId === novelId &&
              item.status === "completed" &&
              item.outputTokensUsed > 0,
          )
        )
          get().setAutoReview(
            novelId,
            false,
            "本批次已全部完成，自动接受已自动关闭。",
          );
        return;
      }
      const jobs = await get().loadJobs(active.id);
      const ready = [...jobs]
        .filter((item) => item.status === "candidate_ready")
        .sort((a, b) => a.position - b.position)[0];
      const emit = async (chapterId: string | null, message: string) => {
        const event = await platform.appendGenerationEvent?.({
          batchId: active.id,
          novelId,
          chapterId,
          stage: "auto_review",
          level: "info",
          message,
          data: { auto: true },
        });
        if (event) get().appendActivity(event);
      };
      const candidate =
        ready?.candidateId === null || ready?.candidateId === undefined
          ? null
          : Object.values(get().candidates)
                .flat()
                .find((item) => item.id === ready.candidateId) ??
            (
              await platform.listChapterCandidates(ready.chapterId)
            ).find((item) => item.id === ready.candidateId);
      if (candidate?.status === "candidate") {
        // 质量安全门（AUTOPILOT_WORKFLOW.md §6）：存在未解决的 error 级检查
        // 问题时不得自动接受，交还作者人工处理。
        if (!get().findings[candidate.id])
          await get().loadQuality(candidate.id);
        const blocking = (get().findings[candidate.id] ?? []).filter(
          (item) => item.severity === "error" && item.status === "open",
        );
        // AN-027 全局门：确定性校验发现 error（引用悬空等数据完整性问题）同样阻断。
        const globalBlocking = await get()
          .collectGlobalErrors(novelId)
          .catch(() => [] as string[]);
        if (blocking.length || globalBlocking.length) {
          get().setAutoReview(
            novelId,
            false,
            blocking.length
              ? `本章有 ${blocking.length} 项未解决的 error 级检查问题，自动接受已暂停；请人工处理后再重新开启。`
              : `全局一致性校验发现 ${globalBlocking.length} 项 error（${globalBlocking[0]}），自动接受已暂停。`,
          );
          return;
        }
        // 第一步：接受候选稿（与作者点击“接受并写入正文”同一门禁）。
        await get().reviewCandidate(candidate.id, true);
        await emit(
          candidate.chapterId,
          "自动审阅：已接受本章候选稿并写入正史。",
        );
        await get().loadQuality(candidate.id);
        noteAutoReview(novelId, "");
        autoReviewFailures.delete(novelId);
        return;
      }
      if (candidate?.status === "accepted") {
        if (!get().factProposals[candidate.id])
          await get().loadQuality(candidate.id);
        const pending = (get().factProposals[candidate.id] ?? []).filter(
          (item) => item.status === "proposed",
        );
        if (pending.length) {
          // 第二步：逐条接受正史建议（timeline / 角色状态 / 伏笔，
          // source=ai_candidate）。AN-028：单条失败不再打断整批——新角色
          // 提案自动建档，其余建议照常处理；只有全部失败才计入
          // 自动模式的连续失败次数。
          let accepted = 0;
          const failures: string[] = [];
          for (const proposal of pending) {
            try {
              await get().reviewFactProposal(candidate.id, proposal.id, true, {
                autoCreateCharacter: true,
              });
              accepted++;
            } catch (error) {
              failures.push(
                `「${proposal.title}」${
                  error instanceof Error ? error.message : "处理失败"
                }`,
              );
            }
          }
          await emit(
            candidate.chapterId,
            failures.length
              ? `自动审阅：已接受 ${accepted} 条正史建议，${failures.length} 条待人工处理（${failures[0]}）。`
              : `自动审阅：已接受 ${accepted} 条正史建议。`,
          );
          if (accepted > 0) {
            noteAutoReview(novelId, "");
            autoReviewFailures.delete(novelId);
            return;
          }
          throw new Error(failures[0] ?? "正史建议处理失败");
        }
      }
      if (candidate?.status === "rejected") {
        // 候选稿被拒绝过（含人工拒绝）：自动模式让位给人工处理。
        get().setAutoReview(
          novelId,
          false,
          "本章候选稿此前被拒绝，等待人工“重试本章”后再重新开启自动接受。",
        );
        return;
      }
      // 第三步：没有待处理的候选与建议时，若批次在等待审核则恢复写下一章
      // （相当于点击“继续生成下一章”；全部写完由运行器收敛为 completed）。
      if (active.awaitingReview) {
        await get().dispatchBatch(active.id);
        await emit(null, "自动审阅：继续生成下一章。");
        noteAutoReview(novelId, "");
        return;
      }
      // AN-028：批次存在但既无待审内容也不在等待审核——把状态写进横幅，
      // 消灭“开关亮着却毫无动静”的静默假死。
      if (active.status === "paused")
        noteAutoReview(
          novelId,
          "批次已暂停（手动暂停或预算耗尽）。到生成工作台恢复批次后，自动接受会立即继续。",
        );
      else if (active.status === "queued")
        noteAutoReview(
          novelId,
          "该批次仍在排队、尚未开始生成。若存在多个批次，请到生成工作台选择要运行的批次，并停止多余的批次。",
        );
      else if (active.status === "running") {
        // 应用重启会让批次状态停在 running 但运行器已丢失（任务卡在
        // generating 或无人推进）。BatchRunner.start 有单例守卫，误判时
        // 重复接管是安全的空操作。
        const generating = jobs.filter((item) => item.status === "generating"),
          runnerLost =
            generating.length === 0 ||
            generating.every(
              (item) =>
                Date.now() - new Date(item.updatedAt).getTime() >
                AUTO_REVIEW_STALE_MS,
            );
        if (runnerLost) {
          await get().dispatchBatch(active.id);
          await emit(
            null,
            "自动审阅：检测到批次中断（应用重启或运行器丢失），已重新接管继续。",
          );
        } else
          noteAutoReview(novelId, "正在生成章节正文，完成后自动审阅。");
      }
      return;
    } catch (error) {
      const failures = (autoReviewFailures.get(novelId) ?? 0) + 1;
      autoReviewFailures.set(novelId, failures);
      if (failures >= AUTO_REVIEW_MAX_FAILURES) {
        const message =
          error instanceof Error ? error.message : "自动审阅连续失败";
        get().setAutoReview(
          novelId,
          false,
          `自动接受已停止：连续 ${failures} 次失败（${message}）。请人工处理后重新开启。`,
        );
      }
    } finally {
      window.clearTimeout(watchdog);
      if (autoReviewTickGen.get(novelId) === generation)
        autoReviewTicking.delete(novelId);
    }
  },
  };
}

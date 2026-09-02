import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  GitCommitHorizontal,
  LayoutDashboard,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRoundCog,
  X,
} from "lucide-react";
import { Navigate, NavLink, useParams } from "react-router-dom";
import {
  FORESHADOW_STATUS_LABELS,
  canMoveForeshadow,
  type ForeshadowStatus,
  type SaveCharacterStateInput,
  type SaveForeshadowInput,
  type SaveTimelineEventInput,
} from "@domain/continuity";
import { GLOBAL_REVIEW_CYCLE_ID } from "@domain/global-consistency";
import { buildStoryOverview, type MemoryIssue } from "@domain/story-overview";
import { useNovelStore } from "@renderer/store/novel-store";

const EMPTY: never[] = [];
type View = "overview" | "timeline" | "foreshadow" | "states" | "audit";

export function ContinuityPage(): React.JSX.Element {
  const { novelId = "" } = useParams(),
    novel = useNovelStore((s) => s.novels.find((item) => item.id === novelId)),
    chapters = useNovelStore((s) => s.chapters[novelId] ?? EMPTY),
    entities = useNovelStore((s) => s.entities[novelId] ?? EMPTY),
    timeline = useNovelStore((s) => s.timelineEvents[novelId] ?? EMPTY),
    threads = useNovelStore((s) => s.foreshadowThreads[novelId] ?? EMPTY),
    states = useNovelStore((s) => s.characterStates[novelId] ?? EMPTY);
  const findings = useNovelStore((s) => s.globalFindings[novelId] ?? EMPTY),
    planningProposals = useNovelStore(
      (s) => s.planningProposals[novelId] ?? EMPTY,
    ),
    batches = useNovelStore((s) => s.batches),
    jobsMap = useNovelStore((s) => s.jobs);
  const runGlobalConsistencyCheck = useNovelStore(
      (s) => s.runGlobalConsistencyCheck,
    ),
    runGlobalReview = useNovelStore((s) => s.runGlobalReview),
    runWholeBookReview = useNovelStore((s) => s.runWholeBookReview),
    dismissGlobalFinding = useNovelStore((s) => s.dismissGlobalFinding),
    reviewPlanningProposalAction = useNovelStore(
      (s) => s.reviewPlanningProposal,
    ),
    regenerateGenerationJob = useNovelStore((s) => s.regenerateGenerationJob),
    loadPlanningProposals = useNovelStore((s) => s.loadPlanningProposals);
  const loadChapters = useNovelStore((s) => s.loadChapters),
    loadEntities = useNovelStore((s) => s.loadEntities),
    loadContinuity = useNovelStore((s) => s.loadContinuity),
    saveTimeline = useNovelStore((s) => s.saveTimeline),
    deleteTimeline = useNovelStore((s) => s.deleteTimeline),
    saveForeshadow = useNovelStore((s) => s.saveForeshadow),
    deleteForeshadow = useNovelStore((s) => s.deleteForeshadow),
    saveState = useNovelStore((s) => s.saveCharacterState),
    deleteState = useNovelStore((s) => s.deleteCharacterState);  const [view, setView] = useState<View>("overview"),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const emptyTimeline = (): SaveTimelineEventInput => ({
      novelId,
      chapterId: null,
      storyTime: "",
      title: "",
      detail: "",
      participantIds: [],
    }),
    emptyThread = (): SaveForeshadowInput => ({
      novelId,
      title: "",
      detail: "",
      setupChapterId: null,
      payoffChapterId: null,
      status: "planned",
    }),
    emptyState = (): SaveCharacterStateInput => ({
      novelId,
      characterId: "",
      chapterId: null,
      summary: "",
      location: "",
      appearance: "",
      outfit: "",
      identity: "",
      physical: "",
      emotional: "",
      knowledge: [],
      goals: [],
      inventory: [],
      skills: [],
    });
  const [timelineForm, setTimelineForm] =
    useState<SaveTimelineEventInput>(emptyTimeline()),
    [threadForm, setThreadForm] = useState<SaveForeshadowInput>(emptyThread()),
    [stateForm, setStateForm] = useState<SaveCharacterStateInput>(emptyState());
  const [auditBusy, setAuditBusy] = useState(false),
    [auditError, setAuditError] = useState(""),
    [checkBusy, setCheckBusy] = useState(false),
    [proposalBusyId, setProposalBusyId] = useState(""),
    [rewriteBusyId, setRewriteBusyId] = useState(""),
    [bookBusy, setBookBusy] = useState(false);
  useEffect(() => {
    void loadChapters(novelId);
    void loadEntities(novelId);
    void loadContinuity(novelId);
  }, [loadChapters, loadEntities, loadContinuity, novelId]);
  // 全局审查视图：装载已有发现并自动跑一次确定性校验（零 token）。
  useEffect(() => {
    if (view !== "audit") return;
    void useNovelStore.getState().loadGlobalFindings(novelId);
    void loadPlanningProposals(novelId);
    void useNovelStore.getState().loadBatches();
    setCheckBusy(true);
    void useNovelStore
      .getState()
      .runGlobalConsistencyCheck(novelId)
      .catch(() => undefined)
      .finally(() => setCheckBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, novelId]);
  const characters = useMemo(
    () => entities.filter((item) => item.type === "character"),
    [entities],
  );
  // AN-030 故事总览：纯本地聚合，零 token；AN-033 记忆体检结果一并产出。
  const overview = useMemo(
    () =>
      buildStoryOverview({
        chapters,
        entities,
        timeline,
        foreshadow: threads,
        characterStates: states,
      }),
    [chapters, entities, timeline, threads, states],
  );
  const [cleanupBusy, setCleanupBusy] = useState(false),
    [selectedThreadIds, setSelectedThreadIds] = useState<string[]>([]);
  if (!novel) return <Navigate to="/novels" replace />;
  function chapterName(id: string | null) {
    return chapters.find((item) => item.id === id)?.title ?? "未关联章节";
  }
  function reset(next: View = view) {
    setSelectedId(null);
    if (next === "timeline") setTimelineForm(emptyTimeline());
    if (next === "foreshadow") setThreadForm(emptyThread());
    if (next === "states") setStateForm(emptyState());
  }
  function changeView(next: View) {
    setView(next);
    reset(next);
  }
  async function remove(kind: View) {
    if (
      !selectedId ||
      !window.confirm("确定删除这条正史记录吗？此操作不可撤销。")
    )
      return;
    if (kind === "timeline") await deleteTimeline(novelId, selectedId);
    if (kind === "foreshadow") await deleteForeshadow(novelId, selectedId);
    if (kind === "states") await deleteState(novelId, selectedId);
    reset(kind);
  }
  const openFindings = findings.filter((item) => item.status === "open"),
    repairProposals = planningProposals.filter(
      (item) =>
        item.cycleId === GLOBAL_REVIEW_CYCLE_ID && item.status === "pending",
    );
  function rewriteJobFor(position: number | undefined) {
    if (!position) return null;
    const chapter = chapters.find((item) => item.position === position);
    if (!chapter) return null;
    for (const batch of batches) {
      if (batch.status === "completed" || batch.status === "cancelled") continue;
      const job = (jobsMap[batch.id] ?? []).find(
        (item) => item.chapterId === chapter.id,
      );
      if (job) return { batch, job };
    }
    return null;
  }
  async function runAiReview() {
    setAuditBusy(true);
    setAuditError("");
    try {
      await runGlobalReview(novelId);
    } catch (value) {
      setAuditError(value instanceof Error ? value.message : "AI 审查失败");
    } finally {
      setAuditBusy(false);
    }
  }
  // AN-032：全书分窗口通读，进度逐窗口写活动日志（global_review 阶段）。
  async function runBookReview() {
    const acceptedCount = chapters.filter(
      (item) => item.status === "accepted",
    ).length;
    if (!acceptedCount) {
      setAuditError("还没有已入正史的章节可审读。");
      return;
    }
    if (
      !window.confirm(
        `全书通读将按 5 章一个窗口调用模型（共约 ${Math.ceil(acceptedCount / 5)} 次），产生相应 Token 费用，需要几分钟。现在开始吗？`,
      )
    )
      return;
    setBookBusy(true);
    setAuditError("");
    try {
      await runWholeBookReview(novelId);
    } catch (value) {
      setAuditError(value instanceof Error ? value.message : "通读审稿失败");
    } finally {
      setBookBusy(false);
    }
  }
  // AN-033 记忆清理：全部是作者确认后的正史写操作，逐条留痕、可回查。
  async function mergeDuplicateState(issue: MemoryIssue) {
    if (!issue.fix || !window.confirm("确定删除重复状态记录（保留最早一条）吗？"))
      return;
    setCleanupBusy(true);
    try {
      for (const id of issue.fix.dropIds) await deleteState(novelId, id);
    } finally {
      setCleanupBusy(false);
    }
  }
  async function batchArchiveThreads() {
    if (!selectedThreadIds.length) return;
    if (
      !window.confirm(
        `确定将选中的 ${selectedThreadIds.length} 条伏笔标记为废弃吗？废弃后不再跟踪与提醒，记录保留可查。`,
      )
    )
      return;
    setCleanupBusy(true);
    try {
      for (const id of selectedThreadIds) {
        const thread = threads.find((item) => item.id === id);
        if (thread) await saveForeshadow({ ...thread, status: "abandoned" });
      }
      setSelectedThreadIds([]);
    } finally {
      setCleanupBusy(false);
    }
  }
  async function batchDeleteThreads() {
    if (!selectedThreadIds.length) return;
    if (
      !window.confirm(
        `确定删除选中的 ${selectedThreadIds.length} 条伏笔吗？此操作不可撤销。`,
      )
    )
      return;
    setCleanupBusy(true);
    try {
      for (const id of selectedThreadIds) await deleteForeshadow(novelId, id);
      setSelectedThreadIds([]);
    } finally {
      setCleanupBusy(false);
    }
  }
  async function reviewRepairProposal(id: string, accept: boolean) {
    setProposalBusyId(id);
    setAuditError("");
    try {
      await reviewPlanningProposalAction(novelId, id, accept);
    } catch (value) {
      setAuditError(value instanceof Error ? value.message : "提案处理失败");
    } finally {
      setProposalBusyId("");
    }
  }
  async function rewriteFromFinding(
    finding: (typeof findings)[number],
  ) {
    const target = rewriteJobFor(finding.chapterPosition);
    if (!target) return;
    const notes = [
      finding.message,
      finding.evidence ? `证据：${finding.evidence}` : "",
      finding.suggestion ? `修复方向：${finding.suggestion}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    setRewriteBusyId(finding.id);
    setAuditError("");
    try {
      await regenerateGenerationJob(target.batch.id, target.job.id, notes);
    } catch (value) {
      setAuditError(value instanceof Error ? value.message : "重写任务创建失败");
    } finally {
      setRewriteBusyId("");
    }
  }
  return (
    <main className="continuity-shell">
      <header className="continuity-top">
        <NavLink to={`/novels/${novelId}/plan`}>
          <ChevronLeft size={17} />
          返回规划
        </NavLink>
        <div>
          <b>{novel.title}</b>
          <span>动态正史台账</span>
        </div>
        <NavLink to={`/novels/${novelId}/book`}>
          <BookOpen size={16} />
          整书连读
        </NavLink>
      </header>
      <nav className="continuity-tabs">
        <button
          className={view === "overview" ? "active" : ""}
          onClick={() => changeView("overview")}
        >
          <LayoutDashboard />
          故事总览 <span>{overview.issues.length}</span>
        </button>
        <button
          className={view === "timeline" ? "active" : ""}
          onClick={() => changeView("timeline")}
        >
          <CalendarDays />
          时间线 <span>{timeline.length}</span>
        </button>
        <button
          className={view === "foreshadow" ? "active" : ""}
          onClick={() => changeView("foreshadow")}
        >
          <GitCommitHorizontal />
          伏笔 <span>{threads.length}</span>
        </button>
        <button
          className={view === "states" ? "active" : ""}
          onClick={() => changeView("states")}
        >
          <UserRoundCog />
          角色状态 <span>{states.length}</span>
        </button>
        <button
          className={view === "audit" ? "active" : ""}
          onClick={() => changeView("audit")}
        >
          <ShieldCheck />
          全局审查 <span>{openFindings.length}</span>
        </button>
      </nav>
      <div className="continuity-layout">
        <aside className="ledger-list">
          {view === "overview" &&
            (overview.issues.length ? (
              <>
                <i
                  style={{
                    display: "block",
                    marginBottom: 8,
                    color: "var(--sub)",
                    fontSize: 12,
                  }}
                >
                  记忆体检（{overview.issues.length} 项）
                </i>
                {overview.issues.slice(0, 30).map((issue) => (
                  <button
                    key={issue.kind + issue.targetIds.join(",")}
                    onClick={() => {
                      if (issue.kind === "duplicate-state") return;
                      if (issue.kind === "overdue-foreshadow") changeView("foreshadow");
                      else changeView("states");
                    }}
                    title={issue.message}
                  >
                    <i data-status={issue.severity === "error" ? "error" : "warn"}>
                      {issue.kind === "duplicate-state"
                        ? "重复状态"
                        : issue.kind === "multi-state-chapter"
                          ? "同章多状态"
                          : issue.kind === "overdue-foreshadow"
                            ? "伏笔超期"
                            : issue.kind === "stale-memory"
                              ? "记忆过期"
                              : "悬空引用"}
                    </i>
                    <b>{issue.message.slice(0, 26)}…</b>
                  </button>
                ))}
              </>
            ) : (
              <p>记忆体检未发现问题。伏笔、状态与章节统计见右侧总览。</p>
            ))}
          {view === "timeline" &&
            (timeline.length ? (
              timeline.map((item) => (
                <button
                  key={item.id}
                  className={selectedId === item.id ? "selected" : ""}
                  onClick={() => {
                    setSelectedId(item.id);
                    setTimelineForm({ ...item });
                  }}
                >
                  <i>{item.storyTime || "未定"}</i>
                  <b>{item.title}</b>
                  <small>{chapterName(item.chapterId)}</small>
                </button>
              ))
            ) : (
              <p>还没有时间线事件。</p>
            ))}
          {view === "foreshadow" &&
            (threads.length ? (
              threads.map((item) => (
                <button
                  key={item.id}
                  className={selectedId === item.id ? "selected" : ""}
                  onClick={() => {
                    setSelectedId(item.id);
                    setThreadForm({ ...item });
                  }}
                >
                  <i data-status={item.status}>
                    {FORESHADOW_STATUS_LABELS[item.status]}
                  </i>
                  <b>{item.title}</b>
                  <small>
                    {chapterName(item.setupChapterId)} →{" "}
                    {chapterName(item.payoffChapterId)}
                  </small>
                </button>
              ))
            ) : (
              <p>还没有伏笔记录。</p>
            ))}
          {view === "states" &&
            (states.length ? (
              states.map((item) => (
                <button
                  key={item.id}
                  className={selectedId === item.id ? "selected" : ""}
                  onClick={() => {
                    setSelectedId(item.id);
                    setStateForm({ ...item });
                  }}
                >
                  <i>
                    {entities
                      .find((entity) => entity.id === item.characterId)
                      ?.name.slice(0, 1) ?? "角"}
                  </i>
                  <b>
                    {entities.find((entity) => entity.id === item.characterId)
                      ?.name ?? "未知角色"}
                  </b>
                  <small>
                    {chapterName(item.chapterId)} ·{" "}
                    {item.location || "位置未知"}
                  </small>
                </button>
              ))
            ) : (
              <p>还没有角色状态。</p>
            ))}
          {view === "audit" &&
            (openFindings.length ? (
              openFindings.map((item) => (
                <div key={item.id} className="audit-item" data-severity={item.severity}>
                  <i>{item.source === "ai" ? "AI" : "规则"}</i>
                  <b>{item.message}</b>
                  <small>
                    {item.chapterPosition ? `第 ${item.chapterPosition} 章 · ` : ""}
                    {item.targetName ?? item.category}
                  </small>
                </div>
              ))
            ) : (
              <p>
                {checkBusy ? "正在运行确定性校验…" : "当前没有未处理的全局一致性发现。"}
              </p>
            ))}
        </aside>
        <section className="ledger-editor">
          {view === "overview" && (
            <div className="overview-panel">
              <span className="kicker">STORY OVERVIEW</span>
              <h1>故事总览</h1>
              <p className="audit-lead">
                全部来自已入正史的章节与记忆，本地聚合、零 token 消耗。
                记忆体检发现的问题在左侧清单，可在此一键清理。
              </p>

              <div className="overview-stats">
                {[
                  {
                    label: "已入正史",
                    value: `${overview.stats.acceptedChapters} / ${overview.stats.totalChapters} 章`,
                  },
                  {
                    label: "总字数",
                    value: overview.stats.totalWords.toLocaleString(),
                  },
                  { label: "人物", value: `${overview.stats.characterCount} 名` },
                  {
                    label: "时间线",
                    value: `${overview.stats.timelineCount} 条`,
                  },
                  {
                    label: "未回收伏笔",
                    value: `${overview.stats.foreshadowOpen} 条${
                      overview.stats.foreshadowOverdue
                        ? `（超期 ${overview.stats.foreshadowOverdue}）`
                        : ""
                    }`,
                  },
                  {
                    label: "人物状态",
                    value: `${overview.stats.stateCount} 条`,
                  },
                ].map((card) => (
                  <div key={card.label} className="overview-stat">
                    <small>{card.label}</small>
                    <b>{card.value}</b>
                  </div>
                ))}
              </div>

              {overview.issues.some((issue) => issue.kind === "duplicate-state") && (
                <div className="overview-card">
                  <h2>重复状态清理</h2>
                  <p className="audit-lead">
                    同一人物同一章被写入了完全相同的状态记录（自动接受的历史遗留），
                    保留最早一条即可。
                  </p>
                  {overview.issues
                    .filter((issue) => issue.kind === "duplicate-state")
                    .map((issue) => (
                      <div
                        key={issue.fix!.keepId}
                        className="overview-issue-row"
                      >
                        <span>{issue.message}</span>
                        <button
                          className="secondary"
                          disabled={cleanupBusy}
                          onClick={() => void mergeDuplicateState(issue)}
                        >
                          <Check size={14} /> 保留一条删重复
                        </button>
                      </div>
                    ))}
                </div>
              )}

              <div className="overview-card">
                <h2>人物出场</h2>
                <table className="overview-table">
                  <thead>
                    <tr>
                      <th>人物</th>
                      <th>首次出场</th>
                      <th>最近活动</th>
                      <th>状态记录</th>
                      <th>最新状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.characters
                      .filter((item) => item.stateCount > 0 || item.activePositions.length > 0)
                      .map((item) => (
                        <tr key={item.characterId}>
                          <td>
                            {item.name}
                            {item.status === "inactive" && (
                              <small>（已停用）</small>
                            )}
                          </td>
                          <td>{item.firstPosition || "—"}</td>
                          <td>{item.lastPosition || "—"}</td>
                          <td>{item.stateCount}</td>
                          <td className="overview-summary">
                            {item.latestSummary}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              <div className="overview-card">
                <h2>
                  道具流转
                  {overview.items.length > 0 && (
                    <small>（只列多人/多章持有过的）</small>
                  )}
                </h2>
                {overview.items.length ? (
                  <ul className="overview-items">
                    {overview.items.map((entry) => (
                      <li key={entry.item}>
                        <b>{entry.item}</b>
                        <span>
                          {entry.chain
                            .map(
                              (step) =>
                                `第${step.position}章·${step.holder}`,
                            )
                            .join(" → ")}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="audit-lead">还没有跨人物流转的道具。</p>
                )}
              </div>

              <div className="overview-card">
                <h2>
                  伏笔进度
                  <small>
                    （勾选后可批量废弃或删除；未回收 {overview.stats.foreshadowOpen} 条）
                  </small>
                </h2>
                {overview.foreshadow.length ? (
                  <>
                    <table className="overview-table">
                      <thead>
                        <tr>
                          <th></th>
                          <th>伏笔</th>
                          <th>埋设</th>
                          <th>回收</th>
                          <th>状态</th>
                          <th>年龄</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.foreshadow.map((entry) => {
                          const open =
                            entry.status !== "resolved" &&
                            entry.status !== "abandoned";
                          return (
                            <tr key={entry.id}>
                              <td>
                                {open && (
                                  <input
                                    type="checkbox"
                                    checked={selectedThreadIds.includes(entry.id)}
                                    onChange={(e) =>
                                      setSelectedThreadIds((current) =>
                                        e.target.checked
                                          ? [...current, entry.id]
                                          : current.filter((id) => id !== entry.id),
                                      )
                                    }
                                  />
                                )}
                              </td>
                              <td>{entry.title}</td>
                              <td>{entry.setupPosition || "—"}</td>
                              <td>{entry.payoffPosition ?? "—"}</td>
                              <td>
                                {FORESHADOW_STATUS_LABELS[entry.status]}
                                {entry.overdue && (
                                  <small className="overview-warn">超期</small>
                                )}
                              </td>
                              <td>{entry.age} 章</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {selectedThreadIds.length > 0 && (
                      <div className="overview-issue-row">
                        <span>已选 {selectedThreadIds.length} 条伏笔</span>
                        <span className="overview-actions">
                          <button
                            className="secondary"
                            disabled={cleanupBusy}
                            onClick={() => void batchArchiveThreads()}
                          >
                            <Archive size={14} /> 批量废弃（不再跟踪）
                          </button>
                          <button
                            className="secondary danger"
                            disabled={cleanupBusy}
                            onClick={() => void batchDeleteThreads()}
                          >
                            <Trash2 size={14} /> 批量删除
                          </button>
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="audit-lead">还没有伏笔记录。</p>
                )}
              </div>

              <div className="overview-card">
                <h2>各章摘要</h2>
                <table className="overview-table">
                  <thead>
                    <tr>
                      <th>章</th>
                      <th>标题</th>
                      <th>字数</th>
                      <th>时间线</th>
                      <th>状态</th>
                      <th>埋伏笔</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.chapters.map((entry) => (
                      <tr key={entry.position}>
                        <td>{entry.position}</td>
                        <td>{entry.title}</td>
                        <td>{entry.wordCount.toLocaleString()}</td>
                        <td>{entry.timelineCount}</td>
                        <td>{entry.stateCount}</td>
                        <td>{entry.foreshadowPlantedCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {view === "timeline" && (
            <>
              <span className="kicker">CANON TIMELINE</span>
              <h1>{selectedId ? "编辑时间线事件" : "新增时间线事件"}</h1>
              <div className="ledger-row">
                <label>
                  故事内时间
                  <input
                    value={timelineForm.storyTime}
                    onChange={(e) =>
                      setTimelineForm({
                        ...timelineForm,
                        storyTime: e.target.value,
                      })
                    }
                    placeholder="例如：星历 217 年 3 月"
                  />
                </label>
                <label>
                  关联章节
                  <select
                    value={timelineForm.chapterId ?? ""}
                    onChange={(e) =>
                      setTimelineForm({
                        ...timelineForm,
                        chapterId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">未关联章节</option>
                    {chapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                事件标题
                <input
                  value={timelineForm.title}
                  onChange={(e) =>
                    setTimelineForm({ ...timelineForm, title: e.target.value })
                  }
                />
              </label>
              <label>
                事件详情
                <textarea
                  rows={9}
                  value={timelineForm.detail}
                  onChange={(e) =>
                    setTimelineForm({ ...timelineForm, detail: e.target.value })
                  }
                />
              </label>
              <label>
                参与角色
                <select
                  multiple
                  value={timelineForm.participantIds}
                  onChange={(e) =>
                    setTimelineForm({
                      ...timelineForm,
                      participantIds: Array.from(
                        e.target.selectedOptions,
                        (item) => item.value,
                      ),
                    })
                  }
                >
                  {characters.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <small>按住 Ctrl 可选择多个角色。</small>
              </label>
              <LedgerFooter
                selected={selectedId}
                onDelete={() => remove("timeline")}
                onSave={async () => {
                  if (!timelineForm.title.trim()) return;
                  const saved = await saveTimeline(timelineForm);
                  setSelectedId(saved.id);
                  setTimelineForm(saved);
                }}
              />
            </>
          )}
          {view === "foreshadow" && (
            <>
              <span className="kicker">FORESHADOW LEDGER</span>
              <h1>{selectedId ? "编辑伏笔" : "新增伏笔"}</h1>
              <label>
                伏笔名称
                <input
                  value={threadForm.title}
                  onChange={(e) =>
                    setThreadForm({ ...threadForm, title: e.target.value })
                  }
                />
              </label>
              <label>
                设计与预期回报
                <textarea
                  rows={7}
                  value={threadForm.detail}
                  onChange={(e) =>
                    setThreadForm({ ...threadForm, detail: e.target.value })
                  }
                />
              </label>
              <div className="ledger-row">
                <label>
                  埋设章节
                  <select
                    value={threadForm.setupChapterId ?? ""}
                    onChange={(e) =>
                      setThreadForm({
                        ...threadForm,
                        setupChapterId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">尚未埋设</option>
                    {chapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  回收章节
                  <select
                    value={threadForm.payoffChapterId ?? ""}
                    onChange={(e) =>
                      setThreadForm({
                        ...threadForm,
                        payoffChapterId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">尚未回收</option>
                    {chapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                状态
                <select
                  value={threadForm.status}
                  onChange={(e) => {
                    const next = e.target.value as ForeshadowStatus;
                    if (
                      !threadForm.id ||
                      canMoveForeshadow(threadForm.status, next)
                    )
                      setThreadForm({ ...threadForm, status: next });
                  }}
                >
                  {Object.entries(FORESHADOW_STATUS_LABELS).map(
                    ([value, label]) => (
                      <option
                        key={value}
                        value={value}
                        disabled={
                          Boolean(threadForm.id) &&
                          !canMoveForeshadow(
                            threadForm.status,
                            value as ForeshadowStatus,
                          )
                        }
                      >
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <LedgerFooter
                selected={selectedId}
                onDelete={() => remove("foreshadow")}
                onSave={async () => {
                  if (!threadForm.title.trim()) return;
                  const saved = await saveForeshadow(threadForm);
                  setSelectedId(saved.id);
                  setThreadForm(saved);
                }}
              />
            </>
          )}
          {view === "audit" && (
            <div className="audit-panel">
              <span className="kicker">GLOBAL CONSISTENCY</span>
              <h1>全局一致性审查</h1>
              <p className="audit-lead">
                确定性校验在每章正史合并后自动运行（零 token）；AI 语义审查建议在
                封存周期前运行一次，会调用一次模型并产生费用。error 级问题会
                阻止自动接受与周期封存。
              </p>
              <div className="audit-actions">
                <button
                  className="secondary"
                  disabled={checkBusy}
                  onClick={() => {
                    setCheckBusy(true);
                    void runGlobalConsistencyCheck(novelId)
                      .catch((value) =>
                        setAuditError(
                          value instanceof Error ? value.message : "校验失败",
                        ),
                      )
                      .finally(() => setCheckBusy(false));
                  }}
                >
                  {checkBusy ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  重新运行确定性校验
                </button>
                <button
                  className="primary"
                  disabled={auditBusy}
                  title="调用一次模型审查全局正史记忆，产出修复提案；不直接改正史"
                  onClick={() => void runAiReview()}
                >
                  {auditBusy ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {auditBusy ? "Amy 正在审查…" : "运行 AI 全局审查"}
                </button>
                <button
                  className="primary"
                  disabled={bookBusy}
                  title="分窗口通读全部已入正史章节（5 章一窗 + 滚动摘要），抓跨章矛盾、重复桥段与文风漂移；每窗口一次模型调用，需几分钟"
                  onClick={() => void runBookReview()}
                >
                  {bookBusy ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <BookOpen size={15} />
                  )}
                  {bookBusy ? "通读中（每窗口几分钟）…" : "全书通读审稿"}
                </button>
              </div>
              {auditError && <div className="audit-error">{auditError}</div>}
              {openFindings.length > 0 && (
                <div className="audit-findings">
                  <h4>未处理发现（{openFindings.length}）</h4>
                  {openFindings.map((item) => {
                    const rewriteTarget = rewriteJobFor(item.chapterPosition);
                    return (
                      <article key={item.id} data-severity={item.severity}>
                        <header>
                          <b>{item.message}</b>
                          <span>
                            {item.source === "ai" ? "AI 审查" : "确定性规则"} ·{" "}
                            {item.severity}
                          </span>
                        </header>
                        {item.evidence && <small>{item.evidence}</small>}
                        {item.suggestion && <p>{item.suggestion}</p>}
                        <div className="audit-item-actions">
                          {item.targetKind === "chapter" &&
                            item.chapterPosition &&
                            (rewriteTarget ? (
                              <button
                                className="primary"
                                disabled={rewriteBusyId === item.id}
                                onClick={() => void rewriteFromFinding(item)}
                              >
                                {rewriteBusyId === item.id ? (
                                  <Loader2 size={14} className="spin" />
                                ) : (
                                  <RefreshCw size={14} />
                                )}
                                按反馈重写第 {item.chapterPosition} 章
                              </button>
                            ) : (
                              <small className="audit-muted">
                                第 {item.chapterPosition} 章没有进行中的生成任务；
                                到写作台人工修改。
                              </small>
                            ))}
                          <button
                            className="secondary"
                            onClick={() =>
                              void dismissGlobalFinding(novelId, item.id)
                            }
                          >
                            忽略
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {repairProposals.length > 0 && (
                <div className="audit-proposals">
                  <h4>设定修复提案（{repairProposals.length}）</h4>
                  {repairProposals.map((item) => (
                    <article key={item.id}>
                      <header>
                        <b>
                          {item.action === "add" ? "新增" : "更新"}
                          {item.targetType === "character"
                            ? "人物"
                            : item.targetType === "location"
                              ? "地点"
                              : item.targetType === "organization"
                                ? "势力"
                                : item.targetType === "item"
                                  ? "物品"
                                  : "术语"}
                          ：{item.targetName}
                        </b>
                      </header>
                      {item.patch.summary && <p>{item.patch.summary}</p>}
                      <small>{item.reason}</small>
                      <div className="audit-item-actions">
                        <button
                          className="secondary"
                          disabled={proposalBusyId === item.id}
                          onClick={() =>
                            void reviewRepairProposal(item.id, false)
                          }
                        >
                          <X size={14} /> 拒绝
                        </button>
                        <button
                          className="primary"
                          disabled={proposalBusyId === item.id}
                          onClick={() =>
                            void reviewRepairProposal(item.id, true)
                          }
                        >
                          {proposalBusyId === item.id ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <Check size={14} />
                          )}
                          接受并写入设定
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
          {view === "states" && (
            <>
              <span className="kicker">CHARACTER STATE</span>
              <h1>{selectedId ? "编辑角色状态" : "记录角色状态"}</h1>
              <div className="ledger-row">
                <label>
                  角色
                  <select
                    value={stateForm.characterId}
                    onChange={(e) =>
                      setStateForm({
                        ...stateForm,
                        characterId: e.target.value,
                      })
                    }
                  >
                    <option value="">选择角色</option>
                    {characters.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  状态截至章节
                  <select
                    value={stateForm.chapterId ?? ""}
                    onChange={(e) =>
                      setStateForm({
                        ...stateForm,
                        chapterId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">项目初始状态</option>
                    {chapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                状态摘要
                <textarea
                  rows={3}
                  value={stateForm.summary}
                  onChange={(e) =>
                    setStateForm({ ...stateForm, summary: e.target.value })
                  }
                />
              </label>
              <div className="ledger-row">
                <label>
                  当前位置
                  <input
                    value={stateForm.location}
                    onChange={(e) =>
                      setStateForm({ ...stateForm, location: e.target.value })
                    }
                  />
                </label>
                <label>
                  情绪状态
                  <input
                    value={stateForm.emotional}
                    onChange={(e) =>
                      setStateForm({ ...stateForm, emotional: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                身体状态
                <input
                  value={stateForm.physical}
                  onChange={(e) =>
                    setStateForm({ ...stateForm, physical: e.target.value })
                  }
                />
              </label>
              <div className="ledger-row">
                <label>
                  外貌变化
                  <input
                    placeholder="如：头发剪短、右臂受伤留疤"
                    value={stateForm.appearance ?? ""}
                    onChange={(e) =>
                      setStateForm({ ...stateForm, appearance: e.target.value })
                    }
                  />
                </label>
                <label>
                  当前衣着
                  <input
                    placeholder="如：黑色大衣、宴会礼服"
                    value={stateForm.outfit ?? ""}
                    onChange={(e) =>
                      setStateForm({ ...stateForm, outfit: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                身份变化
                <input
                  placeholder="如：获得“调查组顾问”头衔、使用假身份"
                  value={stateForm.identity ?? ""}
                  onChange={(e) =>
                    setStateForm({ ...stateForm, identity: e.target.value })
                  }
                />
              </label>
              <ListField
                label="已知信息"
                values={stateForm.knowledge}
                onChange={(knowledge) =>
                  setStateForm({ ...stateForm, knowledge })
                }
              />
              <ListField
                label="当前目标"
                values={stateForm.goals}
                onChange={(goals) => setStateForm({ ...stateForm, goals })}
              />
              <ListField
                label="关键物品"
                values={stateForm.inventory}
                onChange={(inventory) =>
                  setStateForm({ ...stateForm, inventory })
                }
              />
              <ListField
                label="技能、能力与熟练度"
                values={stateForm.skills}
                onChange={(skills) => setStateForm({ ...stateForm, skills })}
              />
              <LedgerFooter
                selected={selectedId}
                onDelete={() => remove("states")}
                onSave={async () => {
                  if (!stateForm.characterId) return;
                  const saved = await saveState(stateForm);
                  setSelectedId(saved.id);
                  setStateForm(saved);
                }}
              />
            </>
          )}
        </section>
        <aside className="canon-guide">
          <div className="amy-avatar">
            <Sparkles />
          </div>
          <h3>正史规则</h3>
          <p>
            手动记录会立即成为正史。未来 AI
            从已接受章节提取的变化会先进入候选区，确认后才写入这里。
          </p>
          <ul>
            <li>事件按故事内时间排序</li>
            <li>角色状态保留历史，不覆盖档案</li>
            <li>伏笔回收后不可随意回退</li>
          </ul>
        </aside>
      </div>
    </main>
  );
}

function ListField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <label>
      {label}
      <textarea
        rows={2}
        value={values.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
      />
      <small>每行一项。</small>
    </label>
  );
}
function LedgerFooter({
  selected,
  onDelete,
  onSave,
}: {
  selected: string | null;
  onDelete: () => void;
  onSave: () => void;
}) {
  return (
    <footer>
      {selected && (
        <button className="danger" onClick={onDelete}>
          <Trash2 size={16} />
          删除
        </button>
      )}
      <button className="primary" onClick={onSave}>
        <Save size={16} />
        保存到正史
      </button>
    </footer>
  );
}

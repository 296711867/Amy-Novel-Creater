import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Download,
  Loader2,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Square,
  X,
} from "lucide-react";
import {
  batchProgress,
  generationEventToJsonl,
  staleEarlierChapterTitle,
  BATCH_STATUS_LABELS,
  JOB_STATUS_LABELS,
} from "@domain/generation";
import type { GenerationBatch, GenerationEvent, GenerationJob } from "@domain/generation";
import { CANDIDATE_STATUS_LABELS } from "@domain/chapter-generation";
import type { ChapterCandidate } from "@domain/chapter-generation";
import type { Chapter } from "@domain/novel";
import type { FactProposal, StoredFinding } from "@domain/quality-check";
import { FORESHADOW_STATUS_LABELS } from "@domain/continuity";
import { useNovelStore } from "../store/novel-store";
import "../batches.css";
import "../reviews.css";
import "../findings.css";

const FACT_KIND_LABELS: Record<FactProposal["kind"], string> = {
  timeline: "时间线",
  character_state: "角色状态",
  foreshadow: "伏笔",
};
const EMPTY_JOBS: GenerationJob[] = [];

export function BatchesPage(): React.JSX.Element {
  const store = useNovelStore(),
    { batches, jobs, novels, candidates, findings, factProposals } =
      useNovelStore((s) => s);
  const [activeBatchId, setActiveBatchId] = useState(""),
    [selectedJobId, setSelectedJobId] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState<GenerationJob | null>(null),
    knownReadyIds = useRef<Set<string>>(new Set());

  async function refresh() {
    const list = await store.loadBatches(),
      groups = await Promise.all(list.map((item) => store.loadJobs(item.id))),
      drafts = await Promise.all(
        groups.flatMap((group) =>
          group.map((job) => store.loadCandidates(job.chapterId)),
        ),
      );
    await Promise.all(drafts.flat().map((item) => store.loadQuality(item.id)));
    for (const batch of list)
      await store.loadChapters(batch.novelId).catch(() => []);
    await Promise.all(list.map((item) => store.loadActivity(item.id)));
  }
  useEffect(() => {
    store.ensureActivityListener();
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!batches.some((item) => item.status === "running")) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [batches.some((item) => item.status === "running")]);

  // 自动选中当前最需要关注的批次：生成中 > 等待审核 > 最新。
  const autoBatchId = useMemo(() => {
    const running = batches.find((item) => item.status === "running"),
      awaiting = batches.find((item) => item.awaitingReview),
      recent = batches.find((item) => item.status !== "completed");
    return (running ?? awaiting ?? recent ?? batches[0])?.id ?? "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches.map((item) => `${item.id}:${item.status}:${item.awaitingReview}`).join("|")]);
  const activeId = batches.some((item) => item.id === activeBatchId)
    ? activeBatchId
    : autoBatchId;
  const batch = batches.find((item) => item.id === activeId) ?? null,
    batchJobs = batch ? (jobs[batch.id] ?? EMPTY_JOBS) : EMPTY_JOBS;

  // 切换批次时默认聚焦第一个待审章节；之后的主动选择不被覆盖。
  useEffect(() => {
    if (!batch) return;
    if (selectedJobId && batchJobs.some((item) => item.id === selectedJobId))
      return;
    const ready = batchJobs.find((item) => item.status === "candidate_ready"),
      target = ready ?? batchJobs[0];
    setSelectedJobId(target?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.id, batchJobs.length, selectedJobId]);

  // 新章节生成完只提示，不打断当前阅读。
  useEffect(() => {
    const readyJobs = batchJobs.filter(
      (item) => item.status === "candidate_ready",
    );
    const fresh = readyJobs.filter((item) => !knownReadyIds.current.has(item.id));
    for (const item of readyJobs) knownReadyIds.current.add(item.id);
    if (
      fresh.length &&
      selectedJobId &&
      fresh.every((item) => item.id !== selectedJobId)
    )
      setNotice(fresh[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchJobs.map((item) => `${item.id}:${item.status}`).join("|")]);

  const selectedJob = batchJobs.find((item) => item.id === selectedJobId) ?? null,
    selectedCandidate = selectedJob?.candidateId
      ? Object.values(candidates)
          .flat()
          .find((value) => value.id === selectedJob.candidateId) ?? null
      : null;
  useEffect(() => {
    if (selectedCandidate) void store.loadQuality(selectedCandidate.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCandidate?.id]);

  async function run(id: string) {
    setError("");
    try {
      await store.dispatchBatch(id);
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "批次执行失败");
    }
  }

  return (
    <main className="page batches-page workbench-page">
      <div className="page-heading">
        <div>
          <span className="kicker">GENERATION WORKBENCH</span>
          <h1>生成工作台</h1>
          <p>
            左边看队列，中间读稿改稿审正史，右边看 Amy 的生成过程。每章确认后才写下一章。
          </p>
        </div>
      </div>
      {batches.length > 1 && (
        <div className="batch-switcher">
          {batches.map((item) => (
            <button
              key={item.id}
              className={item.id === activeId ? "on" : ""}
              onClick={() => setActiveBatchId(item.id)}
            >
              <b>
                {novels.find((value) => value.id === item.novelId)?.title ??
                  "未知作品"}
              </b>
              <span>
                第 {item.policy.startChapter}–{item.policy.endChapter} 章 ·{" "}
                {item.awaitingReview
                  ? "等待审核"
                  : BATCH_STATUS_LABELS[item.status]}
              </span>
            </button>
          ))}
        </div>
      )}
      {batches.length === 0 && (
        <div className="empty-inline">还没有生成任务，先到作品页配置生成。</div>
      )}
      {error && <div className="error">{error}</div>}
      {batch && (
        <Workbench
          batch={batch}
          jobs={batchJobs}
          chapters={store.chapters[batch.novelId] ?? []}
          selectedJob={selectedJob}
          selectedCandidate={selectedCandidate}
          findings={selectedCandidate ? (findings[selectedCandidate.id] ?? []) : []}
          proposals={
            selectedCandidate ? (factProposals[selectedCandidate.id] ?? []) : []
          }
          notice={notice}
          onDismissNotice={() => setNotice(null)}
          onSelectJob={(id) => {
            setSelectedJobId(id);
            setNotice(null);
          }}
          onRun={() => void run(batch.id)}
        />
      )}
    </main>
  );
}

function Workbench({
  batch,
  jobs,
  chapters,
  selectedJob,
  selectedCandidate,
  findings,
  proposals,
  notice,
  onDismissNotice,
  onSelectJob,
  onRun,
}: {
  batch: GenerationBatch;
  jobs: GenerationJob[];
  chapters: Chapter[];
  selectedJob: GenerationJob | null;
  selectedCandidate: ChapterCandidate | null;
  findings: StoredFinding[];
  proposals: FactProposal[];
  notice: GenerationJob | null;
  onDismissNotice(): void;
  onSelectJob(id: string): void;
  onRun(): void;
}) {
  const store = useNovelStore(),
    novel = useNovelStore((s) => s.novels.find((item) => item.id === batch.novelId)),
    progress = batchProgress(jobs),
    failedCount = jobs.filter((item) => item.status === "failed").length,
    nextQueued = jobs
      .filter((item) => item.status === "queued")
      .sort((a, b) => a.position - b.position)[0],
    awaitingBlocker = nextQueued
      ? jobs.find(
          (item) =>
            item.position < nextQueued.position && item.status === "candidate_ready",
        )
      : undefined,
    noticeChapter = notice
      ? chapters.find((item) => item.id === notice.chapterId)
      : undefined;
  return (
    <section className="workbench">
      <header className="workbench-top">
        <div className="workbench-meta">
          <b>{novel?.title ?? "未知作品"}</b>
          <span>
            第 {batch.policy.startChapter}–{batch.policy.endChapter} 章 ·{" "}
            {batch.awaitingReview ? "等待审核" : BATCH_STATUS_LABELS[batch.status]} ·{" "}
            {progress}% · {batch.outputTokensUsed.toLocaleString()} /{" "}
            {batch.policy.outputTokenBudget.toLocaleString()} tokens
          </span>
        </div>
        <div className="workbench-controls">
          {batch.status === "running" ? (
            <button className="secondary" onClick={() => store.setBatchStatus(batch.id, "paused")}>
              <Pause size={15} /> 暂停
            </button>
          ) : awaitingBlocker ? (
            <button
              className="primary"
              disabled
              title="请先接受上一章候选稿并处理正史建议"
            >
              <Play size={15} /> 继续生成下一章
            </button>
          ) : (
            <button className="primary" onClick={onRun}>
              <Play size={15} />
              {batch.status === "queued" && !batch.outputTokensUsed
                ? "开始生成"
                : nextQueued
                  ? "继续生成下一章"
                  : "继续"}
            </button>
          )}
          {(batch.status === "running" || batch.status === "paused") && (
            <button
              className="secondary danger"
              onClick={() => store.setBatchStatus(batch.id, "cancelled")}
            >
              <Square size={14} /> 停止
            </button>
          )}
          {failedCount > 0 && (
            <button
              className="secondary"
              onClick={() => void store.retryFailedJobs(batch.id)}
            >
              <RotateCcw size={15} /> 重试失败（{failedCount}）
            </button>
          )}
        </div>
      </header>
      {notice && (
        <div className="workbench-notice">
          <AlertTriangle size={15} />
          <span>
            {noticeChapter
              ? `第 ${noticeChapter.position} 章《${noticeChapter.title}》已生成完毕，可以阅读。`
              : "新章节已生成完毕，可以阅读。"}
          </span>
          <button
            onClick={() => {
              onSelectJob(notice.id);
            }}
          >
            查看该章
          </button>
          <button className="ghost" onClick={onDismissNotice}>
            <X size={14} />
          </button>
        </div>
      )}
      <div className="workbench-body">
        <aside className="workbench-queue">
          <h4>章节队列</h4>
          {[...jobs]
            .sort((a, b) => a.position - b.position)
            .map((job) => {
              const chapter = chapters.find((item) => item.id === job.chapterId),
                candidate = job.candidateId
                  ? Object.values(store.candidates)
                      .flat()
                      .find((value) => value.id === job.candidateId)
                  : undefined,
                staleTitle = candidate
                  ? staleEarlierChapterTitle(
                      candidate,
                      chapters,
                      Object.values(store.candidates).flat(),
                    )
                  : null;
              return (
                <button
                  key={job.id}
                  className={`queue-item ${job.id === selectedJob?.id ? "on" : ""}`}
                  onClick={() => onSelectJob(job.id)}
                >
                  <span className="queue-title">
                    {chapter ? `${chapter.position}. ${chapter.title}` : "章节"}
                  </span>
                  <span className={`queue-status ${job.status}`}>
                    {JOB_STATUS_LABELS[job.status]}
                  </span>
                  {candidate && (
                    <small>
                      {candidate.wordCount.toLocaleString()} 字
                      {candidate.status !== "candidate"
                        ? ` · ${CANDIDATE_STATUS_LABELS[candidate.status]}`
                        : ""}
                    </small>
                  )}
                  {staleTitle && (
                    <small className="queue-stale">⚠ 前文已改，可能受影响</small>
                  )}
                  {job.status === "failed" && (
                    <small className="queue-error">{job.error || "生成失败"}</small>
                  )}
                </button>
              );
            })}
        </aside>
        <section className="workbench-reader">
          {selectedJob ? (
            <ChapterPane
              key={selectedJob.id}
              job={selectedJob}
              novelId={batch.novelId}
              chapter={chapters.find((item) => item.id === selectedJob.chapterId) ?? null}
              candidate={selectedCandidate}
              findings={findings}
              proposals={proposals}
              staleChapterTitle={
                selectedCandidate
                  ? staleEarlierChapterTitle(
                      selectedCandidate,
                      chapters,
                      Object.values(store.candidates).flat(),
                    )
                  : null
              }
            />
          ) : (
            <div className="reader-empty">选择左侧章节查看候选稿。</div>
          )}
        </section>
        <aside className="workbench-log">
          <ActivityLog batchId={batch.id} novelId={batch.novelId} />
        </aside>
      </div>
    </section>
  );
}

function ChapterPane({
  job,
  novelId,
  chapter,
  candidate,
  findings,
  proposals,
  staleChapterTitle,
}: {
  job: GenerationJob;
  novelId: string;
  chapter: Chapter | null;
  candidate: ChapterCandidate | null;
  findings: StoredFinding[];
  proposals: FactProposal[];
  staleChapterTitle: string | null;
}) {
  const store = useNovelStore(),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(""),
    [saving, setSaving] = useState(false),
    [busyAction, setBusyAction] = useState(""),
    [flash, setFlash] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    setEditing(false);
    setDraft("");
    setFlash("");
    setError("");
  }, [candidate?.id]);
  async function saveDraft() {
    if (!candidate) return;
    setSaving(true);
    setError("");
    try {
      await store.editCandidateContent(candidate.id, draft);
      setEditing(false);
      setFlash("修改已保存；接受时写入的就是改后版本。");
    } catch (value) {
      setError(value instanceof Error ? value.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }
  async function review(accept: boolean) {
    if (!candidate) return;
    setBusyAction(accept ? "accept" : "reject");
    setError("");
    try {
      await store.reviewCandidate(candidate.id, accept);
      setFlash(
        accept ? "已接受并写入正史，可继续生成下一章。" : "已拒绝，候选稿保留用于追溯。",
      );
    } catch (value) {
      setError(value instanceof Error ? value.message : "处理失败");
    } finally {
      setBusyAction("");
    }
  }
  async function reviewProposal(id: string, accept: boolean) {
    if (!candidate) return;
    setBusyAction(id);
    setError("");
    try {
      await store.reviewFactProposal(candidate.id, id, accept);
    } catch (value) {
      setError(value instanceof Error ? value.message : "建议处理失败");
    } finally {
      setBusyAction("");
    }
  }
  if (job.status === "failed")
    return (
      <div className="reader-state">
        <AlertTriangle size={20} />
        <b>本章生成失败{job.attempt > 1 ? `（已重试 ${job.attempt - 1} 次）` : ""}</b>
        <p>{job.error || "未知错误"}</p>
        <button className="primary" onClick={() => void store.retryGenerationJob(job.batchId, job.id)}>
          <RotateCcw size={15} /> 重试本章
        </button>
      </div>
    );
  if (!candidate)
    return (
      <div className="reader-state">
        {job.status === "generating" || job.status === "building_context" ? (
          <>
            <Loader2 size={20} className="spin" />
            <b>Amy 正在写这一章…</b>
            <p>生成过程见右侧日志；完成时这里会出现候选稿，不会打断你当前的操作。</p>
          </>
        ) : (
          <>
            <b>{JOB_STATUS_LABELS[job.status]}</b>
            <p>
              {job.status === "queued" || job.status === "waiting_retry"
                ? "排队中：按单章审批制，前面的章节确认为正史后才会开始写本章。"
                : "本章还没有候选稿。"}
            </p>
          </>
        )}
      </div>
    );
  return (
    <div className="reader-pane">
      <header className="reader-toolbar">
        <div>
          <b>{chapter?.title ?? "章节候选稿"}</b>
          <span>
            {candidate.wordCount.toLocaleString()} 字 · 输出{" "}
            {candidate.outputTokens.toLocaleString()} tokens ·{" "}
            {CANDIDATE_STATUS_LABELS[candidate.status]}
          </span>
        </div>
        <div>
          {candidate.status === "candidate" && !editing && (
            <button className="secondary" onClick={() => { setDraft(candidate.content); setEditing(true); }}>
              <Pencil size={14} /> 改稿
            </button>
          )}
          {editing && (
            <>
              <button className="secondary" disabled={saving} onClick={() => setEditing(false)}>
                取消
              </button>
              <button className="primary" disabled={saving} onClick={() => void saveDraft()}>
                {saving ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
                {saving ? "保存中…" : "保存修改"}
              </button>
            </>
          )}
          {candidate.status === "candidate" && !editing && (
            <>
              <button className="reject" disabled={busyAction !== ""} onClick={() => void review(false)}>
                <X size={14} /> 拒绝
              </button>
              <button className="accept" disabled={busyAction !== ""} onClick={() => void review(true)}>
                {busyAction === "accept" ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Check size={14} />
                )}
                {busyAction === "accept" ? "写入中…" : "接受并写入正文"}
              </button>
            </>
          )}
          {candidate.status === "accepted" && (
            <a className="reader-link" href={`#/novels/${novelId}/write/${candidate.chapterId}`}>
              在编辑器中打开
            </a>
          )}
        </div>
      </header>
      {flash && <div className="flash-ok">{flash}</div>}
      {error && <div className="error">{error}</div>}
      {staleChapterTitle && (
        <div className="stale-warning">
          <AlertTriangle size={15} />
          <span>
            前文《{staleChapterTitle}
            》在本章生成后有过修改，本章是基于旧前文写的，内容可能已不衔接。
          </span>
          {candidate.status === "candidate" && (
            <button
              disabled={busyAction !== "" || editing}
              onClick={() =>
                void store.regenerateGenerationJob(job.batchId, job.id)
              }
            >
              <RotateCcw size={14} /> 按最新前文重写本章
            </button>
          )}
        </div>
      )}
      {editing ? (
        <textarea
          className="reader-editor"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <article className="reader-content">{candidate.content}</article>
      )}
      {findings.length > 0 && (
        <div className="finding-list">
          {findings.map((finding) => (
            <div key={finding.id} data-severity={finding.severity}>
              <b>{finding.message}</b>
              <small>{finding.evidence}</small>
              <span>
                {finding.status === "open" ? (
                  <>
                    <button
                      onClick={() =>
                        store.updateFinding(candidate.id, finding.id, "dismissed")
                      }
                    >
                      忽略
                    </button>
                    <button
                      onClick={() =>
                        store.updateFinding(candidate.id, finding.id, "resolved")
                      }
                    >
                      已解决
                    </button>
                  </>
                ) : finding.status === "resolved" ? (
                  "已解决"
                ) : (
                  "已忽略"
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {proposals.length > 0 && (
        <div className="proposal-list">
          <h4>AI 正史建议（接受候选稿后可写入）</h4>
          {proposals.map((proposal) => (
            <div key={proposal.id}>
              <span>{FACT_KIND_LABELS[proposal.kind]}</span>
              <b>{proposal.title}</b>
              <small>
                {Object.entries(proposal.payload)
                  .map(([key, value]) => {
                    if (key === "status")
                      return `status: ${
                        FORESHADOW_STATUS_LABELS[
                          value as keyof typeof FORESHADOW_STATUS_LABELS
                        ] ?? String(value)
                      }`;
                    return `${key}: ${Array.isArray(value) ? value.join("、") : String(value)}`;
                  })
                  .join(" · ")}
              </small>
              <i>
                {proposal.status === "proposed" ? (
                  <>
                    <button
                      className="reject"
                      disabled={busyAction === proposal.id}
                      onClick={() => void reviewProposal(proposal.id, false)}
                    >
                      <X size={14} />
                      {busyAction === proposal.id ? "处理中…" : "拒绝"}
                    </button>
                    <button
                      className="accept"
                      disabled={
                        candidate.status !== "accepted" || busyAction === proposal.id
                      }
                      title={
                        candidate.status === "accepted"
                          ? "写入正史"
                          : "请先接受候选稿"
                      }
                      onClick={() => void reviewProposal(proposal.id, true)}
                    >
                      {busyAction === proposal.id ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <Check size={14} />
                      )}
                      {busyAction === proposal.id ? "写入中…" : "接受并写入正史"}
                    </button>
                  </>
                ) : proposal.status === "accepted" ? (
                  "已写入正史"
                ) : (
                  "已拒绝"
                )}
              </i>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const EVENT_LEVEL_CLASS: Record<GenerationEvent["level"], string> = {
  info: "",
  success: "ok",
  warning: "warn",
  error: "err",
};

function ActivityLog({ batchId, novelId }: { batchId: string; novelId: string }) {
  const events = useNovelStore((s) => s.activityEvents[batchId] ?? []),
    listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [events.length]);
  function exportJsonl() {
    // harness 技术日志：运行/章节/阶段/模型/token/重试/错误码；不含密钥、提示词与整章原文。
    const jsonl = generationEventToJsonl(events),
      blob = new Blob([jsonl], { type: "application/x-ndjson" }),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `amy-novel-run-${novelId.slice(0, 8)}-${batchId.slice(0, 8)}.jsonl`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="activity-panel">
      <header>
        <h4>生成过程日志</h4>
        <button
          onClick={exportJsonl}
          disabled={!events.length}
          title="导出 JSONL 运行日志，供 harness 迭代分析"
        >
          <Download size={13} /> JSONL
        </button>
      </header>
      {events.length === 0 ? (
        <p className="activity-empty">开始生成后，Amy 的每一步都会记在这里。</p>
      ) : (
        <ul ref={listRef}>
          {events.map((event) => (
            <li key={event.id} className={EVENT_LEVEL_CLASS[event.level]}>
              <time>{new Date(event.createdAt).toLocaleTimeString()}</time>
              <span>{event.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

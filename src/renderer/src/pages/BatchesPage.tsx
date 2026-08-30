import { useEffect, useMemo, useState } from "react";
import { Check, Pause, Play, X } from "lucide-react";
import { batchProgress } from "@domain/generation";
import type { ChapterCandidate } from "@domain/chapter-generation";
import type { FactProposal, StoredFinding } from "@domain/quality-check";
import { useNovelStore } from "../store/novel-store";
import "../batches.css";
import "../reviews.css";
import "../findings.css";

export function BatchesPage(): React.JSX.Element {
  const store = useNovelStore(),
    { batches, jobs, novels, candidates, findings, factProposals } =
      useNovelStore((s) => s);
  const [reviewBatch, setReviewBatch] = useState(""),
    [error, setError] = useState("");
  async function refresh() {
    const list = await store.loadBatches(),
      groups = await Promise.all(list.map((item) => store.loadJobs(item.id))),
      drafts = await Promise.all(
        groups.flatMap((group) =>
          group.map((job) => store.loadCandidates(job.chapterId)),
        ),
      );
    await Promise.all(drafts.flat().map((item) => store.loadQuality(item.id)));
  }
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (!batches.some((item) => item.status === "running")) return;
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => window.clearInterval(timer);
  }, [batches.some((item) => item.status === "running")]);
  const reviewItems = useMemo(() => {
    const ids = new Set(
      (jobs[reviewBatch] ?? []).map((item) => item.candidateId).filter(Boolean),
    );
    return Object.values(candidates)
      .flat()
      .filter((item) => ids.has(item.id));
  }, [reviewBatch, jobs, candidates]);
  async function run(id: string) {
    setError("");
    try {
      await store.dispatchBatch(id);
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : "批次执行失败");
    }
  }
  async function reviewAll(accept: boolean) {
    for (const item of reviewItems.filter(
      (value) => value.status === "candidate",
    ))
      await store.reviewCandidate(item.id, accept);
  }
  return (
    <main className="page batches-page">
      <div className="page-heading">
        <div>
          <span className="kicker">PERSISTENT GENERATION QUEUE</span>
          <h1>生成任务</h1>
          <p>后台逐章执行，候选稿与质量问题集中审阅。</p>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="batch-list">
        {batches.length === 0 ? (
          <div className="empty-inline">还没有批次。</div>
        ) : (
          batches.map((batch) => {
            const items = jobs[batch.id] ?? [],
              progress = batchProgress(items);
            return (
              <article key={batch.id}>
                <header>
                  <div>
                    <b>
                      {novels.find((item) => item.id === batch.novelId)
                        ?.title ?? "未知作品"}
                    </b>
                    <span>
                      第 {batch.policy.startChapter}–{batch.policy.endChapter}{" "}
                      章
                    </span>
                  </div>
                  <span className={`batch-status ${batch.status}`}>
                    {batch.status}
                  </span>
                </header>
                <div className="batch-progress">
                  <i style={{ width: `${progress}%` }} />
                </div>
                <div className="batch-stats">
                  <span>{progress}%</span>
                  <span>
                    {
                      items.filter(
                        (item) =>
                          item.status === "candidate_ready" ||
                          item.status === "completed",
                      ).length
                    }
                    /{items.length} 章
                  </span>
                  <span>{batch.outputTokensUsed.toLocaleString()} tokens</span>
                </div>
                <footer>
                  <div>
                    {batch.status === "running" ? (
                      <button
                        className="secondary"
                        onClick={() => store.setBatchStatus(batch.id, "paused")}
                      >
                        <Pause size={15} />
                        暂停
                      </button>
                    ) : batch.status !== "completed" ? (
                      <button className="primary" onClick={() => run(batch.id)}>
                        <Play size={15} />
                        {batch.status === "paused" ? "继续" : "开始"}
                      </button>
                    ) : null}
                    <button
                      className="secondary"
                      onClick={() =>
                        setReviewBatch(reviewBatch === batch.id ? "" : batch.id)
                      }
                    >
                      集中审阅
                    </button>
                  </div>
                </footer>
              </article>
            );
          })
        )}
      </div>
      {reviewBatch && (
        <section className="review-drawer">
          <header>
            <div>
              <span className="kicker">CANDIDATE REVIEW</span>
              <h2>候选稿与质量问题</h2>
            </div>
            <span>
              <button className="secondary" onClick={() => reviewAll(false)}>
                <X size={15} />
                全部拒绝
              </button>
              <button className="primary" onClick={() => reviewAll(true)}>
                <Check size={15} />
                全部接受
              </button>
            </span>
          </header>
          {reviewItems.map((item) => (
            <CandidateCard
              key={item.id}
              item={item}
              findings={findings[item.id] ?? []}
              proposals={factProposals[item.id] ?? []}
            />
          ))}
        </section>
      )}
    </main>
  );
}

function CandidateCard({
  item,
  findings,
  proposals,
}: {
  item: ChapterCandidate;
  findings: StoredFinding[];
  proposals: FactProposal[];
}) {
  const store = useNovelStore(),
    [error, setError] = useState("");
  async function review(id: string, accept: boolean) {
    setError("");
    try {
      await store.reviewFactProposal(item.id, id, accept);
    } catch (value) {
      setError(value instanceof Error ? value.message : "建议处理失败");
    }
  }
  return (
    <article>
      <header>
        <b>
          {useNovelStore
            .getState()
            .chapters[item.novelId]?.find((ch) => ch.id === item.chapterId)
            ?.title ?? "章节候选稿"}
        </b>
        <span>
          {item.wordCount} 字 · {item.outputTokens} 输出 tokens
        </span>
      </header>
      <p>
        {item.content.slice(0, 220)}
        {item.content.length > 220 ? "…" : ""}
      </p>
      {findings.length > 0 && (
        <div className="finding-list">
          {findings.map((f) => (
            <div key={f.id} data-severity={f.severity}>
              <b>{f.message}</b>
              <small>{f.evidence}</small>
              <span>
                {f.status === "open" ? (
                  <>
                    <button
                      onClick={() =>
                        store.updateFinding(item.id, f.id, "dismissed")
                      }
                    >
                      忽略
                    </button>
                    <button
                      onClick={() =>
                        store.updateFinding(item.id, f.id, "resolved")
                      }
                    >
                      已解决
                    </button>
                  </>
                ) : f.status === "resolved" ? (
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
          <h4>AI 正史建议</h4>
          {proposals.map((proposal) => (
            <div key={proposal.id}>
              <span>
                {proposal.kind === "timeline"
                  ? "时间线"
                  : proposal.kind === "character_state"
                    ? "角色状态"
                    : "伏笔"}
              </span>
              <b>{proposal.title}</b>
              <small>
                {Object.entries(proposal.payload)
                  .map(
                    ([key, value]) =>
                      `${key}: ${Array.isArray(value) ? value.join("、") : String(value)}`,
                  )
                  .join(" · ")}
              </small>
              <i>
                {proposal.status === "proposed" ? (
                  <>
                    <button onClick={() => review(proposal.id, false)}>
                      拒绝
                    </button>
                    <button onClick={() => review(proposal.id, true)}>
                      接受并写入正史
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
      {error && <div className="error">{error}</div>}
      <footer>
        <i>{item.status}</i>
        {item.status === "candidate" && (
          <span>
            <button onClick={() => store.reviewCandidate(item.id, false)}>
              <X size={14} />
              拒绝
            </button>
            <button onClick={() => store.reviewCandidate(item.id, true)}>
              <Check size={14} />
              接受
            </button>
          </span>
        )}
      </footer>
    </article>
  );
}

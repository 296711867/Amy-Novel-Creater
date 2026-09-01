import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  Flag,
  Loader2,
  Replace,
  Search,
} from "lucide-react";
import { Navigate, NavLink, useParams } from "react-router-dom";
import {
  MIN_REVISION_QUERY,
  globalSearchChapters,
} from "@domain/revision";
import { useNovelStore } from "@renderer/store/novel-store";

const EMPTY: never[] = [];

/**
 * AN-031 整书连读 + AN-034 全局微调。
 *
 * 连读：像读者一样从头读到尾，随手把疑点标记进全局审查台账
 * （source=author，跨校验/审查轮保留）；修订面板：全书查找 →
 * 逐章预览 → 逐章确认替换，每次应用创建章节版本快照可回滚。
 */
export function BookReaderPage(): React.JSX.Element {
  const { novelId = "" } = useParams();
  const novel = useNovelStore((s) => s.novels.find((item) => item.id === novelId));
  const chapters = useNovelStore((s) => s.chapters[novelId] ?? EMPTY);
  const loadChapters = useNovelStore((s) => s.loadChapters);
  const addAuthorFinding = useNovelStore((s) => s.addAuthorFinding);
  const reviseChapterContent = useNovelStore((s) => s.reviseChapterContent);
  const [markingId, setMarkingId] = useState<string | null>(null),
    [markText, setMarkText] = useState(""),
    [markBusy, setMarkBusy] = useState(false),
    [markDone, setMarkDone] = useState(""),
    [reviseOpen, setReviseOpen] = useState(false),
    [query, setQuery] = useState(""),
    [replacement, setReplacement] = useState(""),
    [applyBusyId, setApplyBusyId] = useState(""),
    [reviseError, setReviseError] = useState(""),
    [appliedIds, setAppliedIds] = useState<string[]>([]);

  useEffect(() => {
    void loadChapters(novelId);
  }, [loadChapters, novelId]);

  const accepted = useMemo(
    () =>
      [...chapters]
        .filter((item) => item.status === "accepted" && item.content.trim())
        .sort((a, b) => a.position - b.position),
    [chapters],
  );
  const matches = useMemo(
    () =>
      reviseOpen && query.trim().length >= MIN_REVISION_QUERY
        ? globalSearchChapters(accepted, query)
        : [],
    [reviseOpen, query, accepted],
  );

  if (!novel) return <Navigate to="/novels" replace />;

  async function mark(position: number) {
    if (!markText.trim()) return;
    setMarkBusy(true);
    try {
      await addAuthorFinding(novelId, position, markText.trim());
      setMarkText("");
      setMarkingId(null);
      setMarkDone(`第 ${position} 章的疑点已记录，可到 连续性 → 全局审查 查看。`);
      window.setTimeout(() => setMarkDone(""), 6000);
    } finally {
      setMarkBusy(false);
    }
  }

  async function applyRevision(chapterId: string, position: number, count: number) {
    if (
      !window.confirm(
        `确定在第 ${position} 章替换 ${count} 处「${query.trim()}」为「${replacement}」吗？会创建新的版本快照，可在写作台历史版本回滚。`,
      )
    )
      return;
    setApplyBusyId(chapterId);
    setReviseError("");
    try {
      const result = await reviseChapterContent(chapterId, query.trim(), replacement);
      if (result.count) setAppliedIds((current) => [...current, chapterId]);
    } catch (value) {
      setReviseError(value instanceof Error ? value.message : "替换失败");
    } finally {
      setApplyBusyId("");
    }
  }

  return (
    <main className="page book-reader">
      <header className="continuity-top">
        <NavLink to={`/novels/${novelId}/continuity`}>
          <ChevronLeft size={17} />
          返回连续性
        </NavLink>
        <div>
          <b>{novel.title}</b>
          <span>整书连读（{accepted.length} 章已入正史）</span>
        </div>
        <button
          className={reviseOpen ? "" : ""}
          onClick={() => setReviseOpen((current) => !current)}
          title="全书查找替换：逐章预览并确认，每次替换创建版本快照"
        >
          <Replace size={16} />
          {reviseOpen ? "收起修订" : "全局修订"}
        </button>
      </header>

      {reviseOpen && (
        <section className="revision-panel">
          <div className="revision-form">
            <label>
              查找
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`至少 ${MIN_REVISION_QUERY} 个字，如人物旧称呼`}
              />
            </label>
            <label>
              替换为
              <input
                value={replacement}
                onChange={(event) => setReplacement(event.target.value)}
                placeholder="留空即删除该词"
              />
            </label>
            <span className="revision-hint">
              <Search size={14} />
              {query.trim().length < MIN_REVISION_QUERY
                ? "输入查找词后自动检索已入正史章节"
                : `命中 ${matches.length} 章、共 ${matches.reduce((sum, item) => sum + item.count, 0)} 处；逐章确认后才会替换`}
            </span>
          </div>
          {reviseError && <div className="error">{reviseError}</div>}
          {matches.length > 0 && (
            <ul className="revision-matches">
              {matches.map((item) => {
                const applied = appliedIds.includes(item.chapterId);
                return (
                  <li key={item.chapterId}>
                    <div>
                      <b>
                        第 {item.position} 章 · {item.title}
                      </b>
                      <small>
                        {item.count} 处 · “{item.preview.before}
                        <mark>{item.preview.hit}</mark>
                        {item.preview.after}”
                      </small>
                    </div>
                    <button
                      className="secondary"
                      disabled={
                        applied ||
                        applyBusyId === item.chapterId ||
                        query.trim() === replacement
                      }
                      onClick={() =>
                        void applyRevision(item.chapterId, item.position, item.count)
                      }
                    >
                      {applyBusyId === item.chapterId ? (
                        <Loader2 size={14} className="spin" />
                      ) : applied ? (
                        "已替换"
                      ) : (
                        `替换 ${item.count} 处`
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="revision-note">
            替换只改正文并保留版本快照；正史记忆（人物状态/时间线/伏笔）不会自动更新，
            涉及设定的改动请同步到连续性台账。
          </p>
        </section>
      )}

      <div className="book-layout">
        <aside className="book-toc">
          {accepted.map((chapter) => (
            <a key={chapter.id} href={`#book-ch-${chapter.position}`}>
              <b>
                {chapter.position}. {chapter.title}
              </b>
              <small>{chapter.wordCount.toLocaleString()} 字</small>
            </a>
          ))}
          {accepted.length === 0 && <p>还没有已入正史的章节。</p>}
        </aside>
        <div className="book-body">
          {accepted.map((chapter) => (
            <article key={chapter.id} id={`book-ch-${chapter.position}`}>
              <header>
                <h2>{chapter.title}</h2>
                <button
                  className="secondary"
                  onClick={() => {
                    setMarkingId(
                      markingId === chapter.id ? null : chapter.id,
                    );
                    setMarkText("");
                  }}
                  title="把阅读中发现的问题记入全局审查台账"
                >
                  <Flag size={14} /> 标记疑点
                </button>
              </header>
              {markingId === chapter.id && (
                <div className="mark-form">
                  <textarea
                    value={markText}
                    onChange={(event) => setMarkText(event.target.value)}
                    placeholder="例如：这里主角的年龄和第 1 章对不上"
                    rows={3}
                  />
                  <div>
                    <button
                      className="primary"
                      disabled={markBusy || !markText.trim()}
                      onClick={() => void mark(chapter.position)}
                    >
                      {markBusy ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <BookOpen size={14} />
                      )}
                      记入审查台账
                    </button>
                    <button
                      className="secondary"
                      onClick={() => setMarkingId(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
              {chapter.content.split(/\n+/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </article>
          ))}
          {accepted.length === 0 && (
            <div className="empty-inline">
              先到生成工作台接受候选稿，再来这里连读。
            </div>
          )}
        </div>
      </div>
      {markDone && <div className="mark-done">{markDone}</div>}
    </main>
  );
}

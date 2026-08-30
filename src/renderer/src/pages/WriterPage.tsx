import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  History,
  Save,
  Sparkles,
} from "lucide-react";
import { Navigate, NavLink, useNavigate, useParams } from "react-router-dom";
import type { Chapter } from "@domain/novel";
import { useNovelStore } from "@renderer/store/novel-store";

type SaveState = "idle" | "saving" | "saved" | "error";
const EMPTY_CHAPTERS: never[] = [];
const EMPTY_VERSIONS: never[] = [];

export function WriterPage(): React.JSX.Element {
  const { novelId = "", chapterId = "" } = useParams();
  const navigate = useNavigate();
  const novel = useNovelStore((s) =>
    s.novels.find((item) => item.id === novelId),
  );
  const chapters = useNovelStore((s) => s.chapters[novelId] ?? EMPTY_CHAPTERS);
  const versions = useNovelStore(
    (s) => s.versions[chapterId] ?? EMPTY_VERSIONS,
  );
  const loadChapters = useNovelStore((s) => s.loadChapters);
  const getChapter = useNovelStore((s) => s.getChapter);
  const saveChapter = useNovelStore((s) => s.saveChapter);
  const loadVersions = useNovelStore((s) => s.loadVersions);
  const createSnapshot = useNovelStore((s) => s.createSnapshot);
  const [draft, setDraft] = useState<Chapter | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const loadedId = useRef("");
  useEffect(() => {
    void loadChapters(novelId);
  }, [loadChapters, novelId]);
  useEffect(() => {
    if (!chapterId) return;
    void getChapter(chapterId).then((chapter) => {
      setDraft(chapter);
      loadedId.current = chapterId;
    });
    void loadVersions(chapterId);
  }, [chapterId, getChapter, loadVersions]);
  useEffect(() => {
    if (!draft || loadedId.current !== draft.id) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      void saveChapter({
        chapterId: draft.id,
        title: draft.title,
        outline: draft.outline,
        content: draft.content,
      })
        .then((saved) => {
          setDraft(saved);
          setSaveState("saved");
        })
        .catch(() => setSaveState("error"));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [draft?.title, draft?.outline, draft?.content]);
  const index = chapters.findIndex((item) => item.id === chapterId);
  const previous = chapters[index - 1];
  const next = chapters[index + 1];
  const paragraphs = useMemo(
    () => draft?.content.split(/\n+/).filter(Boolean).length ?? 0,
    [draft?.content],
  );
  if (!novel) return <Navigate to="/novels" replace />;
  if (!chapterId && chapters[0])
    return (
      <Navigate to={`/novels/${novelId}/write/${chapters[0].id}`} replace />
    );
  if (!draft) return <main className="writer-loading">正在打开章节…</main>;
  async function snapshot() {
    const current = draft;
    if (!current) return;
    setSaveState("saving");
    const saved = await saveChapter({
      chapterId: current.id,
      title: current.title,
      outline: current.outline,
      content: current.content,
    });
    setDraft(saved);
    await createSnapshot(current.id);
    setSaveState("saved");
  }
  return (
    <main className="writer-shell">
      <header className="writer-top">
        <NavLink to={`/novels/${novelId}/plan`}>
          <ChevronLeft size={17} />
          返回规划
        </NavLink>
        <div>
          <b>{novel.title}</b>
          <span>
            {saveState === "saving" ? (
              "正在保存…"
            ) : saveState === "error" ? (
              "保存失败"
            ) : (
              <>
                <Check size={13} />
                已保存到本地
              </>
            )}
          </span>
        </div>
        <button className="snapshot-button" onClick={snapshot}>
          <Save size={16} />
          保存版本
        </button>
      </header>
      <div className="writer-grid">
        <aside className="writer-chapters">
          <div>
            <b>章节</b>
            <span>{chapters.length}</span>
          </div>
          {chapters.map((chapter) => (
            <NavLink
              key={chapter.id}
              to={`/novels/${novelId}/write/${chapter.id}`}
              className={chapter.id === draft.id ? "selected" : ""}
            >
              <i>{chapter.position}</i>
              <span>
                <b>{chapter.title}</b>
                <small>
                  {chapter.wordCount} 字 · {chapter.status}
                </small>
              </span>
            </NavLink>
          ))}
        </aside>
        <section className="editor-area">
          <div className="chapter-fields">
            <input
              className="chapter-title"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
            <textarea
              className="chapter-outline"
              rows={2}
              value={draft.outline}
              onChange={(e) => setDraft({ ...draft, outline: e.target.value })}
              placeholder="本章大纲：冲突、转折、场景目标…"
            />
          </div>
          <textarea
            className="prose-editor"
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            placeholder="从这里开始写作。也可以稍后让 Amy 根据本章大纲生成候选稿…"
          />
          <footer className="editor-status">
            <span>
              {draft.wordCount.toLocaleString()} /{" "}
              {draft.targetWords.toLocaleString()} 字
            </span>
            <span>{paragraphs} 段</span>
            <div>
              {previous && (
                <button
                  onClick={() =>
                    navigate(`/novels/${novelId}/write/${previous.id}`)
                  }
                >
                  <ChevronLeft size={14} />
                  上一章
                </button>
              )}
              {next && (
                <button
                  onClick={() =>
                    navigate(`/novels/${novelId}/write/${next.id}`)
                  }
                >
                  下一章
                  <ChevronRight size={14} />
                </button>
              )}
            </div>
          </footer>
        </section>
        <aside className="writer-ai">
          <div className="amy-avatar">
            <Sparkles />
          </div>
          <h3>Amy 助手</h3>
          <p>
            当前读取：本章大纲、正文和项目核心设定。故事圣经接入后会自动扩充
            Context Pack。
          </p>
          <div className="quick-actions">
            <button
              onClick={() =>
                navigate(`/novels/${novelId}/generate-chapter/${chapterId}`)
              }
            >
              <Bot size={16} />
              根据大纲生成本章
            </button>
            <button>续写选中文本</button>
            <button>润色与去 AI 味</button>
            <button>连续性检查</button>
          </div>
          <div className="version-panel">
            <b>
              <History size={15} />
              章节版本
            </b>
            {versions.length ? (
              versions.map((version) => (
                <div key={version.id}>
                  <span>
                    版本 {version.versionNo} · {version.origin}
                  </span>
                  <small>
                    <Clock3 size={12} />
                    {new Date(version.createdAt).toLocaleString()} ·{" "}
                    {version.wordCount} 字
                  </small>
                </div>
              ))
            ) : (
              <p>还没有手动版本。自动保存不会覆盖已创建的版本。</p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

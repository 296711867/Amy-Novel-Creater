import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Archive,
  BookOpen,
  Bot,
  ChartNoAxesColumnIncreasing,
  ChevronRight,
  Feather,
  Home,
  Library,
  Pause,
  Play,
  Plus,
  Settings,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import {
  NavLink,
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  estimateGeneration,
  validateChapterRange,
  type GenerationPolicy,
} from "@domain/generation";
import { useNovelStore } from "./store/novel-store";
import { WriterPage } from "./pages/WriterPage";
import { BiblePage } from "./pages/BiblePage";
import { ContinuityPage } from "./pages/ContinuityPage";
import { StructurePage } from "./pages/StructurePage";
import { ContextPage } from "./pages/ContextPage";
import { UsagePage } from "./pages/UsagePage";
import { SettingsPage } from "./pages/SettingsPage";
import { ChapterGeneratePage } from "./pages/ChapterGeneratePage";
import { BatchesPage } from "./pages/BatchesPage";
import { DataPage } from "./pages/DataPage";

const genres = ["玄幻", "都市", "科幻", "悬疑", "言情", "历史", "奇幻", "其他"];

function Sidebar(): React.JSX.Element {
  const links = [
    ["/", Home, "首页"],
    ["/novels", Library, "我的作品"],
    ["/batches", Bot, "生成任务"],
    ["/templates", WandSparkles, "模板"],
    ["/usage", ChartNoAxesColumnIncreasing, "用量"],
    ["/data", Archive, "导出备份"],
    ["/settings", Settings, "设置"],
  ] as const;
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Feather size={27} />
        </div>
        <div>
          <strong>Amy-Novel</strong>
          <span>AI 长篇小说工作台</span>
        </div>
      </div>
      <nav>
        {links.map(([to, Icon, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <Icon size={19} />
            {label}
          </NavLink>
        ))}
      </nav>
      <NavLink className="new-novel" to="/novels/new">
        <Plus size={18} /> 新建小说
      </NavLink>
    </aside>
  );
}

function HomePage(): React.JSX.Element {
  const novels = useNovelStore((s) => s.novels);
  return (
    <main className="page home-page">
      <div className="eyebrow">
        <Sparkles size={15} /> WRITE A WORLD THAT REMEMBERS
      </div>
      <h1>开始创作你的长篇故事</h1>
      <p className="lead">
        从一个设定出发，规划章节、控制批次，让 Amy 按章生成并记住故事正史。
      </p>
      <section className="action-grid">
        <NavLink to="/novels/new" className="action-card sand">
          <span className="icon-box">
            <BookOpen />
          </span>
          <b>快速创建</b>
          <p>填写题材、核心设定与篇幅，先建立完整章节目录。</p>
          <em>
            创建小说 <ChevronRight size={16} />
          </em>
        </NavLink>
        <NavLink to="/novels/new" className="action-card rose">
          <span className="icon-box">
            <Bot />
          </span>
          <b>对话创作</b>
          <p>和 Amy 梳理世界观、人物与主线，再转成可执行规划。</p>
          <em>
            开始构思 <ChevronRight size={16} />
          </em>
        </NavLink>
        <div className="action-card orange">
          <span className="icon-box">
            <WandSparkles />
          </span>
          <b>导入续写</b>
          <p>导入已有正文，识别章节并重建故事圣经。</p>
          <em>下一阶段开放</em>
        </div>
      </section>
      <div className="section-title">
        <h2>最近作品</h2>
        <NavLink to="/novels">查看全部</NavLink>
      </div>
      {novels.length ? (
        <NovelGrid novels={novels.slice(0, 3)} />
      ) : (
        <div className="empty-inline">
          还没有作品。先创建一本小说，Amy 会自动准备章节目录。
        </div>
      )}
    </main>
  );
}

function NovelGrid({
  novels,
}: {
  novels: ReturnType<typeof useNovelStore.getState>["novels"];
}): React.JSX.Element {
  return (
    <div className="novel-grid">
      {novels.map((novel) => (
        <NavLink
          key={novel.id}
          className="novel-card"
          to={`/novels/${novel.id}/plan`}
        >
          <div className="cover">
            <Feather />
            <span>{novel.genre}</span>
          </div>
          <div>
            <h3>{novel.title}</h3>
            <p>{novel.premise || "尚未填写故事简介"}</p>
            <small>
              {novel.targetChapters} 章 · 预计{" "}
              {novel.targetWords.toLocaleString()} 字
            </small>
          </div>
        </NavLink>
      ))}
    </div>
  );
}

function NovelsPage(): React.JSX.Element {
  const novels = useNovelStore((s) => s.novels);
  return (
    <main className="page">
      <div className="page-heading">
        <div>
          <span className="kicker">YOUR STORIES</span>
          <h1>我的作品</h1>
          <p>每本小说都是独立的本地创作工程。</p>
        </div>
        <NavLink className="primary" to="/novels/new">
          <Plus size={17} />
          新建小说
        </NavLink>
      </div>
      {novels.length ? (
        <NovelGrid novels={novels} />
      ) : (
        <div className="empty-state">
          <BookOpen size={44} />
          <h2>书架还是空的</h2>
          <p>创建第一本小说，开始规划你的世界。</p>
          <NavLink className="primary" to="/novels/new">
            开始创建
          </NavLink>
        </div>
      )}
    </main>
  );
}

function NewNovelPage(): React.JSX.Element {
  const navigate = useNavigate();
  const createNovel = useNovelStore((s) => s.createNovel);
  const [form, setForm] = useState({
    title: "",
    genre: "玄幻",
    premise: "",
    targetChapters: 100,
    chapterWords: 3000,
  });
  const total = form.targetChapters * form.chapterWords;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) return;
    const novel = await createNovel(form);
    navigate(`/novels/${novel.id}/plan`);
  }
  return (
    <main className="page narrow">
      <div className="eyebrow">NEW STORY PROJECT</div>
      <h1>创建一个新的小说工程</h1>
      <p className="lead">
        先定义方向与体量，下一步再让 AI 生成故事圣经和章节目录。
      </p>
      <form className="form-card" onSubmit={submit}>
        <label>
          小说名称
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="例如：星海余烬"
            autoFocus
          />
        </label>
        <div className="form-row">
          <label>
            题材
            <select
              value={form.genre}
              onChange={(e) => setForm({ ...form, genre: e.target.value })}
            >
              {genres.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label>
            预计章节
            <input
              type="number"
              min="1"
              max="2000"
              value={form.targetChapters}
              onChange={(e) =>
                setForm({ ...form, targetChapters: Number(e.target.value) })
              }
            />
          </label>
          <label>
            单章目标字数
            <input
              type="number"
              min="500"
              max="20000"
              step="100"
              value={form.chapterWords}
              onChange={(e) =>
                setForm({ ...form, chapterWords: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <label>
          核心设定
          <textarea
            rows={7}
            value={form.premise}
            onChange={(e) => setForm({ ...form, premise: e.target.value })}
            placeholder="主角是谁？他想要什么？世界有什么独特规则？主要矛盾是什么？"
          />
        </label>
        <div className="form-footer">
          <span>
            预计总字数 <strong>{total.toLocaleString()}</strong>
          </span>
          <button className="primary" type="submit">
            <Sparkles size={17} />
            创建并规划
          </button>
        </div>
      </form>
    </main>
  );
}

function NovelPlanPage(): React.JSX.Element {
  const { novelId = "" } = useParams();
  const novels = useNovelStore((s) => s.novels);
  const chaptersByNovel = useNovelStore((s) => s.chapters);
  const loadChapters = useNovelStore((s) => s.loadChapters);
  const novel = novels.find((n) => n.id === novelId);
  const chapters = chaptersByNovel[novelId] ?? [];
  useEffect(() => {
    void loadChapters(novelId);
  }, [loadChapters, novelId]);
  if (!novel) return <Navigate to="/novels" replace />;
  return (
    <main className="workspace">
      <header className="workspace-head">
        <div>
          <span>{novel.genre} · 规划中</span>
          <h1>{novel.title}</h1>
        </div>
        <div className="head-actions">
          <NavLink className="secondary" to={`/novels/${novelId}/continuity`}>
            <BookOpen size={16} />
            正史台账
          </NavLink>
          {chapters[0] && (
            <NavLink
              className="secondary"
              to={`/novels/${novelId}/write/${chapters[0].id}`}
            >
              <Feather size={16} />
              开始写作
            </NavLink>
          )}
          <NavLink className="primary" to={`/novels/${novelId}/generate`}>
            <Play size={16} />
            批量生成
          </NavLink>
        </div>
      </header>
      <div className="workspace-grid">
        <aside className="chapter-tree">
          <div className="tree-head">
            <b>章节目录</b>
            <span>{chapters.length} 章</span>
          </div>
          {chapters.slice(0, 40).map((ch) => (
            <NavLink key={ch.id} to={`/novels/${novelId}/write/${ch.id}`}>
              <span>{ch.position}</span>
              <div>
                <b>{ch.title}</b>
                <small>{ch.outline || "等待生成章纲"}</small>
              </div>
            </NavLink>
          ))}
          {chapters.length > 40 && (
            <p className="more">还有 {chapters.length - 40} 章</p>
          )}
        </aside>
        <section className="planning-canvas">
          <span className="kicker">STORY BLUEPRINT</span>
          <h2>让大故事先有骨架</h2>
          <p>{novel.premise || "还没有核心设定，可以先补充创作意图。"}</p>
          <div className="blueprint-grid">
            <article>
              <b>故事圣经</b>
              <span>世界规则、角色、地点与创作边界</span>
              <NavLink to={`/novels/${novelId}/bible`}>打开故事圣经</NavLink>
            </article>
            <article>
              <b>分卷规划</b>
              <span>把 {novel.targetChapters} 章拆成阶段目标和转折</span>
              <NavLink to={`/novels/${novelId}/structure`}>
                编辑卷章场景
              </NavLink>
            </article>
            <article>
              <b>章节目录</b>
              <span>已创建 {chapters.length} 个章节槽位，可增删和排序</span>
              <NavLink to={`/novels/${novelId}/structure`}>
                管理章节目录
              </NavLink>
            </article>
            <article>
              <b>批量正文</b>
              <span>指定范围，按章生成，可暂停续跑</span>
              <NavLink to={`/novels/${novelId}/generate`}>配置任务</NavLink>
            </article>
          </div>
        </section>
        <aside className="amy-panel">
          <div className="amy-avatar">
            <Sparkles />
          </div>
          <h3>Amy 创作助手</h3>
          <p>我会使用故事圣经、当前大纲、最近章节和正史事实来准备每一章。</p>
          <div className="context-box">
            <b>当前上下文</b>
            <span>核心设定</span>
            <span>{chapters.length} 个章节槽位</span>
            <span>目标 {novel.targetWords.toLocaleString()} 字</span>
          </div>
          <textarea rows={5} placeholder="告诉 Amy 你想调整的故事方向…" />
          <button className="primary">发送</button>
        </aside>
      </div>
    </main>
  );
}

function GeneratePage(): React.JSX.Element {
  const { novelId = "" } = useParams();
  const navigate = useNavigate();
  const novel = useNovelStore((s) => s.novels.find((n) => n.id === novelId));
  const createDraft = useNovelStore((s) => s.createGenerationDraft);
  const [policy, setPolicy] = useState<GenerationPolicy>({
    startChapter: 1,
    endChapter: Math.min(10, novel?.targetChapters ?? 10),
    chapterWords: novel?.chapterWords ?? 3000,
    continuityCheck: true,
    maxRetries: 2,
    approvalMode: "candidate",
    outputTokenBudget: 120000,
    concurrency: 1,
  });
  const estimate = useMemo(() => estimateGeneration(policy), [policy]);
  if (!novel) return <Navigate to="/novels" replace />;
  const error = validateChapterRange(policy, novel.targetChapters);
  async function start() {
    if (error) return;
    const result = await createDraft(novelId, policy);
    navigate(`/batches?created=${result.id}`);
  }
  return (
    <main className="page narrow">
      <div className="eyebrow">
        <Bot size={15} /> BATCH GENERATION
      </div>
      <h1>配置批量生成任务</h1>
      <p className="lead">
        任务将逐章执行。可以暂停、恢复或重试，不会因一次 Token
        不足丢失整批结果。
      </p>
      <section className="form-card">
        <div className="form-row">
          <label>
            起始章节
            <input
              type="number"
              value={policy.startChapter}
              onChange={(e) =>
                setPolicy({ ...policy, startChapter: Number(e.target.value) })
              }
            />
          </label>
          <label>
            结束章节
            <input
              type="number"
              value={policy.endChapter}
              onChange={(e) =>
                setPolicy({ ...policy, endChapter: Number(e.target.value) })
              }
            />
          </label>
          <label>
            单章目标字数
            <input
              type="number"
              value={policy.chapterWords}
              onChange={(e) =>
                setPolicy({ ...policy, chapterWords: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <div className="switch-row">
          <div>
            <b>连续性检查</b>
            <span>每章生成后检查人物、时间线、设定与伏笔冲突</span>
          </div>
          <button
            className={policy.continuityCheck ? "switch on" : "switch"}
            onClick={() =>
              setPolicy({ ...policy, continuityCheck: !policy.continuityCheck })
            }
          >
            <i />
          </button>
        </div>
        <label>
          单批最大输出 Token
          <input
            type="number"
            step="10000"
            value={policy.outputTokenBudget}
            onChange={(e) =>
              setPolicy({
                ...policy,
                outputTokenBudget: Number(e.target.value),
              })
            }
          />
          <small>达到预算时安全暂停，修改模型或预算后可以继续。</small>
        </label>
        <div className="form-row">
          <label>
            并发章节数
            <input
              type="number"
              min={1}
              max={3}
              value={policy.concurrency ?? 1}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  concurrency: Math.min(
                    3,
                    Math.max(1, Number(e.target.value) || 1),
                  ),
                })
              }
            />
            <small>1–3 章并行生成（候选稿模式安全）。</small>
          </label>
          <label>
            审稿模式
            <select
              value={policy.approvalMode}
              onChange={(e) =>
                setPolicy({
                  ...policy,
                  approvalMode: e.target
                    .value as GenerationPolicy["approvalMode"],
                })
              }
            >
              <option value="candidate">仅候选稿</option>
              <option value="chapter_review">候选稿 + AI 审查</option>
            </select>
            <small>AI 审查会额外调用一次模型检查一致性问题。</small>
          </label>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="estimate">
          <div>
            <span>章节数</span>
            <b>{estimate.chapterCount}</b>
          </div>
          <div>
            <span>目标正文</span>
            <b>{estimate.targetWords.toLocaleString()} 字</b>
          </div>
          <div>
            <span>预计输出</span>
            <b>≈ {estimate.estimatedOutputTokens.toLocaleString()} tokens</b>
          </div>
          <div>
            <span>上下文调用</span>
            <b>≈ {estimate.estimatedContextTokens.toLocaleString()} tokens</b>
          </div>
        </div>
        <div className="form-footer">
          <NavLink className="secondary" to={`/novels/${novelId}/context`}>
            <BookOpen size={16} />
            预览 Context Pack
          </NavLink>
          <button className="primary" disabled={Boolean(error)} onClick={start}>
            <Play size={17} />
            创建生成任务
          </button>
        </div>
      </section>
    </main>
  );
}

function Placeholder({
  title,
  description,
}: {
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <main className="page">
      <div className="empty-state">
        <Pause size={42} />
        <h1>{title}</h1>
        <p>{description}</p>
        <span className="status-pill">架构已预留 · 后续阶段接入</span>
      </div>
    </main>
  );
}

function FirstRunGuide(): React.JSX.Element | null {
  const [open, setOpen] = useState(
    () => localStorage.getItem("amy-novel:onboarding") !== "done",
  );
  if (!open) return null;
  function close() {
    localStorage.setItem("amy-novel:onboarding", "done");
    setOpen(false);
  }
  return (
    <div className="onboarding-backdrop">
      <section className="onboarding-card">
        <div className="amy-avatar">
          <Sparkles />
        </div>
        <span className="kicker">WELCOME TO AMY NOVEL</span>
        <h1>从设定到几十万字，按章稳稳推进</h1>
        <p>
          先创建作品和故事圣经，再到设置中连接模型。批量生成永远先进入候选稿，不会直接覆盖正文。
        </p>
        <ol>
          <li>
            <b>建立作品</b>
            <span>填写题材、核心设定、章节数和单章字数。</span>
          </li>
          <li>
            <b>配置模型</b>
            <span>支持 OpenAI 兼容接口，密钥不会进入项目备份。</span>
          </li>
          <li>
            <b>分批生成</b>
            <span>指定章节范围，随时暂停、恢复和审阅事实建议。</span>
          </li>
        </ol>
        <button className="primary" onClick={close}>
          开始创作
        </button>
      </section>
    </div>
  );
}

export default function App(): React.JSX.Element {
  const load = useNovelStore((s) => s.loadNovels),
    initialized = useNovelStore((s) => s.initialized);
  useEffect(() => {
    void load();
  }, [load]);
  if (!initialized)
    return (
      <div className="app-loading">
        <Feather size={34} />
        <span>正在打开 Amy Novel…</span>
      </div>
    );
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/novels" element={<NovelsPage />} />
          <Route path="/novels/new" element={<NewNovelPage />} />
          <Route path="/novels/:novelId/plan" element={<NovelPlanPage />} />
          <Route
            path="/novels/:novelId/write/:chapterId?"
            element={<WriterPage />}
          />
          <Route path="/novels/:novelId/bible" element={<BiblePage />} />
          <Route
            path="/novels/:novelId/continuity"
            element={<ContinuityPage />}
          />
          <Route
            path="/novels/:novelId/structure"
            element={<StructurePage />}
          />
          <Route path="/novels/:novelId/context" element={<ContextPage />} />
          <Route
            path="/novels/:novelId/generate-chapter/:chapterId"
            element={<ChapterGeneratePage />}
          />
          <Route path="/novels/:novelId/generate" element={<GeneratePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/batches" element={<BatchesPage />} />
          <Route path="/data" element={<DataPage />} />
          <Route
            path="/templates"
            element={
              <Placeholder
                title="创作模板"
                description="题材、故事结构与 Prompt/Skill 模板将在后续阶段加入。"
              />
            }
          />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <FirstRunGuide />
    </div>
  );
}

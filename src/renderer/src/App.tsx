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
  Trash2,
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
import { CYCLE_SIZE_MAX, CYCLE_SIZE_MIN } from "@domain/novel";
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
import { PlanningWorkflowPage } from "./pages/PlanningWorkflowPage";
import "./novel-actions.css";

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
  onDelete,
}: {
  novels: ReturnType<typeof useNovelStore.getState>["novels"];
  onDelete?: (
    novel: ReturnType<typeof useNovelStore.getState>["novels"][number],
  ) => void;
}): React.JSX.Element {
  return (
    <div className="novel-grid">
      {novels.map((novel) => (
        <article key={novel.id} className="novel-card">
          <NavLink
            className="novel-card-link"
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
          {onDelete && (
            <button
              className="novel-delete"
              aria-label={`删除《${novel.title}》`}
              title="永久删除作品"
              onClick={() => onDelete(novel)}
            >
              <Trash2 size={15} />
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

function NovelsPage(): React.JSX.Element {
  const novels = useNovelStore((s) => s.novels),
    deleteNovel = useNovelStore((s) => s.deleteNovel);
  const [error, setError] = useState("");
  async function remove(novel: (typeof novels)[number]) {
    if (
      !window.confirm(
        `确定永久删除《${novel.title}》吗？\n\n章节、版本、候选稿、正史和生成记录都会删除，且无法恢复。`,
      )
    )
      return;
    setError("");
    try {
      await deleteNovel(novel.id);
    } catch (value) {
      setError(value instanceof Error ? value.message : "删除失败");
    }
  }
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
      {error && <div className="error">{error}</div>}
      {novels.length ? (
        <NovelGrid novels={novels} onDelete={(novel) => void remove(novel)} />
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
  const suggestScope = useNovelStore((s) => s.suggestScope);
  const clearScopeAdvice = useNovelStore((s) => s.clearScopeAdvice);
  const scopeAdvice = useNovelStore((s) => s.scopeAdvice);
  const scopeAdviceBusy = useNovelStore((s) => s.scopeAdviceBusy);
  const scopeAdviceError = useNovelStore((s) => s.scopeAdviceError);
  const [form, setForm] = useState({
    title: "",
    genre: "玄幻",
    premise: "",
    targetChapters: 100,
    chapterWords: 3000,
    cycleSize: 10,
  });
  const [advisorNotes, setAdvisorNotes] = useState("");
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const total = form.targetChapters * form.chapterWords;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) return;
    const novel = await createNovel(form);
    clearScopeAdvice();
    navigate(`/novels/${novel.id}/plan`);
  }
  async function askAmy() {
    await suggestScope({
      title: form.title,
      genre: form.genre,
      premise: form.premise,
      notes: advisorNotes,
    });
  }
  function applyAdvice() {
    if (!scopeAdvice) return;
    const r = scopeAdvice.recommendation;
    setForm((current) => ({
      ...current,
      targetChapters: r.totalChapters,
      chapterWords: r.chapterWords,
    }));
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
          <label>
            每批规划章数
            <input
              type="number"
              min={CYCLE_SIZE_MIN}
              max={CYCLE_SIZE_MAX}
              step="1"
              value={form.cycleSize}
              onChange={(e) =>
                setForm({ ...form, cycleSize: Number(e.target.value) })
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
        <section className="scope-advisor">
          <button
            type="button"
            className="scope-toggle"
            onClick={() => setAdvisorOpen((value) => !value)}
          >
            <Sparkles size={15} />
            {advisorOpen ? "收起篇幅顾问" : "不知道写多少章？让 Amy 按番茄平台规则建议篇幅与节奏"}
          </button>
          {advisorOpen && (
            <>
              <p className="scope-hint">
                平台规则（单章 2000–3000 字、黄金三章、30 章追读考核）已内置，Amy
                只按你的想法给出总章数、单章字数、分卷骨架与里程碑建议；应用前不会改动任何表单。
              </p>
              <label>
                补充想法（可选）
                <textarea
                  rows={2}
                  value={advisorNotes}
                  onChange={(e) => setAdvisorNotes(e.target.value)}
                  placeholder="例如：每天能写 2 小时，想日更一章，先写个 20 万字试试"
                />
              </label>
              <button
                type="button"
                className="secondary"
                disabled={scopeAdviceBusy || form.premise.trim().length < 10}
                title={
                  form.premise.trim().length < 10
                    ? "先填写核心设定（至少 10 字），Amy 才能给出针对性建议"
                    : undefined
                }
                onClick={() => void askAmy()}
              >
                {scopeAdviceBusy ? "Amy 正在分析…" : "生成篇幅建议"}
              </button>
              {scopeAdviceError && (
                <div className="error">{scopeAdviceError}</div>
              )}
              {scopeAdvice && (
                <div className="scope-result">
                  <header>
                    <b>
                      {scopeAdvice.recommendation.tierLabel} · 约{" "}
                      {scopeAdvice.recommendation.totalChapters} 章 ×{" "}
                      {scopeAdvice.recommendation.chapterWords} 字
                    </b>
                    <span>
                      日更 {scopeAdvice.recommendation.dailyChapters} 章 · 约{" "}
                      {scopeAdvice.recommendation.estimatedDays} 天完本
                    </span>
                    <button
                      type="button"
                      className="primary"
                      onClick={applyAdvice}
                    >
                      应用到表单
                    </button>
                  </header>
                  <p>{scopeAdvice.recommendation.reason}</p>
                  <div className="scope-grid">
                    <section>
                      <h4>分卷骨架</h4>
                      <ul>
                        {scopeAdvice.volumeSkeleton.map((volume) => (
                          <li key={volume.title}>
                            <b>
                              {volume.title}（第 {volume.startChapter}–
                              {volume.endChapter} 章）
                            </b>
                            <span>{volume.goal}</span>
                            <small>高潮：{volume.climax}</small>
                          </li>
                        ))}
                      </ul>
                    </section>
                    <section>
                      <h4>关键里程碑</h4>
                      <ul>
                        {scopeAdvice.milestones.map((milestone) => (
                          <li key={milestone.position}>
                            <b>第 {milestone.position} 章 · {milestone.label}</b>
                            <span>{milestone.goal}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </div>
                  {scopeAdvice.notes.length > 0 && (
                    <ul className="scope-notes">
                      {scopeAdvice.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </section>
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

function GeneratePage(): React.JSX.Element {
  const { novelId = "" } = useParams();
  const navigate = useNavigate();
  const novel = useNovelStore((s) => s.novels.find((n) => n.id === novelId));
  const createDraft = useNovelStore((s) => s.createGenerationDraft);
  const workflow = useNovelStore((s) => s.planningWorkflows[novelId]);
  const loadPlanningWorkflow = useNovelStore((s) => s.loadPlanningWorkflow);
  const cycles = useNovelStore((s) => s.planningCycles[novelId] ?? []);
  const loadPlanningCycles = useNovelStore((s) => s.loadPlanningCycles);
  const [submitError, setSubmitError] = useState("");
  const [policy, setPolicy] = useState<GenerationPolicy>({
    startChapter: 1,
    endChapter: Math.min(10, novel?.targetChapters ?? 10),
    chapterWords: novel?.chapterWords ?? 3000,
    continuityCheck: true,
    maxRetries: 2,
    approvalMode: "candidate",
    outputTokenBudget: 120000,
    concurrency: 1,
    deepThinking: false,
  });
  const estimate = useMemo(() => estimateGeneration(policy), [policy]);
  useEffect(() => {
    if (novelId)
      void Promise.all([
        loadPlanningWorkflow(novelId),
        loadPlanningCycles(novelId),
      ]);
  }, [loadPlanningCycles, loadPlanningWorkflow, novelId]);
  const readyCycle = cycles.find((item) =>
    ["ready", "generating"].includes(item.status),
  );
  useEffect(() => {
    if (!readyCycle) return;
    setPolicy((current) => ({
      ...current,
      startChapter: readyCycle.startChapter,
      endChapter: readyCycle.endChapter,
    }));
  }, [readyCycle?.id]);
  if (!novel) return <Navigate to="/novels" replace />;
  const error = !workflow?.confirmedSteps.includes(9)
    ? "请先完成小说框架向导和一致性检查"
    : !readyCycle ||
        readyCycle.startChapter !== policy.startChapter ||
        readyCycle.endChapter !== policy.endChapter
      ? "生成范围必须与已通过审核的当前批次策划包一致"
    : validateChapterRange(policy, novel.targetChapters);
  async function start() {
    if (error) return;
    setSubmitError("");
    try {
      const result = await createDraft(novelId, policy);
      navigate(`/batches?created=${result.id}`);
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : "任务创建失败");
    }
  }
  return (
    <main className="page narrow">
      <div className="eyebrow">
        <Bot size={15} /> BATCH GENERATION
      </div>
      <h1>配置批量生成任务</h1>
      <p className="lead">
        任务按章节顺序串行执行，后章会读取本批次前章候选稿。支持暂停、恢复、限流退避
        与硬 Token 预算，不会因一次失败丢失整批结果。
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
        <div className="switch-row">
          <div>
            <b>深度思考写作</b>
            <span>
              GLM 等混合推理模型先思考再写正文，质量更好但更慢更费 token；关闭时
              max_tokens 全部留给正文
            </span>
          </div>
          <button
            className={policy.deepThinking ? "switch on" : "switch"}
            onClick={() =>
              setPolicy({ ...policy, deepThinking: !policy.deepThinking })
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
        {(error || submitError) && (
          <div className="error">{submitError || error}</div>
        )}
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
          <Route
            path="/novels/:novelId/plan"
            element={<PlanningWorkflowPage />}
          />
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

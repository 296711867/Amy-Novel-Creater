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
import type { ScopeAdvice } from "@domain/scope-advisor";
import { useNovelStore } from "./store/novel-store";
import { WriterPage } from "./pages/WriterPage";
import { BiblePage } from "./pages/BiblePage";
import { ContinuityPage } from "./pages/ContinuityPage";
import { BookReaderPage } from "./pages/BookReaderPage";
import { StructurePage } from "./pages/StructurePage";
import { ContextPage } from "./pages/ContextPage";
import { UsagePage } from "./pages/UsagePage";
import { SettingsPage } from "./pages/SettingsPage";
import { ChapterGeneratePage } from "./pages/ChapterGeneratePage";
import { BatchesPage } from "./pages/BatchesPage";
import { DataPage } from "./pages/DataPage";
import { PlanningWorkflowPage } from "./pages/PlanningWorkflowPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import "./novel-actions.css";
import "./new-novel.css";

const genres = ["玄幻", "都市", "科幻", "悬疑", "言情", "历史", "奇幻", "其他"];

/** selector 兜底必须用稳定引用：每次返回新数组会触发 useSyncExternalStore 无限重渲染。 */
const EMPTY_LIST: never[] = [];

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
  const [scopeAdvice, setScopeAdvice] = useState<ScopeAdvice | null>(null);
  const [scopeAdviceBusy, setScopeAdviceBusy] = useState(false);
  const [scopeAdviceError, setScopeAdviceError] = useState("");
  const [scopeStartedAt, setScopeStartedAt] = useState<number | null>(null);
  const [scopeElapsed, setScopeElapsed] = useState(0);
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
  const [appliedNotice, setAppliedNotice] = useState("");
  const [creating, setCreating] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const total = form.targetChapters * form.chapterWords;
  useEffect(() => {
    if (!scopeStartedAt) return;
    const update = () => setScopeElapsed(Math.floor((Date.now() - scopeStartedAt) / 1000));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [scopeStartedAt]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) {
      setSubmitError("请先填写小说名称");
      const input = document.getElementById("new-novel-title");
      input?.scrollIntoView({ behavior: "smooth", block: "center" });
      (input as HTMLInputElement | null)?.focus();
      return;
    }
    setCreating(true);
    setSubmitError("");
    try {
      const novel = await createNovel(form, scopeAdvice ?? undefined);
      navigate(`/novels/${novel.id}/plan`);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "创建小说失败");
      setCreating(false);
    }
  }
  async function askAmy() {
    setScopeAdviceBusy(true);
    setScopeAdviceError("");
    setScopeAdvice(null);
    setScopeStartedAt(Date.now());
    try {
      setScopeAdvice(
        await suggestScope({
          title: form.title,
          genre: form.genre,
          premise: form.premise,
          notes: advisorNotes,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const timedOut =
        (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) ||
        /timeout|timed out|aborted|超时/i.test(message);
      setScopeAdviceError(
        timedOut
          ? "生成超过 120 秒，已自动停止。请检查模型连接后重试。"
          : message
            ? message
            : "篇幅建议生成失败",
      );
    } finally {
      setScopeAdviceBusy(false);
      setScopeStartedAt(null);
    }
  }
  function applyAdvice() {
    if (!scopeAdvice) return;
    const r = scopeAdvice.recommendation;
    setForm((current) => ({
      ...current,
      targetChapters: r.totalChapters,
      chapterWords: r.chapterWords,
    }));
    setAppliedNotice(`已应用：${r.totalChapters} 章 × ${r.chapterWords} 字`);
    setAdvisorOpen(false);
    requestAnimationFrame(() =>
      document
        .getElementById("novel-scope-fields")
        ?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  }
  return (
    <main className="page narrow" aria-busy={scopeAdviceBusy}>
      <div className="eyebrow">NEW STORY PROJECT</div>
      <h1>创建一个新的小说工程</h1>
      <p className="lead">
        先定义方向与体量，下一步再让 AI 生成故事圣经和章节目录。
      </p>
      <form className="form-card" onSubmit={submit}>
        <label>
          小说名称
          <input
            id="new-novel-title"
            aria-invalid={Boolean(submitError && !form.title.trim())}
            value={form.title}
            onChange={(e) => {
              setForm({ ...form, title: e.target.value });
              setSubmitError("");
            }}
            placeholder="例如：星海余烬"
            autoFocus
          />
          {submitError && !form.title.trim() && (
            <small className="field-error" role="alert">
              {submitError}
            </small>
          )}
        </label>
        <div className="form-row" id="novel-scope-fields">
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
        {appliedNotice && (
          <div className="scope-applied" role="status">
            ✓ {appliedNotice}
          </div>
        )}
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
          <span className="create-actions">
            {submitError && form.title.trim() && (
              <span className="submit-error" role="alert">
                {submitError}
              </span>
            )}
            <button className="primary" type="submit" disabled={creating || scopeAdviceBusy}>
              <Sparkles size={17} />
              {creating ? "正在创建工程…" : "创建并规划"}
            </button>
          </span>
        </div>
      </form>
      {scopeAdviceBusy && (
        <div className="scope-busy-backdrop" role="dialog" aria-modal="true" aria-label="Amy 正在生成篇幅建议">
          <div className="scope-busy-card">
            <span className="scope-busy-spinner" aria-hidden="true" />
            <h2>Amy 正在制定篇幅策略</h2>
            <p>正在分析核心设定，估算篇幅与日更节奏，并整理分卷骨架和关键里程碑。</p>
            <strong>已用时 {scopeElapsed} 秒</strong>
            <small>本次请求最长等待 120 秒。完成前页面暂时锁定，请不要关闭应用。</small>
          </div>
        </div>
      )}
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
  const cycles = useNovelStore((s) => s.planningCycles[novelId] ?? EMPTY_LIST);
  const loadPlanningCycles = useNovelStore((s) => s.loadPlanningCycles);
  const styleTemplates = useNovelStore((s) => s.styleTemplates);
  const loadStyleTemplates = useNovelStore((s) => s.loadStyleTemplates);
  const modelProfiles = useNovelStore((s) => s.modelProfiles);
  const loadModelProfiles = useNovelStore((s) => s.loadModelProfiles);
  const setAutoReview = useNovelStore((s) => s.setAutoReview);
  const [submitError, setSubmitError] = useState("");
  const [autoCreate, setAutoCreate] = useState(false);
  const [policy, setPolicy] = useState<GenerationPolicy>({
    startChapter: 1,
    // 默认单章审批制：一次只写一章，改稿+正史确认后再创建下一章任务。
    endChapter: 1,
    chapterWords: novel?.chapterWords ?? 3000,
    continuityCheck: true,
    maxRetries: 2,
    approvalMode: "candidate",
    outputTokenBudget: 120000,
    concurrency: 1,
    deepThinking: false,
    approvalGate: true,
  });
  const estimate = useMemo(() => estimateGeneration(policy), [policy]);
  useEffect(() => {
    if (novelId)
      void Promise.all([
        loadPlanningWorkflow(novelId),
        loadPlanningCycles(novelId),
        loadStyleTemplates(),
        loadModelProfiles(),
      ]);
  }, [loadPlanningCycles, loadPlanningWorkflow, loadStyleTemplates, loadModelProfiles, novelId]);
  const pricedProfile =
    modelProfiles.find((item) => item.isDefault) ?? modelProfiles[0],
    estimatedCost =
      pricedProfile &&
      pricedProfile.inputPricePerMillion !== null &&
      pricedProfile.outputPricePerMillion !== null
        ? (estimate.estimatedContextTokens *
            pricedProfile.inputPricePerMillion +
            estimate.estimatedOutputTokens *
              pricedProfile.outputPricePerMillion) /
          1_000_000
        : null;
  const readyCycle = cycles.find((item) =>
    ["ready", "generating"].includes(item.status),
  );
  useEffect(() => {
    if (!readyCycle) return;
    setPolicy((current) => ({
      ...current,
      startChapter: readyCycle.startChapter,
      endChapter: Math.min(
        current.endChapter < readyCycle.startChapter
          ? readyCycle.startChapter
          : current.endChapter,
        readyCycle.endChapter,
      ),
    }));
  }, [readyCycle?.id]);
  if (!novel) return <Navigate to="/novels" replace />;
  const error = !workflow?.confirmedSteps.includes(9)
    ? "请先完成小说框架向导和一致性检查"
    : !readyCycle
      ? "当前没有已通过审核的批次策划包"
      : policy.startChapter < readyCycle.startChapter ||
          policy.endChapter > readyCycle.endChapter
        ? `生成范围需落在已审核的策划包（第 ${readyCycle.startChapter}–${readyCycle.endChapter} 章）内`
        : validateChapterRange(policy, novel.targetChapters);
  function pickChapterCount(count: number) {
    if (!readyCycle) return;
    setPolicy((current) => ({
      ...current,
      endChapter: Math.min(
        current.startChapter + count - 1,
        readyCycle.endChapter,
        novel!.targetChapters,
      ),
    }));
  }
  async function start() {
    if (error) return;
    setSubmitError("");
    try {
      const result = await createDraft(novelId, policy);
      if (autoCreate)
        setAutoReview(
          novelId,
          true,
          "全自动连续创作已开启：候选稿与正史建议将自动接受，连续创作至本批完成。",
        );
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
      <h1>配置生成任务</h1>
      <p className="lead">
        单章审批制：每章生成完即可浏览和修改，接受候选稿、处理完正史建议后，
        再继续生成下一章。默认一次只生成 1 章，不会自动连写。
      </p>
      <section className="form-card">
        <div className="switch-row">
          <div>
            <b>本次生成章数</b>
            <span>
              从第 {policy.startChapter} 章开始，本批完成后自动停止。章数越多消耗越大。
            </span>
          </div>
          <div className="chapter-count-picker">
            {[1, 3, 5, 10].map((count) => (
              <button
                key={count}
                className={policy.endChapter - policy.startChapter + 1 === count ? "on" : ""}
                onClick={() => pickChapterCount(count)}
              >
                {count} 章
              </button>
            ))}
            {readyCycle && (
              <button
                className={
                  policy.endChapter === readyCycle.endChapter &&
                  policy.endChapter - policy.startChapter + 1 > 10
                    ? "on"
                    : ""
                }
                onClick={() =>
                  setPolicy((current) => ({
                    ...current,
                    endChapter: readyCycle.endChapter,
                  }))
                }
              >
                整批（至第 {readyCycle.endChapter} 章）
              </button>
            )}
          </div>
        </div>
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
          文风模板
          <select
            value={policy.styleTemplateId ?? ""}
            onChange={(e) => setPolicy({ ...policy, styleTemplateId: e.target.value || undefined })}
          >
            <option value="">AI 根据作品设定自由发挥</option>
            {styleTemplates.map((item) => (
              <option key={item.id} value={item.id}>{item.name} · {item.authorAlias}</option>
            ))}
          </select>
          <small>仅注入提炼后的风格指令，不会把原样章放进小说上下文。</small>
        </label>
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
        <div className="switch-row">
          <div>
            <b>单章审批制</b>
            <span>
              开启时每章候选稿生成后暂停，等你在“生成任务”页改稿、接受候选稿并处理正史
              建议后，才继续下一章；关闭则本批连续生成（后章只能参考前章候选稿）
            </span>
          </div>
          <button
            className={policy.approvalGate !== false ? "switch on" : "switch"}
            onClick={() =>
              setPolicy({
                ...policy,
                approvalGate: policy.approvalGate === false,
              })
            }
          >
            <i />
          </button>
        </div>
        <div className="switch-row">
          <div>
            <b>全自动连续创作</b>
            <span>
              开启后任务启动时自动接受每章候选稿与全部正史建议，连续创作到本批最后一个章节；
              失败或达到 Token 预算会自动停下，随时可在“生成任务”页关闭
            </span>
          </div>
          <button
            className={autoCreate ? "switch on" : "switch"}
            onClick={() => setAutoCreate((value) => !value)}
          >
            <i />
          </button>
        </div>
        <label>
          单批最大输出 Token（停止边界）
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
          <small>
            达到预算立即安全暂停，不会生成到一半失控；修改预算后可继续。当前预计输出 ≈{" "}
            {estimate.estimatedOutputTokens.toLocaleString()} tokens。
          </small>
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
          <div>
            <span>预计费用</span>
            <b>
              {estimatedCost !== null
                ? `≈ ¥${estimatedCost.toFixed(2)}`
                : "未配置价格"}
            </b>
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
    initialized = useNovelStore((s) => s.initialized),
    ensureActivityListener = useNovelStore((s) => s.ensureActivityListener);
  useEffect(() => {
    // 生成/规划过程事件全程订阅：进任何页面都能收到实时推送。
    ensureActivityListener();
    void load();
  }, [load, ensureActivityListener]);
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
          <Route path="/novels/:novelId/book" element={<BookReaderPage />} />
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
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <FirstRunGuide />
    </div>
  );
}

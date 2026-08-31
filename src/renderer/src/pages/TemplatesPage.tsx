import { useEffect, useState, type FormEvent } from "react";
import {
  BookOpenText,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import type { StyleTemplate } from "@domain/style-template";
import { useNovelStore } from "../store/novel-store";
import "../templates.css";

export function TemplatesPage(): React.JSX.Element {
  const templates = useNovelStore((s) => s.styleTemplates),
    profiles = useNovelStore((s) => s.modelProfiles),
    store = useNovelStore();
  const [formOpen, setFormOpen] = useState(false),
    [profileId, setProfileId] = useState(""),
    [name, setName] = useState(""),
    [authorAlias, setAuthorAlias] = useState(""),
    [sourceTitle, setSourceTitle] = useState(""),
    [sampleText, setSampleText] = useState(""),
    [busy, setBusy] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");

  useEffect(() => {
    void store.loadStyleTemplates().then((items) => setFormOpen(!items.length));
    void store.loadModelProfiles();
  }, []);
  useEffect(() => {
    if (!profileId && profiles.length)
      setProfileId((profiles.find((item) => item.isDefault) ?? profiles[0]).id);
  }, [profileId, profiles]);
  useEffect(() => {
    if (!busy) {
      setElapsed(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [busy]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!profileId || sampleText.trim().length < 200) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const item = await store.analyzeStyleTemplate({
        profileId,
        name,
        authorAlias,
        sourceTitle,
        sampleText,
      });
      setMessage(`“${item.name}”已提炼并保存，可在章节与批量生成中使用。`);
      setName("");
      setAuthorAlias("");
      setSourceTitle("");
      setSampleText("");
      setFormOpen(false);
    } catch (value) {
      const detail = value instanceof Error ? value.message : "";
      setError(
        /timeout|timed out|aborted|超时/i.test(detail)
          ? "文风提炼超过 180 秒，已自动停止。请检查模型连接后重试。"
          : detail || "文风提炼失败",
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, templateName: string) {
    if (
      !window.confirm(
        `删除文风模板“${templateName}”？原样章和提炼结果都会删除。`,
      )
    )
      return;
    await store.deleteStyleTemplate(id);
  }

  return (
    <main className="page templates-page">
      <div className="page-heading">
        <div>
          <span className="kicker">STYLE LIBRARY</span>
          <h1>文风模板</h1>
          <p>粘贴喜欢的样章，让 AI 提炼可复用的语言节奏与叙事习惯。</p>
        </div>
        <button className="primary" onClick={() => setFormOpen(!formOpen)}>
          {formOpen ? <X size={16} /> : <Plus size={16} />}
          {formOpen ? "收起" : "提炼新文风"}
        </button>
      </div>
      {formOpen && (
        <form className="form-card style-import" onSubmit={submit}>
          <div className="card-head">
            <div>
              <h2>
                <WandSparkles size={18} /> 从样章提炼文风
              </h2>
              <p>名称和作者别名可留空，由 AI 自动起名；原文只在本地保存。</p>
            </div>
          </div>
          <div className="form-row">
            <label>
              风格名称（可选）
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：冷雾短句" />
            </label>
            <label>
              作者别名（可选）
              <input value={authorAlias} onChange={(e) => setAuthorAlias(e.target.value)} placeholder="例如：北港客" />
            </label>
            <label>
              来源标题（可选）
              <input value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)} placeholder="方便自己辨认" />
            </label>
          </div>
          <label>
            分析模型
            <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">请先配置模型</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name} · {profile.modelId}</option>
              ))}
            </select>
          </label>
          <label>
            样章正文
            <textarea rows={10} value={sampleText} onChange={(e) => setSampleText(e.target.value)} placeholder="粘贴一个完整章节。AI 会分别总结内容和抽象文风，不会把原章节情节带入新小说。" />
            <small>{sampleText.trim().length} 字符 · 至少 200 字</small>
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy || !profileId || sampleText.trim().length < 200}>
            <Sparkles size={16} /> {busy ? "正在分析样章…" : "提炼并保存模板"}
          </button>
        </form>
      )}
      {message && <div className="style-success">{message}</div>}

      <div className="section-title style-library-title">
        <h2>已保存文风</h2>
        <span>{templates.length} 个模板</span>
      </div>
      {templates.length ? (
        <section className="style-template-grid">
          {templates.map((item) => (
            <StyleTemplateCard item={item} key={item.id} onRemove={() => remove(item.id, item.name)} />
          ))}
        </section>
      ) : (
        <div className="empty-inline">还没有文风模板。粘贴一章你喜欢的文字试试。</div>
      )}
      {busy && (
        <div className="scope-busy-backdrop" role="dialog" aria-modal="true" aria-label="Amy 正在提炼文风模板">
          <div className="scope-busy-card">
            <span className="scope-busy-spinner" aria-hidden="true" />
            <h2>Amy 正在提炼文风模板</h2>
            <p>正在分离样章内容与语言特征，并整理成可复用的写作指令。</p>
            <strong>已用时 {elapsed} 秒</strong>
            <small>最长等待 180 秒。完成前页面暂时锁定，结果会自动保存到文风模板库。</small>
          </div>
        </div>
      )}
    </main>
  );
}

function StyleTemplateCard({ item, onRemove }: { item: StyleTemplate; onRemove: () => void }): React.JSX.Element {
  const saveTemplate = useNovelStore((s) => s.saveStyleTemplate);
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(item);

  async function save(event: FormEvent) {
    event.preventDefault();
    const saved = await saveTemplate({
      id: item.id,
      name: draft.name,
      authorAlias: draft.authorAlias,
      sourceTitle: draft.sourceTitle,
      sampleText: item.sampleText,
      contentSummary: draft.contentSummary,
      styleSummary: draft.styleSummary,
      styleGuide: draft.styleGuide,
    });
    setDraft(saved);
    setEditing(false);
  }

  if (editing)
    return (
      <form className="style-template-card style-edit" onSubmit={save}>
        <div className="form-row">
          <label>
            风格名称
            <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label>
            作者别名
            <input required value={draft.authorAlias} onChange={(e) => setDraft({ ...draft, authorAlias: e.target.value })} />
          </label>
        </div>
        <label>
          文风总结
          <textarea rows={4} value={draft.styleSummary} onChange={(e) => setDraft({ ...draft, styleSummary: e.target.value })} />
        </label>
        <label>
          给 AI 的写作指令
          <textarea rows={8} value={draft.styleGuide} onChange={(e) => setDraft({ ...draft, styleGuide: e.target.value })} />
        </label>
        <div className="style-card-actions">
          <button type="button" onClick={() => { setDraft(item); setEditing(false); }}>取消</button>
          <button className="primary"><Save size={15} /> 保存修改</button>
        </div>
      </form>
    );

  return (
    <article className="style-template-card">
      <header>
        <div>
          <BookOpenText size={19} />
          <span>
            <b>{item.name}</b>
            <small>{item.authorAlias}{item.sourceTitle ? ` · ${item.sourceTitle}` : ""}</small>
          </span>
        </div>
        <span className="style-card-actions">
          <button title="编辑模板" onClick={() => setEditing(true)}><Pencil size={16} /></button>
          <button title="删除模板" onClick={onRemove}><Trash2 size={16} /></button>
        </span>
      </header>
      <h3>文风总结</h3><p>{item.styleSummary}</p>
      <h3>样章内容</h3><p>{item.contentSummary}</p>
      <details><summary>查看给 AI 的写作指令</summary><pre>{item.styleGuide}</pre></details>
      <details><summary>查看本地保存的原样章</summary><pre>{item.sampleText}</pre></details>
    </article>
  );
}

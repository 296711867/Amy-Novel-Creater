import { useEffect, useState } from "react";
import { ArrowLeft, Check, Play, Sparkles, X } from "lucide-react";
import { nanoid } from "nanoid";
import { NavLink, Navigate, useParams } from "react-router-dom";
import { useNovelStore } from "../store/novel-store";
import "../generation.css";
const EMPTY: any[] = [];
export function ChapterGeneratePage(): React.JSX.Element {
  const { novelId = "", chapterId = "" } = useParams(),
    novel = useNovelStore((s) => s.novels.find((n) => n.id === novelId)),
    chapter = useNovelStore((s) =>
      (s.chapters[novelId] ?? EMPTY).find((c) => c.id === chapterId),
    ),
    profiles = useNovelStore((s) => s.modelProfiles),
    styleTemplates = useNovelStore((s) => s.styleTemplates),
    // 候选稿与“生成中”都来自全局 store：切页回来依然能看到进行中状态和最新候选。
    candidate = useNovelStore(
      (s) => (s.candidates[chapterId] ?? EMPTY)[0] ?? null,
    ),
    active = useNovelStore((s) => s.activeRequests[chapterId]),
    store = useNovelStore();
  const [profileId, setProfileId] = useState(""),
    [styleTemplateId, setStyleTemplateId] = useState(""),
    [maxTokens, setMaxTokens] = useState(6000),
    [temperature, setTemperature] = useState(0.8),
    [stream, setStream] = useState(""),
    [status, setStatus] = useState("准备生成"),
    [error, setError] = useState("");
  const generating = Boolean(active),
    elapsed = active
      ? Math.max(0, Math.round((Date.now() - active.startedAt) / 1000))
      : 0,
    [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active?.requestId]);
  useEffect(() => {
    void Promise.all([
      store.loadChapters(novelId),
      store.loadModelProfiles(),
      store.loadStyleTemplates(),
      store.loadCandidates(chapterId),
    ]);
  }, [novelId, chapterId]);
  useEffect(() => {
    if (!profileId && profiles.length)
      setProfileId((profiles.find((p) => p.isDefault) ?? profiles[0]).id);
  }, [profiles, profileId]);
  if (!novel) return <Navigate to="/novels" replace />;
  async function start() {
    if (!profileId || !chapter || generating) return;
    setError("");
    setStream("");
    setStatus("正在构建 Context Pack…");
    try {
      const profile = profiles.find((p) => p.id === profileId)!,
        output = Math.min(
          maxTokens,
          Math.max(1000, profile.contextWindow - 8000),
        ),
        pack = await store.buildContext(
          novelId,
          chapterId,
          Math.max(4000, profile.contextWindow - output),
          output,
        );
      setStatus("模型正在写作…");
      const item = await store.generateChapter(
        {
          requestId: nanoid(),
          novelId,
          chapterId,
          profileId,
          contextText: pack.renderedText,
          contextHash: pack.contentHash,
          maxOutputTokens: output,
          temperature,
          styleTemplateId: styleTemplateId || undefined,
        },
        (event) => {
          if (event.type === "delta" && event.delta)
            setStream((value) => value + event.delta);
          if (event.type === "usage")
            setStatus(
              `完成 · 输入 ${event.inputTokens ?? 0} / 输出 ${event.outputTokens ?? 0} tokens`,
            );
        },
      );
      setStream(item.content);
      setStatus(`候选稿已保存 · ${item.wordCount} 字`);
    } catch (value) {
      setError(value instanceof Error ? value.message : "生成失败");
      setStatus("生成失败");
    }
  }
  async function review(accept: boolean) {
    if (!candidate) return;
    await store.reviewCandidate(candidate.id, accept);
    setStatus(accept ? "已接受并写入章节版本" : "已拒绝，候选稿仍保留用于追溯");
  }
  return (
    <main className="chapter-generate">
      <header>
        <NavLink to={`/novels/${novelId}/write/${chapterId}`}>
          <ArrowLeft size={16} />
          返回编辑器
        </NavLink>
        <div>
          <span className="kicker">AI CHAPTER RUN</span>
          <h1>{chapter?.title ?? "加载章节…"}</h1>
        </div>
        <span>
          {generating
            ? `模型正在写作… 已进行 ${elapsed} 秒（切页不会中断）`
            : status}
        </span>
      </header>
      <div className="generation-layout">
        <aside>
          <h3>生成参数</h3>
          <label>
            模型 Profile
            <select
              value={profileId}
              onChange={(e) => setProfileId(e.target.value)}
            >
              <option value="">请选择模型</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.modelId}
                </option>
              ))}
            </select>
          </label>
          <label>
            文风模板
            <select value={styleTemplateId} onChange={(e) => setStyleTemplateId(e.target.value)}>
              <option value="">AI 根据作品自由发挥</option>
              {styleTemplates.map((item) => (
                <option key={item.id} value={item.id}>{item.name} · {item.authorAlias}</option>
              ))}
            </select>
          </label>
          <label>
            最大输出 Token
            <input
              type="number"
              step="500"
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
            />
          </label>
          <label>
            创造性：{temperature}
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(Number(e.target.value))}
            />
          </label>
          <button
            className="primary"
            disabled={
              !chapter ||
              !profileId ||
              generating ||
              status === "正在构建 Context Pack…"
            }
            onClick={start}
            title={generating ? "本章节正在生成中，请等待完成" : undefined}
          >
            <Play size={16} />
            {generating ? `生成中… ${elapsed} 秒` : "构建上下文并生成"}
          </button>
          {error && <div className="error">{error}</div>}
          <div className="generation-note">
            <Sparkles />
            <p>
              结果先进入候选稿，不会直接覆盖正文。接受后会自动创建不可变版本。
            </p>
          </div>
        </aside>
        <section>
          <div className="candidate-toolbar">
            <b>流式候选稿</b>
            {candidate?.status === "candidate" && (
              <span>
                <button className="reject" onClick={() => review(false)}>
                  <X size={15} />
                  拒绝
                </button>
                <button className="accept" onClick={() => review(true)}>
                  <Check size={15} />
                  接受并写入正文
                </button>
              </span>
            )}
            {candidate && candidate.status !== "candidate" && (
              <i>{candidate.status === "accepted" ? "已接受" : "已拒绝"}</i>
            )}
          </div>
          <pre className={stream ? "" : "waiting"}>
            {stream ||
              (generating
                ? "本章仍在后台生成中，切页不会中断；实时流式预览只在生成期间停留本页时显示，完成后候选稿会自动出现在上方。"
                : (candidate?.content ??
                  "生成内容将在这里逐字出现。"))}
          </pre>
        </section>
      </div>
    </main>
  );
}

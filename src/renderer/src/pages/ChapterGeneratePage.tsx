import { useEffect, useState } from "react";
import { ArrowLeft, Check, Play, Sparkles, X } from "lucide-react";
import { nanoid } from "nanoid";
import { NavLink, Navigate, useParams } from "react-router-dom";
import type { ChapterCandidate } from "@domain/chapter-generation";
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
    store = useNovelStore();
  const [profileId, setProfileId] = useState(""),
    [maxTokens, setMaxTokens] = useState(6000),
    [temperature, setTemperature] = useState(0.8),
    [stream, setStream] = useState(""),
    [candidate, setCandidate] = useState<ChapterCandidate | null>(null),
    [status, setStatus] = useState("准备生成"),
    [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([
      store.loadChapters(novelId),
      store.loadModelProfiles(),
      store.loadCandidates(chapterId),
    ]);
  }, [novelId, chapterId]);
  useEffect(() => {
    if (!profileId && profiles.length)
      setProfileId((profiles.find((p) => p.isDefault) ?? profiles[0]).id);
  }, [profiles, profileId]);
  if (!novel) return <Navigate to="/novels" replace />;
  async function start() {
    if (!profileId || !chapter) return;
    setError("");
    setStream("");
    setCandidate(null);
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
      setCandidate(item);
      setStream(item.content);
      setStatus(`候选稿已保存 · ${item.wordCount} 字`);
    } catch (value) {
      setError(value instanceof Error ? value.message : "生成失败");
      setStatus("生成失败");
    }
  }
  async function review(accept: boolean) {
    if (!candidate) return;
    const item = await store.reviewCandidate(candidate.id, accept);
    setCandidate(item);
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
        <span>{status}</span>
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
            disabled={!chapter || !profileId || status === "模型正在写作…"}
            onClick={start}
          >
            <Play size={16} />
            构建上下文并生成
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
            {stream || "生成内容将在这里逐字出现。"}
          </pre>
        </section>
      </div>
    </main>
  );
}

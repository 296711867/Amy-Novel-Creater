import { useEffect, useState } from "react";
import { ArrowLeft, Box, Save } from "lucide-react";
import { NavLink, Navigate, useParams } from "react-router-dom";
import type { ContextPack } from "@domain/context-pack";
import { useNovelStore } from "../store/novel-store";
import "../context.css";
const EMPTY: any[] = [];
export function ContextPage(): React.JSX.Element {
  const { novelId = "" } = useParams(),
    novel = useNovelStore((s) => s.novels.find((item) => item.id === novelId)),
    chapters = useNovelStore((s) => s.chapters[novelId] ?? EMPTY),
    load = useNovelStore((s) => s.loadChapters),
    build = useNovelStore((s) => s.buildContext);
  const [chapterId, setChapterId] = useState(""),
    [inputBudget, setInputBudget] = useState(24000),
    [outputReserved, setOutputReserved] = useState(6000),
    [pack, setPack] = useState<ContextPack | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (novelId) void load(novelId);
  }, [novelId]);
  useEffect(() => {
    if (!chapterId && chapters[0]) setChapterId(chapters[0].id);
  }, [chapters, chapterId]);
  if (!novel) return <Navigate to="/novels" replace />;
  async function preview() {
    if (!chapterId) return;
    setBusy(true);
    try {
      setPack(await build(novelId, chapterId, inputBudget, outputReserved));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="context-page">
      <header>
        <NavLink to={`/novels/${novelId}/generate`}>
          <ArrowLeft size={16} />
          返回生成配置
        </NavLink>
        <div>
          <span className="kicker">CONTEXT PACK BUILDER</span>
          <h1>章节上下文装配</h1>
        </div>
        <button
          className="primary"
          disabled={busy || !chapterId}
          onClick={preview}
        >
          <Save size={16} />
          {busy ? "装配中…" : "构建并保存快照"}
        </button>
      </header>
      <section className="context-config">
        <label>
          目标章节
          <select
            value={chapterId}
            onChange={(e) => {
              setChapterId(e.target.value);
              setPack(null);
            }}
          >
            {chapters.map((ch) => (
              <option key={ch.id} value={ch.id}>
                {ch.position}. {ch.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          输入上下文预算
          <input
            type="number"
            step="1000"
            value={inputBudget}
            onChange={(e) => setInputBudget(Number(e.target.value))}
          />
        </label>
        <label>
          预留输出 Token
          <input
            type="number"
            step="1000"
            value={outputReserved}
            onChange={(e) => setOutputReserved(Number(e.target.value))}
          />
        </label>
      </section>
      {!pack ? (
        <div className="context-empty">
          <Box size={42} />
          <h2>准备上下文快照</h2>
          <p>
            会按优先级组装强制规则、卷章场景、故事圣经、正史台账与最近正文。
          </p>
        </div>
      ) : (
        <div className="context-result">
          <aside>
            <div className="token-ring">
              <b>{pack.inputTokens.toLocaleString()}</b>
              <span>/ {inputBudget.toLocaleString()} 输入 Token</span>
            </div>
            <p>
              预留输出 {pack.outputTokensReserved.toLocaleString()} · 总窗口{" "}
              {pack.totalBudget.toLocaleString()}
            </p>
            {pack.sources.map((item) => (
              <article key={item.id} data-status={item.status}>
                <div>
                  <b>{item.label}</b>
                  <span>
                    {item.status === "included"
                      ? "完整"
                      : item.status === "trimmed"
                        ? "已裁剪"
                        : "已省略"}
                  </span>
                </div>
                <small>
                  {item.includedTokens.toLocaleString()} /{" "}
                  {item.estimatedTokens.toLocaleString()} tokens
                </small>
              </article>
            ))}
          </aside>
          <section>
            <div>
              <b>不可变上下文快照</b>
              <code>#{pack.contentHash}</code>
            </div>
            <pre>{pack.renderedText}</pre>
          </section>
        </div>
      )}
    </main>
  );
}

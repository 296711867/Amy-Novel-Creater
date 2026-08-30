import { useState } from "react";
import { Archive, FileText, Download, Upload, Stethoscope } from "lucide-react";
import {
  novelAsMarkdown,
  novelAsText,
  safeExportName,
} from "@domain/project-export";
import { useNovelStore } from "../store/novel-store";
import { platform } from "../platform/web-platform";

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function DataPage(): React.JSX.Element {
  const novels = useNovelStore((s) => s.novels),
    store = useNovelStore(),
    [novelId, setNovelId] = useState(novels[0]?.id ?? ""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const novel = novels.find((item) => item.id === novelId);
  async function manuscript(kind: "md" | "txt") {
    if (!novel) return;
    const chapters = await store.loadChapters(novel.id),
      name = safeExportName(novel.title);
    download(
      `${name}.${kind}`,
      kind === "md"
        ? novelAsMarkdown(novel, [...chapters])
        : novelAsText(novel, [...chapters]),
      kind === "md"
        ? "text/markdown;charset=utf-8"
        : "text/plain;charset=utf-8",
    );
    setMessage(`已导出 ${kind.toUpperCase()} 正文`);
  }
  async function project() {
    if (!novel) return;
    setBusy(true);
    try {
      const bundle = await store.buildProjectBundle(novel.id);
      download(
        `${safeExportName(novel.title)}.amy-novel.json`,
        JSON.stringify(bundle, null, 2),
        "application/json;charset=utf-8",
      );
      setMessage("完整项目数据包已导出，不包含 API Key");
    } finally {
      setBusy(false);
    }
  }
  async function restore(file: File) {
    setBusy(true);
    setMessage("");
    try {
      const restored = await store.importProject(JSON.parse(await file.text()));
      setNovelId(restored.id);
      setMessage(`“${restored.title}”恢复完成，已作为新作品导入`);
    } catch (value) {
      setMessage(
        value instanceof SyntaxError
          ? "文件不是有效的 JSON"
          : value instanceof Error
            ? `恢复失败：${value.message}`
            : "恢复失败：数据包无效",
      );
    } finally {
      setBusy(false);
    }
  }
  async function diagnostics() {
    const report = await platform.getDiagnostics();
    download(
      `Amy-Novel-Diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify(report, null, 2),
      "application/json;charset=utf-8",
    );
    setMessage("诊断报告已导出，不包含正文和密钥");
  }
  return (
    <main className="page narrow">
      <div className="page-heading">
        <div>
          <span className="kicker">EXPORT & BACKUP</span>
          <h1>导出与备份</h1>
          <p>导出可阅读正文，或保存包含创作资料与历史记录的项目数据包。</p>
        </div>
        <button className="secondary" onClick={diagnostics}>
          <Stethoscope size={16} />
          导出诊断
        </button>
      </div>
      <section className="form-card">
        <label>
          选择作品
          <select
            value={novelId}
            onChange={(e) => {
              setNovelId(e.target.value);
              setMessage("");
            }}
          >
            <option value="">请选择作品</option>
            {novels.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </label>
        <div className="action-grid">
          <button
            className="action-card sand"
            disabled={!novel}
            onClick={() => manuscript("txt")}
          >
            <FileText />
            <b>导出 TXT</b>
            <span>纯正文，适合阅读和平台投稿</span>
          </button>
          <button
            className="action-card rose"
            disabled={!novel}
            onClick={() => manuscript("md")}
          >
            <Download />
            <b>导出 Markdown</b>
            <span>保留标题层级和章节分隔</span>
          </button>
          <button
            className="action-card orange"
            disabled={!novel || busy}
            onClick={project}
          >
            <Archive />
            <b>{busy ? "正在整理…" : "备份项目数据包"}</b>
            <span>章节、版本、故事圣经、正史、候选稿与 Token 记录</span>
          </button>
        </div>
        <hr />
        <h2>恢复项目数据包</h2>
        <p>恢复会创建一本带“（恢复）”后缀的新作品，不会覆盖书架中的原作品。</p>
        <label className="primary">
          <Upload size={16} />
          {busy ? "正在恢复…" : "选择 .amy-novel.json"}
          <input
            hidden
            type="file"
            accept=".json,.amy-novel.json,application/json"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void restore(file);
              e.currentTarget.value = "";
            }}
          />
        </label>
        {message && <div className="model-result">{message}</div>}
        <small>
          项目数据包不包含模型 API Key；旧生成任务不会恢复，候选稿和 Token
          历史会保留。
        </small>
      </section>
    </main>
  );
}

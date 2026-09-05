import { useState } from "react";
import { Archive, FileText, Download, Upload, Stethoscope } from "lucide-react";
import {
  novelAsMarkdown,
  novelAsText,
  safeExportName,
} from "@domain/project-export";
import { useNovelStore } from "../store/novel-store";
import { platform } from "../platform/web-platform";
import { buildTextArchiveEntries, encodeTextZip } from "@domain/text-archive";

function download(name: string, content: BlobPart, type: string) {
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
  async function textArchive() {
    if (!novel) return;
    setBusy(true);
    try {
      const bundle = await store.buildProjectBundle(novel.id);
      const bytes = encodeTextZip(buildTextArchiveEntries(bundle));
      download(
        `${safeExportName(novel.title)}-分章文本.zip`,
        Uint8Array.from(bytes).buffer,
        "application/zip",
      );
      setMessage("已导出分章文本 ZIP（作品信息、设定与已入正史章节）");
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
          <span className="kicker">EXPORT &amp; BACKUP</span>
          <h1>导出与备份</h1>
          <p>导出可阅读正文，或保存包含创作资料与历史记录的项目数据包。</p>
        </div>
        <button className="secondary" onClick={diagnostics}>
          <Stethoscope size={15} />
          导出诊断报告
        </button>
      </div>
      <section className="form-card">
        <header className="card-head">
          <div>
            <h2>导出</h2>
            <p>正文导出为通用格式，数据包用于备份与迁移。</p>
          </div>
        </header>
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
        <div className="export-actions">
          <button disabled={!novel} onClick={() => manuscript("txt")}>
            <FileText size={18} />
            <b>导出 TXT</b>
            <span>纯正文，适合阅读和平台投稿</span>
          </button>
          <button disabled={!novel} onClick={() => manuscript("md")}>
            <Download size={18} />
            <b>导出 Markdown</b>
            <span>保留标题层级和章节分隔</span>
          </button>
          <button disabled={!novel || busy} onClick={project}>
            <Archive size={18} />
            <b>{busy ? "正在整理…" : "备份项目数据包"}</b>
            <span>章节、版本、圣经、正史、候选稿与用量</span>
          </button>
          <button disabled={!novel || busy} onClick={textArchive}>
            <Archive size={18} />
            <b>{busy ? "正在整理…" : "导出分章文本 ZIP"}</b>
            <span>作品信息、设定与每章独立 TXT</span>
          </button>
        </div>
        {message && <div className="model-result">{message}</div>}
      </section>
      <section className="form-card">
        <header className="card-head">
          <div>
            <h2>恢复项目数据包</h2>
            <p>恢复会创建一本带“（恢复）”后缀的新作品，不会覆盖原作品。</p>
          </div>
        </header>
        <label className="upload-zone">
          <Upload size={17} />
          {busy ? "正在恢复…" : "选择 .amy-novel.json 数据包"}
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
        <small>
          项目数据包不包含模型 API Key；旧生成任务不会恢复，候选稿和
          Token 历史会保留。
        </small>
      </section>
    </main>
  );
}

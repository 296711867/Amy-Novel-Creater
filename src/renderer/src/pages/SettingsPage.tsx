import { useEffect, useState } from "react";
import { CheckCircle2, Plus, Server, Trash2 } from "lucide-react";
import {
  PROVIDER_PRESETS,
  type ModelProvider,
  type SaveModelProfileInput,
} from "@domain/model-profile";
import { applyTheme, themes, type ThemeId } from "../theme/theme";
import { useNovelStore } from "../store/novel-store";
import "../models.css";
const empty: SaveModelProfileInput = {
  name: "",
  provider: "openai-compatible",
  modelId: "",
  baseUrl: "",
  contextWindow: 128000,
  inputPricePerMillion: null,
  outputPricePerMillion: null,
  isDefault: false,
  apiKey: "",
};
export function SettingsPage(): React.JSX.Element {
  const [theme, setTheme] = useState<ThemeId>(
      (document.documentElement.dataset.theme as ThemeId) || "coral",
    ),
    profiles = useNovelStore((s) => s.modelProfiles),
    store = useNovelStore(),
    [selected, setSelected] = useState<string | null>(null),
    [form, setForm] = useState<SaveModelProfileInput>(empty),
    [result, setResult] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void store.loadModelProfiles();
  }, []);
  function choose(id: string) {
    const item = profiles.find((p) => p.id === id);
    if (!item) return;
    setSelected(id);
    setForm({ ...item, apiKey: "" });
    setResult("");
  }
  function provider(value: ModelProvider) {
    const preset = PROVIDER_PRESETS[value];
    setForm({
      ...form,
      provider: value,
      baseUrl: preset.baseUrl,
      modelId: preset.modelId,
      name: preset.label,
    });
  }
  async function save() {
    if (!form.name || !form.modelId || !form.baseUrl) return;
    const item = await store.saveModelProfile({
      ...form,
      id: selected ?? undefined,
    });
    setSelected(item.id);
    setForm({ ...item, apiKey: "" });
    setResult("配置已保存，密钥不会回显。");
  }
  async function test() {
    if (!selected) {
      setResult("请先保存配置");
      return;
    }
    setBusy(true);
    try {
      const value = await store.testModelConnection(selected, form.apiKey);
      setResult(`${value.message} · ${value.latencyMs} ms`);
    } catch (error) {
      setResult(
        `测试失败：${error instanceof Error ? error.message : "未知错误"}`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="page settings-page">
      <div className="page-heading">
        <div>
          <span className="kicker">PREFERENCES & MODELS</span>
          <h1>设置</h1>
          <p>五套界面主题可切换；模型配置按 Profile 隔离，可为不同任务切换不同模型。</p>
        </div>
      </div>
      <section className="form-card">
        <header className="card-head">
          <div>
            <h2>界面主题</h2>
            <p>选择工作台配色，即时生效并本地记忆。</p>
          </div>
        </header>
        <div className="theme-grid">
          {themes.map((t) => (
            <button
              className={theme === t ? "selected" : ""}
              key={t}
              onClick={() => {
                setTheme(t);
                applyTheme(t);
              }}
            >
              <i data-swatch={t} />
              <b>
                {
                  {
                    coral: "暖杏珊瑚",
                    sage: "自然鼠尾草",
                    studio: "冷静工作室",
                    pastel: "柔粉粉彩",
                    midnight: "深夜工作台",
                  }[t]
                }
              </b>
            </button>
          ))}
        </div>
      </section>
      <div className="models-layout">
        <aside>
          <header>
            <b>模型 Profiles</b>
            <button
              onClick={() => {
                setSelected(null);
                setForm(empty);
                setResult("");
              }}
            >
              <Plus size={15} />
            </button>
          </header>
          {profiles.map((item) => (
            <button
              className={item.id === selected ? "active" : ""}
              key={item.id}
              onClick={() => choose(item.id)}
            >
              <Server size={17} />
              <span>
                <b>{item.name}</b>
                <small>
                  {item.modelId}
                  {item.isDefault ? " · 默认" : ""}
                </small>
              </span>
              <i className={item.hasSecret ? "ready" : ""} />
            </button>
          ))}
        </aside>
        <section className="model-editor">
          <span className="kicker">OPENAI-COMPATIBLE</span>
          <h2>{selected ? "编辑模型" : "新增模型"}</h2>
          <div className="model-row">
            <label>
              供应商
              <select
                value={form.provider}
                onChange={(e) => provider(e.target.value as ModelProvider)}
              >
                {Object.entries(PROVIDER_PRESETS).map(([id, p]) => (
                  <option key={id} value={id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              配置名称
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
          </div>
          <label>
            Base URL
            <input
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://example.com/v1"
            />
          </label>
          <div className="model-row">
            <label>
              模型 ID
              <input
                value={form.modelId}
                onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              />
            </label>
            <label>
              上下文窗口
              <input
                type="number"
                value={form.contextWindow}
                onChange={(e) =>
                  setForm({ ...form, contextWindow: Number(e.target.value) })
                }
              />
            </label>
          </div>
          <label>
            API Key
            <input
              type="password"
              autoComplete="new-password"
              value={form.apiKey ?? ""}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder={
                selected ? "留空则继续使用已加密保存的密钥" : "输入 API Key"
              }
            />
            <small>
              Electron 使用系统 safeStorage 加密；Web 只保留到当前浏览器会话。
            </small>
          </label>
          <label className="default-check">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) =>
                setForm({ ...form, isDefault: e.target.checked })
              }
            />
            设为默认写作模型
          </label>
          {result && (
            <div className="model-result">
              <CheckCircle2 size={15} />
              {result}
            </div>
          )}
          {!result && !selected && (
            <small>先点击「保存配置」创建模型，才能测试连接。</small>
          )}
          <footer>
            {selected ? (
              <button
                className="danger"
                onClick={async () => {
                  await store.deleteModelProfile(selected);
                  setSelected(null);
                  setForm(empty);
                }}
              >
                <Trash2 size={15} />
                删除
              </button>
            ) : (
              <span />
            )}
            <div>
              <button
                className="secondary"
                disabled={busy}
                onClick={test}
              >
                {busy ? "测试中…" : "测试连接"}
              </button>
              <button className="primary" onClick={save}>
                保存配置
              </button>
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BookOpen,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { NavLink, Navigate, useParams } from "react-router-dom";
import { moveItem } from "@domain/story-structure";
import { useNovelStore } from "../store/novel-store";
import "../structure.css";

const EMPTY: any[] = [];
export function StructurePage(): React.JSX.Element {
  const { novelId = "" } = useParams(),
    novel = useNovelStore((s) => s.novels.find((item) => item.id === novelId)),
    chapters = useNovelStore((s) => s.chapters[novelId] ?? EMPTY),
    volumes = useNovelStore((s) => s.volumes[novelId] ?? EMPTY),
    scenes = useNovelStore((s) => s.scenes[novelId] ?? EMPTY);
  const store = useNovelStore(),
    [selected, setSelected] = useState<string>(""),
    [mode, setMode] = useState<"volume" | "chapter" | "scene">("chapter");
  useEffect(() => {
    if (novelId) void store.loadStructure(novelId);
  }, [novelId]);
  useEffect(() => {
    if (!selected && chapters[0]) setSelected(chapters[0].id);
  }, [chapters, selected]);
  const volume = volumes.find((item) => item.id === selected),
    chapter = chapters.find((item) => item.id === selected),
    scene = scenes.find((item) => item.id === selected),
    current: any =
      mode === "volume" ? volume : mode === "scene" ? scene : chapter;
  const chapterScenes = useMemo(
    () =>
      scenes
        .filter((item) => item.chapterId === chapter?.id)
        .sort((a, b) => a.position - b.position),
    [scenes, chapter?.id],
  );
  if (!novel) return <Navigate to="/novels" replace />;
  async function shift(
    kind: "volume" | "chapter" | "scene",
    id: string,
    direction: -1 | 1,
  ) {
    if (kind === "volume") {
      const next = moveItem(volumes, id, direction);
      await store.reorderVolumes(
        novelId,
        next.map((i) => i.id),
      );
    } else if (kind === "chapter") {
      const next = moveItem(chapters, id, direction);
      await store.reorderChapters(
        novelId,
        next.map((i) => i.id),
      );
    } else {
      const target = scenes.find((item) => item.id === id);
      if (!target) return;
      const siblings = scenes
          .filter((i) => i.chapterId === target.chapterId)
          .sort((a, b) => a.position - b.position),
        next = moveItem(siblings, id, direction);
      await store.reorderScenes(
        novelId,
        target.chapterId,
        next.map((i) => i.id),
      );
    }
  }
  return (
    <main className="structure-shell">
      <header className="structure-head">
        <NavLink to={`/novels/${novelId}/plan`}>
          <ArrowLeft size={17} />
          返回规划
        </NavLink>
        <div>
          <span>STORY STRUCTURE</span>
          <h1>{novel.title} · 结构编排</h1>
        </div>
        <button
          className="primary"
          onClick={async () => {
            const item = await store.createChapter({
              novelId,
              volumeId: volumes[0]?.id ?? null,
              targetWords: novel.chapterWords,
            });
            setMode("chapter");
            setSelected(item.id);
          }}
        >
          <Plus size={16} />
          新增章节
        </button>
      </header>
      <div className="structure-grid">
        <aside className="structure-tree">
          <div className="structure-tools">
            <b>卷章场景</b>
            <button
              onClick={async () => {
                const item = await store.saveVolume({
                  novelId,
                  title: `第 ${volumes.length + 1} 卷`,
                  outline: "",
                });
                setMode("volume");
                setSelected(item.id);
              }}
            >
              <Plus size={15} />卷
            </button>
          </div>
          {volumes.map((v) => (
            <section key={v.id}>
              <TreeRow
                label={v.title}
                meta={`${chapters.filter((c) => c.volumeId === v.id).length} 章`}
                active={selected === v.id}
                onClick={() => {
                  setMode("volume");
                  setSelected(v.id);
                }}
                onMove={(d) => shift("volume", v.id, d)}
              />
              {chapters
                .filter((c) => c.volumeId === v.id)
                .map((c) => (
                  <div key={c.id} className="chapter-branch">
                    <TreeRow
                      label={c.title}
                      meta={`${c.wordCount}/${c.targetWords} 字`}
                      active={selected === c.id}
                      onClick={() => {
                        setMode("chapter");
                        setSelected(c.id);
                      }}
                      onMove={(d) => shift("chapter", c.id, d)}
                    />
                    {scenes
                      .filter((s) => s.chapterId === c.id)
                      .sort((a, b) => a.position - b.position)
                      .map((s) => (
                        <TreeRow
                          key={s.id}
                          compact
                          label={s.title}
                          meta={`${s.targetWords} 字`}
                          active={selected === s.id}
                          onClick={() => {
                            setMode("scene");
                            setSelected(s.id);
                          }}
                          onMove={(d) => {
                            setMode("scene");
                            setSelected(s.id);
                            void shift("scene", s.id, d);
                          }}
                        />
                      ))}
                  </div>
                ))}
            </section>
          ))}
          {chapters.some((c) => !c.volumeId) && (
            <section>
              <b className="unassigned">未分卷</b>
              {chapters
                .filter((c) => !c.volumeId)
                .map((c) => (
                  <TreeRow
                    key={c.id}
                    label={c.title}
                    meta="待归档"
                    active={selected === c.id}
                    onClick={() => {
                      setMode("chapter");
                      setSelected(c.id);
                    }}
                    onMove={(d) => shift("chapter", c.id, d)}
                  />
                ))}
            </section>
          )}
        </aside>
        <section className="structure-editor">
          {!current ? (
            <div className="empty-inline">从左侧选择卷、章节或场景。</div>
          ) : mode === "volume" ? (
            <VolumeEditor
              key={current.id}
              item={current}
              canDelete={volumes.length > 1}
              onSave={(data) =>
                store.saveVolume({ ...data, novelId, id: current.id })
              }
              onDelete={async () => {
                await store.deleteVolume(novelId, current.id);
                setSelected(volumes.find((v) => v.id !== current.id)?.id ?? "");
              }}
            />
          ) : mode === "chapter" ? (
            <ChapterEditor
              key={current.id}
              item={current}
              volumes={volumes}
              scenes={chapterScenes}
              onAddScene={async () => {
                const item = await store.saveScene(novelId, {
                  chapterId: current.id,
                  title: `场景 ${chapterScenes.length + 1}`,
                  summary: "",
                  viewpoint: "",
                  location: "",
                  targetWords: 800,
                });
                setMode("scene");
                setSelected(item.id);
              }}
              onSave={store.updateChapterPlan}
              onDelete={async () => {
                await store.deleteChapter(novelId, current.id);
                setSelected("");
              }}
            />
          ) : (
            <SceneEditor
              key={current.id}
              item={current}
              onSave={(data) =>
                store.saveScene(novelId, {
                  ...data,
                  id: current.id,
                  chapterId: current.chapterId,
                })
              }
              onDelete={async () => {
                await store.deleteScene(novelId, current.id);
                setMode("chapter");
                setSelected(current.chapterId);
              }}
            />
          )}
        </section>
        <aside className="structure-guide">
          <BookOpen />
          <h3>三级故事骨架</h3>
          <p>卷负责阶段目标，章节负责叙事推进，场景负责可执行的镜头与冲突。</p>
          <div>
            <b>当前规模</b>
            <span>{volumes.length} 卷</span>
            <span>{chapters.length} 章</span>
            <span>{scenes.length} 个场景</span>
          </div>
          <p>
            目录顺序将直接成为批量生成顺序；已有章节 ID
            不变，因此正文、快照和正史关联不会丢失。
          </p>
        </aside>
      </div>
    </main>
  );
}
function TreeRow({
  label,
  meta,
  active,
  compact,
  onClick,
  onMove,
}: {
  label: string;
  meta: string;
  active: boolean;
  compact?: boolean;
  onClick: () => void;
  onMove: (d: -1 | 1) => void;
}) {
  return (
    <div
      className={`tree-row ${active ? "active" : ""} ${compact ? "compact" : ""}`}
    >
      <button onClick={onClick}>
        <b>{label}</b>
        <small>{meta}</small>
      </button>
      <span>
        <button title="上移" onClick={() => onMove(-1)}>
          <ArrowUp size={12} />
        </button>
        <button title="下移" onClick={() => onMove(1)}>
          <ArrowDown size={12} />
        </button>
      </span>
    </div>
  );
}
function Actions({
  onSave,
  onDelete,
  canDelete = true,
}: {
  onSave: () => void;
  onDelete: () => void;
  canDelete?: boolean;
}) {
  return (
    <footer>
      <button className="danger" disabled={!canDelete} onClick={onDelete}>
        <Trash2 size={15} />
        删除
      </button>
      <button className="primary" onClick={onSave}>
        <Save size={15} />
        保存
      </button>
    </footer>
  );
}
function VolumeEditor({ item, onSave, onDelete, canDelete }: any) {
  const [form, setForm] = useState(item);
  return (
    <>
      <span className="kicker">VOLUME ARC</span>
      <h2>编辑分卷</h2>
      <label>
        卷名
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </label>
      <label>
        阶段目标与转折
        <textarea
          rows={12}
          value={form.outline}
          onChange={(e) => setForm({ ...form, outline: e.target.value })}
        />
      </label>
      <Actions
        canDelete={canDelete}
        onDelete={onDelete}
        onSave={() => onSave(form)}
      />
    </>
  );
}
function ChapterEditor({
  item,
  volumes,
  scenes,
  onSave,
  onDelete,
  onAddScene,
}: any) {
  const [form, setForm] = useState(item);
  return (
    <>
      <span className="kicker">CHAPTER PLAN</span>
      <h2>编辑章节</h2>
      <div className="field-row">
        <label>
          所属卷
          <select
            value={form.volumeId ?? ""}
            onChange={(e) =>
              setForm({ ...form, volumeId: e.target.value || null })
            }
          >
            <option value="">未分卷</option>
            {volumes.map((v: any) => (
              <option key={v.id} value={v.id}>
                {v.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          目标字数
          <input
            type="number"
            value={form.targetWords}
            onChange={(e) =>
              setForm({ ...form, targetWords: Number(e.target.value) })
            }
          />
        </label>
      </div>
      <label>
        章节标题
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </label>
      <label>
        章节大纲
        <textarea
          rows={8}
          value={form.outline}
          onChange={(e) => setForm({ ...form, outline: e.target.value })}
        />
      </label>
      <div className="scene-summary">
        <b>场景拆分</b>
        <span>{scenes.length} 个场景</span>
        <button onClick={onAddScene}>
          <Plus size={14} />
          新增场景
        </button>
      </div>
      <Actions
        onDelete={onDelete}
        onSave={() =>
          onSave({
            chapterId: item.id,
            volumeId: form.volumeId,
            title: form.title,
            outline: form.outline,
            targetWords: form.targetWords,
          })
        }
      />
    </>
  );
}
function SceneEditor({ item, onSave, onDelete }: any) {
  const [form, setForm] = useState(item);
  return (
    <>
      <span className="kicker">SCENE CARD</span>
      <h2>编辑场景</h2>
      <label>
        场景标题
        <input
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </label>
      <div className="field-row">
        <label>
          视角人物
          <input
            value={form.viewpoint}
            onChange={(e) => setForm({ ...form, viewpoint: e.target.value })}
          />
        </label>
        <label>
          地点
          <input
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
          />
        </label>
      </div>
      <label>
        目标字数
        <input
          type="number"
          value={form.targetWords}
          onChange={(e) =>
            setForm({ ...form, targetWords: Number(e.target.value) })
          }
        />
      </label>
      <label>
        场景目标、冲突与结果
        <textarea
          rows={10}
          value={form.summary}
          onChange={(e) => setForm({ ...form, summary: e.target.value })}
        />
      </label>
      <Actions onDelete={onDelete} onSave={() => onSave(form)} />
    </>
  );
}

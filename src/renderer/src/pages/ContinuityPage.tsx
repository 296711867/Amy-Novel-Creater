import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  GitCommitHorizontal,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserRoundCog,
} from "lucide-react";
import { Navigate, NavLink, useParams } from "react-router-dom";
import {
  FORESHADOW_STATUS_LABELS,
  canMoveForeshadow,
  type ForeshadowStatus,
  type SaveCharacterStateInput,
  type SaveForeshadowInput,
  type SaveTimelineEventInput,
} from "@domain/continuity";
import { useNovelStore } from "@renderer/store/novel-store";

const EMPTY: never[] = [];
type View = "timeline" | "foreshadow" | "states";

export function ContinuityPage(): React.JSX.Element {
  const { novelId = "" } = useParams(),
    novel = useNovelStore((s) => s.novels.find((item) => item.id === novelId)),
    chapters = useNovelStore((s) => s.chapters[novelId] ?? EMPTY),
    entities = useNovelStore((s) => s.entities[novelId] ?? EMPTY),
    timeline = useNovelStore((s) => s.timelineEvents[novelId] ?? EMPTY),
    threads = useNovelStore((s) => s.foreshadowThreads[novelId] ?? EMPTY),
    states = useNovelStore((s) => s.characterStates[novelId] ?? EMPTY);
  const loadChapters = useNovelStore((s) => s.loadChapters),
    loadEntities = useNovelStore((s) => s.loadEntities),
    loadContinuity = useNovelStore((s) => s.loadContinuity),
    saveTimeline = useNovelStore((s) => s.saveTimeline),
    deleteTimeline = useNovelStore((s) => s.deleteTimeline),
    saveForeshadow = useNovelStore((s) => s.saveForeshadow),
    deleteForeshadow = useNovelStore((s) => s.deleteForeshadow),
    saveState = useNovelStore((s) => s.saveCharacterState),
    deleteState = useNovelStore((s) => s.deleteCharacterState);
  const [view, setView] = useState<View>("timeline"),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const emptyTimeline = (): SaveTimelineEventInput => ({
      novelId,
      chapterId: null,
      storyTime: "",
      title: "",
      detail: "",
      participantIds: [],
    }),
    emptyThread = (): SaveForeshadowInput => ({
      novelId,
      title: "",
      detail: "",
      setupChapterId: null,
      payoffChapterId: null,
      status: "planned",
    }),
    emptyState = (): SaveCharacterStateInput => ({
      novelId,
      characterId: "",
      chapterId: null,
      summary: "",
      location: "",
      appearance: "",
      outfit: "",
      identity: "",
      physical: "",
      emotional: "",
      knowledge: [],
      goals: [],
      inventory: [],
      skills: [],
    });
  const [timelineForm, setTimelineForm] =
      useState<SaveTimelineEventInput>(emptyTimeline()),
    [threadForm, setThreadForm] = useState<SaveForeshadowInput>(emptyThread()),
    [stateForm, setStateForm] = useState<SaveCharacterStateInput>(emptyState());
  useEffect(() => {
    void loadChapters(novelId);
    void loadEntities(novelId);
    void loadContinuity(novelId);
  }, [loadChapters, loadEntities, loadContinuity, novelId]);
  const characters = useMemo(
    () => entities.filter((item) => item.type === "character"),
    [entities],
  );
  if (!novel) return <Navigate to="/novels" replace />;
  function chapterName(id: string | null) {
    return chapters.find((item) => item.id === id)?.title ?? "未关联章节";
  }
  function reset(next: View = view) {
    setSelectedId(null);
    if (next === "timeline") setTimelineForm(emptyTimeline());
    if (next === "foreshadow") setThreadForm(emptyThread());
    if (next === "states") setStateForm(emptyState());
  }
  function changeView(next: View) {
    setView(next);
    reset(next);
  }
  async function remove(kind: View) {
    if (
      !selectedId ||
      !window.confirm("确定删除这条正史记录吗？此操作不可撤销。")
    )
      return;
    if (kind === "timeline") await deleteTimeline(novelId, selectedId);
    if (kind === "foreshadow") await deleteForeshadow(novelId, selectedId);
    if (kind === "states") await deleteState(novelId, selectedId);
    reset(kind);
  }
  return (
    <main className="continuity-shell">
      <header className="continuity-top">
        <NavLink to={`/novels/${novelId}/plan`}>
          <ChevronLeft size={17} />
          返回规划
        </NavLink>
        <div>
          <b>{novel.title}</b>
          <span>动态正史台账</span>
        </div>
        <button onClick={() => reset()}>
          <Plus size={16} />
          新建记录
        </button>
      </header>
      <nav className="continuity-tabs">
        <button
          className={view === "timeline" ? "active" : ""}
          onClick={() => changeView("timeline")}
        >
          <CalendarDays />
          时间线 <span>{timeline.length}</span>
        </button>
        <button
          className={view === "foreshadow" ? "active" : ""}
          onClick={() => changeView("foreshadow")}
        >
          <GitCommitHorizontal />
          伏笔 <span>{threads.length}</span>
        </button>
        <button
          className={view === "states" ? "active" : ""}
          onClick={() => changeView("states")}
        >
          <UserRoundCog />
          角色状态 <span>{states.length}</span>
        </button>
      </nav>
      <div className="continuity-layout">
        <aside className="ledger-list">
          {view === "timeline" &&
            (timeline.length ? (
              timeline.map((item) => (
                <button
                  key={item.id}
                  className={selectedId === item.id ? "selected" : ""}
                  onClick={() => {
                    setSelectedId(item.id);
                    setTimelineForm({ ...item });
                  }}
                >
                  <i>{item.storyTime || "未定"}</i>
                  <b>{item.title}</b>
                  <small>{chapterName(item.chapterId)}</small>
                </button>
              ))
            ) : (
              <p>还没有时间线事件。</p>
            ))}
          {view === "foreshadow" &&
            (threads.length ? (
              threads.map((item) => (
                <button
                  key={item.id}
                  className={selectedId === item.id ? "selected" : ""}
                  onClick={() => {
                    setSelectedId(item.id);
                    setThreadForm({ ...item });
                  }}
                >
                  <i data-status={item.status}>
                    {FORESHADOW_STATUS_LABELS[item.status]}
                  </i>
                  <b>{item.title}</b>
                  <small>
                    {chapterName(item.setupChapterId)} →{" "}
                    {chapterName(item.payoffChapterId)}
                  </small>
                </button>
              ))
            ) : (
              <p>还没有伏笔记录。</p>
            ))}
          {view === "states" &&
            (states.length ? (
              states.map((item) => (
                <button
                  key={item.id}
                  className={selectedId === item.id ? "selected" : ""}
                  onClick={() => {
                    setSelectedId(item.id);
                    setStateForm({ ...item });
                  }}
                >
                  <i>
                    {entities
                      .find((entity) => entity.id === item.characterId)
                      ?.name.slice(0, 1) ?? "角"}
                  </i>
                  <b>
                    {entities.find((entity) => entity.id === item.characterId)
                      ?.name ?? "未知角色"}
                  </b>
                  <small>
                    {chapterName(item.chapterId)} ·{" "}
                    {item.location || "位置未知"}
                  </small>
                </button>
              ))
            ) : (
              <p>还没有角色状态。</p>
            ))}
        </aside>
        <section className="ledger-editor">
          {view === "timeline" && (
            <>
              <span className="kicker">CANON TIMELINE</span>
              <h1>{selectedId ? "编辑时间线事件" : "新增时间线事件"}</h1>
              <div className="ledger-row">
                <label>
                  故事内时间
                  <input
                    value={timelineForm.storyTime}
                    onChange={(e) =>
                      setTimelineForm({
                        ...timelineForm,
                        storyTime: e.target.value,
                      })
                    }
                    placeholder="例如：星历 217 年 3 月"
                  />
                </label>
                <label>
                  关联章节
                  <select
                    value={timelineForm.chapterId ?? ""}
                    onChange={(e) =>
                      setTimelineForm({
                        ...timelineForm,
                        chapterId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">未关联章节</option>
                    {chapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                事件标题
                <input
                  value={timelineForm.title}
                  onChange={(e) =>
                    setTimelineForm({ ...timelineForm, title: e.target.value })
                  }
                />
              </label>
              <label>
                事件详情
                <textarea
                  rows={9}
                  value={timelineForm.detail}
                  onChange={(e) =>
                    setTimelineForm({ ...timelineForm, detail: e.target.value })
                  }
                />
              </label>
              <label>
                参与角色
                <select
                  multiple
                  value={timelineForm.participantIds}
                  onChange={(e) =>
                    setTimelineForm({
                      ...timelineForm,
                      participantIds: Array.from(
                        e.target.selectedOptions,
                        (item) => item.value,
                      ),
                    })
                  }
                >
                  {characters.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
                <small>按住 Ctrl 可选择多个角色。</small>
              </label>
              <LedgerFooter
                selected={selectedId}
                onDelete={() => remove("timeline")}
                onSave={async () => {
                  if (!timelineForm.title.trim()) return;
                  const saved = await saveTimeline(timelineForm);
                  setSelectedId(saved.id);
                  setTimelineForm(saved);
                }}
              />
            </>
          )}
          {view === "foreshadow" && (
            <>
              <span className="kicker">FORESHADOW LEDGER</span>
              <h1>{selectedId ? "编辑伏笔" : "新增伏笔"}</h1>
              <label>
                伏笔名称
                <input
                  value={threadForm.title}
                  onChange={(e) =>
                    setThreadForm({ ...threadForm, title: e.target.value })
                  }
                />
              </label>
              <label>
                设计与预期回报
                <textarea
                  rows={7}
                  value={threadForm.detail}
                  onChange={(e) =>
                    setThreadForm({ ...threadForm, detail: e.target.value })
                  }
                />
              </label>
              <div className="ledger-row">
                <label>
                  埋设章节
                  <select
                    value={threadForm.setupChapterId ?? ""}
                    onChange={(e) =>
                      setThreadForm({
                        ...threadForm,
                        setupChapterId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">尚未埋设</option>
                    {chapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  回收章节
                  <select
                    value={threadForm.payoffChapterId ?? ""}
                    onChange={(e) =>
                      setThreadForm({
                        ...threadForm,
                        payoffChapterId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">尚未回收</option>
                    {chapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                状态
                <select
                  value={threadForm.status}
                  onChange={(e) => {
                    const next = e.target.value as ForeshadowStatus;
                    if (
                      !threadForm.id ||
                      canMoveForeshadow(threadForm.status, next)
                    )
                      setThreadForm({ ...threadForm, status: next });
                  }}
                >
                  {Object.entries(FORESHADOW_STATUS_LABELS).map(
                    ([value, label]) => (
                      <option
                        key={value}
                        value={value}
                        disabled={
                          Boolean(threadForm.id) &&
                          !canMoveForeshadow(
                            threadForm.status,
                            value as ForeshadowStatus,
                          )
                        }
                      >
                        {label}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <LedgerFooter
                selected={selectedId}
                onDelete={() => remove("foreshadow")}
                onSave={async () => {
                  if (!threadForm.title.trim()) return;
                  const saved = await saveForeshadow(threadForm);
                  setSelectedId(saved.id);
                  setThreadForm(saved);
                }}
              />
            </>
          )}
          {view === "states" && (
            <>
              <span className="kicker">CHARACTER STATE</span>
              <h1>{selectedId ? "编辑角色状态" : "记录角色状态"}</h1>
              <div className="ledger-row">
                <label>
                  角色
                  <select
                    value={stateForm.characterId}
                    onChange={(e) =>
                      setStateForm({
                        ...stateForm,
                        characterId: e.target.value,
                      })
                    }
                  >
                    <option value="">选择角色</option>
                    {characters.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  状态截至章节
                  <select
                    value={stateForm.chapterId ?? ""}
                    onChange={(e) =>
                      setStateForm({
                        ...stateForm,
                        chapterId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">项目初始状态</option>
                    {chapters.map((ch) => (
                      <option key={ch.id} value={ch.id}>
                        {ch.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                状态摘要
                <textarea
                  rows={3}
                  value={stateForm.summary}
                  onChange={(e) =>
                    setStateForm({ ...stateForm, summary: e.target.value })
                  }
                />
              </label>
              <div className="ledger-row">
                <label>
                  当前位置
                  <input
                    value={stateForm.location}
                    onChange={(e) =>
                      setStateForm({ ...stateForm, location: e.target.value })
                    }
                  />
                </label>
                <label>
                  情绪状态
                  <input
                    value={stateForm.emotional}
                    onChange={(e) =>
                      setStateForm({ ...stateForm, emotional: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                身体状态
                <input
                  value={stateForm.physical}
                  onChange={(e) =>
                    setStateForm({ ...stateForm, physical: e.target.value })
                  }
                />
              </label>
              <div className="ledger-row">
                <label>
                  外貌变化
                  <input
                    placeholder="如：头发剪短、右臂受伤留疤"
                    value={stateForm.appearance ?? ""}
                    onChange={(e) =>
                      setStateForm({ ...stateForm, appearance: e.target.value })
                    }
                  />
                </label>
                <label>
                  当前衣着
                  <input
                    placeholder="如：黑色大衣、宴会礼服"
                    value={stateForm.outfit ?? ""}
                    onChange={(e) =>
                      setStateForm({ ...stateForm, outfit: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                身份变化
                <input
                  placeholder="如：获得“调查组顾问”头衔、使用假身份"
                  value={stateForm.identity ?? ""}
                  onChange={(e) =>
                    setStateForm({ ...stateForm, identity: e.target.value })
                  }
                />
              </label>
              <ListField
                label="已知信息"
                values={stateForm.knowledge}
                onChange={(knowledge) =>
                  setStateForm({ ...stateForm, knowledge })
                }
              />
              <ListField
                label="当前目标"
                values={stateForm.goals}
                onChange={(goals) => setStateForm({ ...stateForm, goals })}
              />
              <ListField
                label="关键物品"
                values={stateForm.inventory}
                onChange={(inventory) =>
                  setStateForm({ ...stateForm, inventory })
                }
              />
              <ListField
                label="技能、能力与熟练度"
                values={stateForm.skills}
                onChange={(skills) => setStateForm({ ...stateForm, skills })}
              />
              <LedgerFooter
                selected={selectedId}
                onDelete={() => remove("states")}
                onSave={async () => {
                  if (!stateForm.characterId) return;
                  const saved = await saveState(stateForm);
                  setSelectedId(saved.id);
                  setStateForm(saved);
                }}
              />
            </>
          )}
        </section>
        <aside className="canon-guide">
          <div className="amy-avatar">
            <Sparkles />
          </div>
          <h3>正史规则</h3>
          <p>
            手动记录会立即成为正史。未来 AI
            从已接受章节提取的变化会先进入候选区，确认后才写入这里。
          </p>
          <ul>
            <li>事件按故事内时间排序</li>
            <li>角色状态保留历史，不覆盖档案</li>
            <li>伏笔回收后不可随意回退</li>
          </ul>
        </aside>
      </div>
    </main>
  );
}

function ListField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <label>
      {label}
      <textarea
        rows={2}
        value={values.join("\n")}
        onChange={(e) => onChange(e.target.value.split("\n"))}
      />
      <small>每行一项。</small>
    </label>
  );
}
function LedgerFooter({
  selected,
  onDelete,
  onSave,
}: {
  selected: string | null;
  onDelete: () => void;
  onSave: () => void;
}) {
  return (
    <footer>
      {selected && (
        <button className="danger" onClick={onDelete}>
          <Trash2 size={16} />
          删除
        </button>
      )}
      <button className="primary" onClick={onSave}>
        <Save size={16} />
        保存到正史
      </button>
    </footer>
  );
}

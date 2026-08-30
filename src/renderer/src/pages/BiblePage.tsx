import { useEffect, useMemo, useState } from "react";
import {
  BookHeart,
  Check,
  ChevronLeft,
  MapPin,
  Plus,
  Save,
  Shield,
  Sparkles,
  Trash2,
  UserRound,
  WandSparkles,
} from "lucide-react";
import {
  Navigate,
  NavLink,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  BIBLE_SECTION_LABELS,
  CHARACTER_TIER_LABELS,
  characterTierOf,
  ENTITY_TYPE_LABELS,
  type BibleSectionKind,
  type SaveStoryEntityInput,
  type StoryEntity,
  type StoryEntityType,
} from "@domain/story-bible";
import { useNovelStore } from "@renderer/store/novel-store";

const sectionKinds: BibleSectionKind[] = [
  "intent",
  "world",
  "style",
  "boundaries",
];
const entityTypes: StoryEntityType[] = [
  "character",
  "location",
  "organization",
  "item",
  "term",
];
const icons: Record<StoryEntityType, typeof UserRound> = {
  character: UserRound,
  location: MapPin,
  organization: Shield,
  item: Sparkles,
  term: BookHeart,
};
const EMPTY_SECTIONS: never[] = [];
const EMPTY_ENTITIES: never[] = [];

export function BiblePage(): React.JSX.Element {
  const { novelId = "" } = useParams(),
    [searchParams] = useSearchParams(),
    novel = useNovelStore((s) => s.novels.find((item) => item.id === novelId)),
    sections = useNovelStore((s) => s.bibleSections[novelId] ?? EMPTY_SECTIONS),
    entities = useNovelStore((s) => s.entities[novelId] ?? EMPTY_ENTITIES);
  const loadBible = useNovelStore((s) => s.loadBible),
    saveBible = useNovelStore((s) => s.saveBibleSection),
    loadEntities = useNovelStore((s) => s.loadEntities),
    saveEntity = useNovelStore((s) => s.saveEntity),
    deleteEntity = useNovelStore((s) => s.deleteEntity);
  const requestedType = searchParams.get("type") as StoryEntityType | null;
  const [mode, setMode] = useState<"documents" | "entities">(
      searchParams.get("mode") === "entities" ? "entities" : "documents",
    ),
    [sectionKind, setSectionKind] = useState<BibleSectionKind>("intent"),
    [entityType, setEntityType] = useState<StoryEntityType>(
      requestedType && entityTypes.includes(requestedType)
        ? requestedType
        : "character",
    ),
    [content, setContent] = useState(""),
    [saveState, setSaveState] = useState("已保存"),
    [selectedId, setSelectedId] = useState<string | null>(null);
  const makeEmpty = (type: StoryEntityType): SaveStoryEntityInput => ({
      novelId,
      type,
      name: "",
      summary: "",
      aliases: [],
      profile: { details: "" },
    }),
    [form, setForm] = useState<SaveStoryEntityInput>(makeEmpty("character"));
  useEffect(() => {
    void loadBible(novelId);
    void loadEntities(novelId);
  }, [loadBible, loadEntities, novelId]);
  const current = sections.find((item) => item.kind === sectionKind);
  useEffect(
    () => setContent(current?.content ?? ""),
    [current?.id, sectionKind],
  );
  useEffect(() => {
    if (!current || content === current.content) return;
    setSaveState("正在保存…");
    const timer = window.setTimeout(() => {
      void saveBible({ novelId, kind: sectionKind, content })
        .then(() => setSaveState("已保存"))
        .catch(() => setSaveState("保存失败"));
    }, 800);
    return () => clearTimeout(timer);
  }, [content, current?.content, novelId, saveBible, sectionKind]);
  const filtered = useMemo(
    () => entities.filter((item) => item.type === entityType),
    [entities, entityType],
  );
  if (!novel) return <Navigate to="/novels" replace />;
  function chooseType(type: StoryEntityType) {
    setEntityType(type);
    setSelectedId(null);
    setForm(makeEmpty(type));
  }
  function choose(entity: StoryEntity) {
    setSelectedId(entity.id);
    setForm({
      id: entity.id,
      novelId,
      type: entity.type,
      name: entity.name,
      summary: entity.summary,
      aliases: entity.aliases,
      profile: entity.profile,
    });
  }
  async function submit() {
    if (!form.name.trim()) return;
    choose(await saveEntity(form));
  }
  async function remove() {
    if (
      !selectedId ||
      !window.confirm(`确定删除“${form.name}”吗？此操作不可撤销。`)
    )
      return;
    await deleteEntity(novelId, selectedId);
    setSelectedId(null);
    setForm(makeEmpty(entityType));
  }
  return (
    <main className="bible-shell">
      <header className="bible-top">
        <NavLink to={`/novels/${novelId}/plan`}>
          <ChevronLeft size={17} />
          返回规划
        </NavLink>
        <div>
          <b>{novel.title}</b>
          <span>故事圣经 · {saveState}</span>
        </div>
        <div className="mode-switch">
          <button
            className={mode === "documents" ? "active" : ""}
            onClick={() => setMode("documents")}
          >
            核心文档
          </button>
          <button
            className={mode === "entities" ? "active" : ""}
            onClick={() => setMode("entities")}
          >
            故事实体
          </button>
        </div>
      </header>
      {mode === "documents" ? (
        <div className="bible-doc-layout">
          <aside>
            <div className="bible-mark">
              <WandSparkles />
              <span>
                <b>故事圣经</b>
                <small>长篇生成的事实基础</small>
              </span>
            </div>
            {sectionKinds.map((kind) => (
              <button
                key={kind}
                className={sectionKind === kind ? "selected" : ""}
                onClick={() => setSectionKind(kind)}
              >
                <span>{BIBLE_SECTION_LABELS[kind]}</span>
                <small>
                  版本{" "}
                  {sections.find((item) => item.kind === kind)?.versionNo ?? 1}
                </small>
              </button>
            ))}
          </aside>
          <section className="bible-editor">
            <span className="kicker">STORY BIBLE</span>
            <h1>{BIBLE_SECTION_LABELS[sectionKind]}</h1>
            <p>
              {
                {
                  intent: "明确主题、读者体验、主角欲望、故事承诺与最终方向。",
                  world:
                    "记录时代、地域、力量体系、社会规则和不可违背的世界逻辑。",
                  style:
                    "规定叙事视角、句式、节奏、对白、意象与需要避免的 AI 腔。",
                  boundaries:
                    "记录禁止情节、敏感边界、不可改变的设定和生成限制。",
                }[sectionKind]
              }
            </p>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={`在这里编写${BIBLE_SECTION_LABELS[sectionKind]}。后续 AI 生成每一章时都会引用它。`}
            />
            <footer>
              <span>
                <Check size={14} />
                {saveState}
              </span>
              <span>{content.replace(/\s+/g, "").length} 字</span>
            </footer>
          </section>
          <aside className="bible-guide">
            <div className="amy-avatar">
              <Sparkles />
            </div>
            <h3>Amy 建议</h3>
            <p>
              先写不可妥协的规则。正文可以变化，但正史只能由作者确认后更新。
            </p>
            <button>
              <Sparkles size={15} />让 Amy 生成初稿
            </button>
            <button>检查遗漏和冲突</button>
          </aside>
        </div>
      ) : (
        <div className="entity-layout">
          <aside className="entity-types">
            <b>实体类型</b>
            {entityTypes.map((type) => {
              const Icon = icons[type];
              return (
                <button
                  key={type}
                  className={entityType === type ? "selected" : ""}
                  onClick={() => chooseType(type)}
                >
                  <Icon size={17} />
                  {ENTITY_TYPE_LABELS[type]}
                  <span>
                    {entities.filter((item) => item.type === type).length}
                  </span>
                </button>
              );
            })}
          </aside>
          <aside className="entity-list">
            <div>
              <b>{ENTITY_TYPE_LABELS[entityType]}</b>
              <button
                onClick={() => {
                  setSelectedId(null);
                  setForm(makeEmpty(entityType));
                }}
              >
                <Plus size={15} />
                新建
              </button>
            </div>
            {filtered.length ? (
              filtered.map((entity) => (
                <button
                  key={entity.id}
                  className={selectedId === entity.id ? "selected" : ""}
                  onClick={() => choose(entity)}
                >
                  <span>{entity.name.slice(0, 1)}</span>
                  <div>
                    <b>
                      {entity.name}
                      {characterTierOf(entity) && (
                        <em className="tier-badge">
                          {CHARACTER_TIER_LABELS[characterTierOf(entity)!]}
                        </em>
                      )}
                    </b>
                    <small>{entity.summary || "暂无简介"}</small>
                  </div>
                </button>
              ))
            ) : (
              <p>还没有{ENTITY_TYPE_LABELS[entityType]}，创建第一个条目。</p>
            )}
          </aside>
          <section className="entity-editor">
            <span className="kicker">
              {selectedId ? "EDIT ENTITY" : "NEW ENTITY"}
            </span>
            <h1>
              {selectedId
                ? `编辑${ENTITY_TYPE_LABELS[entityType]}`
                : `新建${ENTITY_TYPE_LABELS[entityType]}`}
            </h1>
            <label>
              名称
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={`输入${ENTITY_TYPE_LABELS[entityType]}名称`}
              />
            </label>
            <label>
              别名
              <input
                value={form.aliases.join("，")}
                onChange={(e) =>
                  setForm({ ...form, aliases: e.target.value.split(/[，,]/) })
                }
                placeholder="多个别名用逗号分隔"
              />
            </label>
            <label>
              一句话简介
              <textarea
                rows={3}
                value={form.summary}
                onChange={(e) => setForm({ ...form, summary: e.target.value })}
              />
            </label>
            <label>
              详细设定
              <textarea
                rows={10}
                value={form.profile.details ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    profile: { ...form.profile, details: e.target.value },
                  })
                }
              />
            </label>
            <footer>
              {selectedId && (
                <button className="danger" onClick={remove}>
                  <Trash2 size={16} />
                  删除
                </button>
              )}
              <button className="primary" onClick={submit}>
                <Save size={16} />
                保存{ENTITY_TYPE_LABELS[entityType]}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}

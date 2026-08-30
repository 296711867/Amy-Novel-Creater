# AI 全自动小说工作流（Autopilot Agent）设计方案

> 目标形态：作者只提供 idea 并做终审，其余环节——故事圣经、人物体系、场景库、
> 分卷规划、章节标题与大纲、逐章正文、质量审查——全部由 Agent 流水线接力完成。
> 本文档是该工作流的设计基线，配合 `ROADMAP.md` Phase 3 实施。

## 1. 总体流水线

```
Idea（作者）
  │
  ▼
[Bible Agent]   故事圣经：创作意图/世界观/文风/创作边界 ─┐
[Cast Agent]    人物体系：主角/配角/酱油/龙套 + 名称库   ├─ 产出全部落库，作者可随时介入修改
[Scene Agent]   场景库：功能场景卡 + 复用规则            ─┘
  │
  ▼
[Structure Agent] 分卷规划 → 章节标题 + 章纲（逐章槽位）
  │
  ▼
[Chapter Loop]（复用现有批量生成调度器）
  ├─ Context Pack 组装（人物/场景按章纲相关性注入）
  ├─ 正文生成（GLM 等，思考模式可配）
  ├─ 确定性质量检查 + AI 审查
  ├─（可选）审查 error → 带反馈自动重生成 ≤N 次
  ├─（可选）达标自动采纳 → 事实提取回写正史
  └─ 下一章（上下文携带已入正史的最近正文）
  │
  ▼
终审（作者）：候选稿审阅 / 自动采纳的章节抽检 / Finding 处理
```

运行模式三档（`autopilot.checkpoint`）：
- **全自动**：跑完整个流水线不停（默认关闭自动采纳时的安全档：生成完等人审）
- **关键节点暂停**：每个 Agent 阶段产出后暂停，作者确认再继续（推荐）
- **每章暂停**：现有候选稿模式

## 2. 现状盘点（截至本设计时点）

| 能力 | 状态 |
|---|---|
| idea → 故事圣经 + 角色卡 | ✅ 已实现（规划页「AI 生成故事圣经与角色」） |
| AI 生成分卷 + **章节标题** + 章纲 | ✅ 已实现（规划页「AI 生成分卷与章节大纲」） |
| 逐章批量生成、暂停续跑、候选稿 | ✅ 已实现 |
| AI 审查、事实提取、正史回写 | ✅ 已实现（采纳后生效） |
| 人物分层（主角/配角/酱油/龙套） | ❌ 待建（当前所有角色一视同仁） |
| 题材名称库与查重 | ❌ 待建 |
| 场景卡与场景复用 | ❌ 部分（地点实体存在，无功能场景/复用概念） |
| 流水线编排（一键全自动） | ❌ 待建（现为手动逐步触发） |
| 审查驱动自动重写、自动采纳 | ❌ 待建 |

## 3. 人物分层体系（Cast Tiers）

### 分层定义

| Tier | 中文 | 卡片强度 | Context Pack 注入策略 | 正史追踪 |
|---|---|---|---|---|
| `protagonist` | 主角 | 完整卡：身份/性格/目标/秘密/语言习惯/成长弧线 | 常驻（高优先级） | 完整追踪（状态/时间线/伏笔） |
| `support` | 核心配角 | 完整卡（略简） | 常驻或章纲提及 | 完整追踪 |
| `recurring` | 酱油人物 | 一行定位 + 出现条件 + 与主角关系 | **仅章纲/章题提及才注入** | 轻量（仅时间线） |
| `extra` | 跑龙套 | 无卡，仅有名字 | 不注入 | **不追踪**（事实提取忽略 extra） |

### 名称库（Name Pool）

- 按题材维护「姓池 + 名池」（玄幻/都市/科幻/历史各一套，可自定义扩充）。
- 生成新名字时**强制查重**：与现有全部实体 name + aliases 比对，冲突则重抽。
- 用途：Structure Agent 生成章纲时为龙套/酱油起名；Chapter Loop 正文需要临时人物时由模型从池内取用，保证全书人名风格统一、绝不撞名。
- 存储：新增 `story_entities.type = "name_pool"` 单实体存 JSON 池，或独立表 `name_pools(novel_id, genre, surnames_json, given_names_json)`。**推荐独立表**（池会按题材增长，且需要跨作品复用选项）。

### 数据模型改动

`story_entities.profile` 增加 `tier` 字段（character 专用）；类型上扩展 `StoryEntityType`。无需迁移 SQL（profile 是 JSON 列，type 是自由字符串）。

## 4. 场景设定与复用（Scene Library）

### 场景卡（功能场景）

复用 `location` 实体，`profile` 约定字段：

```
功能     该场景承担的叙事功能（如：抛出选择题、发放奖励、日常喘息）
氛围     感官基调（视觉/听觉/气味锚点，保证多次出现描写一致）
视觉锚点  3-5 个固定细节（复用时必须出现的标志性元素）
常驻人物  通常在场者（关联实体名）
危险等级  用于生成冲突时的强度参考
```

### 复用规则

1. **相关性注入**：Context Pack 组装时，仅当章纲/章题文本命中场景名或别名时注入该场景卡（沿用「章纲提及才注入」原则，控制 token）。
2. **锚点一致性**：章节写作指令模板追加规则——同一场景重复出现时必须保留视觉锚点，禁止重构空间布局。
3. **场景登记**：事实提取阶段发现新地点时，除写入正史外同时生成「场景卡提案」（location 实体），作者确认后进入场景库，供后续复用。

## 5. 流水线编排（Workflow Runner）

- 新增 `workflow_runs` 表：`id, novel_id, mode(autopilot/checkpoint/chapter), current_phase, status, config_json, created_at, updated_at`，复用 generation_batches 的状态机与断点恢复模式。
- `WorkflowRunner`（main 进程，参照 BatchRunner）按序执行：
  `bible → cast → scenes → structure → batch(章节循环)`；
  每阶段产物先落库再进入下一阶段；`checkpoint` 模式在阶段边界暂停等待 UI 确认。
- 事件：阶段进度经现有 event-bridge 推送 renderer（复用生成进度通道模式）。
- 失败语义：单阶段失败重试 ≤2，仍失败则整个 run 暂停，UI 展示失败原因，可手动重入。

## 6. 审查驱动的自动重写与自动采纳

- **自动重写**：AI 审查返回 `severity=error` 的问题时，将问题清单附加进章节写作指令（「修改以下问题后重写」），重新生成候选稿，最多 `autopilot.maxRewrites`（默认 2）次。旧候选稿保留可对比。
- **自动采纳**（默认关）：候选稿满足 全部条件 才自动接受——确定性检查 0 error、AI 审查 0 error、字数 ≥ 目标 90%。开启时 UI 明示风险；自动采纳的章节在书架标记「自动」，便于作者抽检回滚（版本快照已支持）。

## 7. 实施分期

- **P3.1 人物与场景基座**：tier 字段 + 名称库表与查重 + 场景卡字段约定 + Cast/Scene Agent 提示词与落库；圣经页/实体页编辑支持分层筛选。
- **P3.2 Workflow Runner**：workflow_runs + 一键流水线（三档检查点模式）+ 阶段进度 UI。
- **P3.3 自愈与自动采纳**：审查重写循环 + 采纳阈值 + 标记与回滚。
- **P3.4 上下文相关性优化**：人物/场景按章纲提及过滤注入；token 预算精细化（酱油人物不占常驻预算）。

## 8. 与现有模块的映射

| 新概念 | 落点 |
|---|---|
| Cast tiers | `story_entities.profile.tier` + `@domain/planning` 扩展 schema |
| 名称库 | 新表 `name_pools` + `@domain/name-pool.ts`（生成/查重纯函数） |
| 场景卡 | `location` 实体 profile 约定 + `@domain/scene-card.ts` |
| Autopilot | `workflow_runs` + `src/main/generation/workflow-runner.ts` |
| 自动重写/采纳 | `batch-runner.ts` 扩展 + `GenerationPolicy.autopilot` 配置组 |

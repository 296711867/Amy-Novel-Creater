# AI 主笔操控写作工作流记录（实验性工具笔记）

> **性质声明**：本文档记录的是一次"AI 作为主笔、通过本软件管理创作"的实验工作流，
> 属于外部工具笔记，**不是产品功能承诺**。文中涉及的 `scripts/amy-author-model.mjs`
> 是实验脚本，不属于产品代码、不随发布。
> 记录时间：2026-09-07。成果：《泊星港：禁航之海的少年船长》120 章完本（97,840 字）。

---

## 0. 成果快照（续作前先读这里）

| 项 | 值 |
| --- | --- |
| 作品 | 泊星港：禁航之海的少年船长（novelId `0S746TcrnwsqS9fPvlZWA`） |
| 章节 | 120/120 章全部入正史，卷一~卷三完整闭环 |
| 总字数 | 97,840（扩写进行中，目标 2400 字/章 ≈ 288K） |
| 人物/时间线/伏笔/角色状态 | 18 名 / 97 条 / 74 条 / 66 条 |
| 数据位置 | 浏览器 IndexedDB（`amy-novel` 库 kv store，键 `amy-novel:*`） |
| 备份 | 工作区 `backups/` 共 6 份，最新 `boxport-backup-v6-expanded.json` |
| 创作引擎 | `scripts/amy-author-model.mjs`（本地 8990 端口，含全部策划包+正文+事实提案） |
| 剩余工作 | 第 31–70 章扩至 2000+；71–120 章二次深化；11–30 章冲刺 2400 |

各章字数分布（2026-09-07 实测）：1–10 平均 2219；11–20 平均 1551；21–30 平均 817（已增强）；
31–70 平均 615–800；71–120 平均约 450–510（骨架已救活）。

---

## 1. 核心机制：作者模型（Author Model）

### 1.1 原理

软件的生成管道必须走"模型生成 → 作者审核 → 入正史"。不接真实 API 的方案：
**起一个本地 OpenAI 兼容服务，里面返回的"生成结果"全部由 AI 主笔预先写好**。
软件发 HTTP 请求 → 作者模型返回亲笔内容 → 走正常正史门禁入正史。
零 API 费用，所有一致性校验、版本快照、正史门禁照常生效。

### 1.2 启动与配置

```bash
AMY_AUTHOR_PORT=8990 node scripts/amy-author-model.mjs   # 作者模型
pnpm dev:web                                              # 软件（5173）
# 软件设置页 → 新增模型：
#   供应商 OpenAI 兼容 / Base URL http://127.0.0.1:8990/v1
#   模型 ID amy-author / Key 任意 / 勾选"设为默认写作模型"
```

### 1.3 阶段路由（phaseOf）

作者模型按提示词关键词区分阶段，**调试时务必逐阶段 curl 验证**：

| 提示词特征 | 阶段 | 返回 |
| --- | --- | --- |
| 含"续写第 N 章" | prose | `CHAPTER_PROSE[N]` 流式（⚠️ 必须在 stream 分支） |
| 含"小说正史记录员" | facts | `CHAPTER_FACTS[N]` JSON |
| 含"小说编辑审稿人" | review | `{issues:[]}` |
| 含"总策划/只规划第 X–Y 章" | structure | `CYCLE{N}` 策划包（**必须加对应路由分支**） |
| 含"人格策划/人格阵容" | persona | 人物格 JSON |
| 含"人物分层/完整人物体系" | cast | 人物体系 JSON |
| 含"场景与实体设计师" | scenes | 场景卡 JSON |
| 含"开书简报代笔/开书顾问/小说文风分析师" | brief/advisory/style | 对应 JSON |

### 1.4 数据结构（脚本内五大数据块）

- `CYCLE1..CYCLE12`：十二个周期的策划包（volumes/cycle/chapters/proposals）
- `CHAPTER_PROSE`：各章正文（流式生成用）⚠️ 必须在 `CHAPTER_PROSE` 块内，放错块静默返回占位
- `CHAPTER_EXTRA`：各章收尾段（**非流式**补写请求用——软件字数不足补写走非流式！）
- `CHAPTER_FACTS`：各章事实提案（时间线/角色状态/伏笔）
- structure 路由：`if (start === 1 && end === 10) return CYCLE1` 式分支，**每加新周期必须同步加分支**（踩过两次坑）

### 1.5 稳定引用映射

策划包里的人物/场景写名字，运行时用 `refMapFromPrompt(prompt)` 从提示词目录解析成
`E-XXXXXXXX` 稳定引用（软件规划提示词格式：`E-XXX [type] 名称（别名）：摘要`）。

---

## 2. 六大工作流

### 2.1 周期循环（每 10 章一轮，共 12 轮）

```
第7步 生成策划包 → 确认这一步
第8步 接受全部"接受并写入设定"提案(3条) → 确认这一步
第9步 通过总检 → 自动到第10步
第10步 配置批次(起X终Y) → 创建生成任务 → 开始生成
逐章循环：等~26s生成 → 选章 → 忽略(审阅警告) → 接受并写入正文 → 继续生成下一章
最后章接受后点"继续"完结批次
→ 连续性页补录记忆 → 第10步"由本批记忆生成" → "确认记忆回写，规划下一批" → 下一周期
```

**关键经验**：
- 向导可能因编辑角色卡回退到第 4 步——逐步重新确认 4→9 即可（每步点"确认这一步"，第 9 步点"通过总检"）。
- 批次卡死（接受后"继续生成下一章"无响应）→ 停止 → 删除记录 → 重新生成策划包 → 重建批次。
- **策划包数据在批次创建时就固化**——如果策划包是占位版，删批次重建没用，必须回第 7 步点"重新生成"再走 7–9 步。

### 2.2 批量生成驱动（浏览器自动化要点）

单章接受续跑的完整序列（页面在 #/batches）：

```js
// 等生成完成(~26s)后：
选章:  buttons.find(b => b.textContent.includes(`${n}. 第${n}章`)).click()
忽略:  buttons.find(b => b.textContent.trim() === '忽略')?.click()
接受:  buttons.find(b => b.textContent.trim() === '接受并写入正文').click()
续跑:  buttons.find(b => b.textContent.trim() === '继续生成下一章' && !b.disabled).click()
```

- 删除批次有原生 confirm 弹窗，**必须在同一 JS 单元内"点击+轮询 getJsDialog+accept"**，
  否则弹窗挂起会冻结整个页面（超时 32s 的元凶）。
- 原生 confirm/`window.confirm` 类弹窗（删除批次、全局修订替换）都要这种同步处理法。

### 2.3 记忆补录（每周期 10 章后）

连续性页（#/novels/:id/continuity）三张表单轮流填：

1. **时间线**：故事内时间/关联章节/标题/详情/参与角色(多选 select.multiple)
2. **伏笔**：名称/设计与预期回报/埋设章节/回收章节/状态(待埋设|已埋设|发展中|已回收|已放弃)
   - 状态选"已回收"时填回收章节，形成闭环
3. **角色状态**：角色/截至章节/摘要/位置/情绪/身体/外貌/衣着/身份/已知信息(\n分隔)/目标(\n分隔)/物品(\n分隔)

**注意**：表单字段是普通字符串（\n 分隔多行），不要传数组（.join 报错）。
保存后表单切"编辑"模式——录入下一条前需先点页签回到"新增"模式。

### 2.4 扩写管道（本轮新建，最高效）

```
1. AI 写增强正文 → .tmp-batch.json（JS 字面量 {章号: "正文"}）
2. node 解析验证字数 → 复制到 public/expand.json（vite 自动静态服务 /expand.json）
3. 页面 evaluate: fetch('/expand.json') 取数据
4. 循环每章: location.hash = 编辑页URL → 等 textarea[1] →
   用 value setter 赋值 → dispatch input → 点"保存版本"（每次保存留版本快照可回滚）
5. 清理 public/ 和临时文件
```

**经验**：
- 替换后走 `#/novels/:id/book` 连读页批量抓各章字数核验；
- 页内循环做多章容易 32s 超时——**每 JS 单元最多 3–5 章**，超时后回来看字数往往实际已保存成功（保存先于超时）；
- textarea 赋值必须用 `Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set` 原生 setter + input 事件，直接 `.value=` React 不认。

### 2.5 全局修订（清污染文本）

连读页（#/book）"全局修订"：查找框填污染串 → 替换为留空 → 出现逐章"替换 N 处"按钮 →
点替换有 confirm 弹窗（同步处理法同上）。曾用于清除补写 bug 造成的 3 处 `{"error":...}` 污染。

### 2.6 备份导出

#/data → "备份项目数据包" → 浏览器下载（临时 .tmp 文件）→ 复制到 `backups/` 命名归档。
项目包是 JSON（format `amy-novel-project`），含 19 类数据（chapters/versions/bible/entities/
timeline/foreshadow/characterStates/candidates/planningRuns/planningCycles/planningProposals 等）。
**每个周期结束、每次大扩写后都应导出**——浏览器 IndexedDB 是唯一热数据。

---

## 3. 发现并修复的产品 Bug（可入库）

| # | Bug | 根因 | 修复 | 验证 |
| --- | --- | --- | --- | --- |
| 1 | 接受候选稿后"继续生成下一章"永久禁用 | `web-platform.ts` 的 `reviewWebCandidate` 已把 job 翻成 completed，但 store 内存 jobs 不刷新，`awaitingBlocker` 用旧状态渲染禁用按钮 | `novel-store.ts` 的 `reviewCandidate` 尾部同步 `loadJobs+loadBatches` | pnpm check 247 测试全绿 + 实测连跑 |
| 2 | 字数不足补写把错误 JSON 追加进正文 | 补写走**非流式**请求；作者模型最初只实现流式 prose | 作者模型补非流式分支返回 CHAPTER_EXTRA | 全局修订清除 3 处污染 |

（Bug 1 的修复改动了产品代码 `src/renderer/src/store/novel-store.ts`，未提交，待正式验收。）

---

## 4. 无头写作分析（heads-free authoring）

### 4.1 现状：为什么浏览器自动化是瓶颈

本轮实测的痛点全部来自浏览器层：
- playwright 32s 超时（confirm 弹窗挂起、页面内循环过长）
- UI 状态依赖（向导回退、批次卡死、弹窗冻结）
- 每章一次"等26s→点4下"的循环，50 章 ≈ 100+ 次工具调用
- 扩写也要走页面 textarea

而**内容生产本身（写策划/正文/事实提案）不依赖浏览器**——只占少数 token。

### 4.2 架构依据：本仓库天然支持第三宿主

`AGENTS.md`/`TECHNICAL_ARCHITECTURE.md` 的分层约定：
`src/domain`（纯规则零依赖）+ `src/application`（用例与端口）与宿主解耦，
双端实现同一个 `PlatformPort`。**新增一个 Node 宿主（NodePlatformPort）在架构上是允许的**
（"新增端口时同步更新两端和契约测试"）。

关键事实：
- 规划提示词构建（`planning.ts`）、JSON 解析校验（`parseStructurePlan`/`assertCompleteStructurePlan`）、
  策划应用（`applyNovelPlan`）、事实提案解析、续写提示与拼接（`chapter-generation.ts`）全在
  domain/application 层，纯函数可直接 import；
- 生成循环的核心编排目前在 renderer 的 `runBatch`（zustand store 方法），但它本质是对
  platform 调用的顺序编排，可提取；
- Web 存储绑定浏览器 IndexedDB，但 Node 侧可用 fake-indexeddb（已是 devDependency）
  或直接文件存储实现 `PlatformPort`。

### 4.3 无头方案设计（Node Author Runner）

> **✅ 已实现（路径 A）**：`scripts/author-headless.mjs`，2026-09-07 全链路测试通过。

```
node scripts/author-headless.mjs status backups/boxport-backup-v6-expanded.json
node scripts/author-headless.mjs expand backups/pkg.json texts.json -o backups/pkg-v7.json
node scripts/author-headless.mjs apply  backups/pkg.json manifest.json -o backups/pkg-v7.json
```

能力（对项目数据包直接加工，产出新包）：
- `status`：各章字数分布 + 低于 2000 字章节统计
- `expand`：批量替换正文（`{"31": "新正文", ...}` 按章号）；**自动重算字数（与软件
  `countCjkWords` 完全一致的非空白字符算法）+ 追加 origin=manual 版本快照**，软件内可回滚
- `timeline`：按人物名自动解析实体 ID（不存在的名字告警跳过）、按章号解析 chapterId
- `foreshadow`：中文状态自动映射枚举（已埋设→planted / 已回收→resolved…），已回收自动校验回收章节
- `state`：knowledge/goals/inventory/skills 接受数组或 `\n` 分隔字符串
- `apply`：一个 manifest 同时执行 `{expand, timeline, foreshadow, state}`

**无头扩写工作流（替代 §2.4 浏览器管道）**：
AI 写正文 → manifest.json → `author-headless.mjs apply` 一条命令出 v7 包 →
软件"恢复项目数据包"导入验收（或继续归档）。浏览器只留给人工审核/连读/导出。

**注意**：恢复导入会生成带"（恢复）"后缀的新作品——正式替换原作时，
导出新作品的备份并作为最新归档即可（数据同构，仅 novelId 不同）。

路径 B（NodePlatformPort + 提取 runBatch 编排，走全部正史门禁）仍为中期方向：


```
scripts/author-runner.mjs（新，实验性）
├─ NodePlatformPort：实现 PlatformPort（文件库 .author-workspace/ 或复用备份 JSON 直改）
├─ 模型客户端：直接调 127.0.0.1:8990（作者模型），复用其全部数据块
├─ 循环编排（从 runBatch 提取的纯逻辑）：
│   plan(range) → applyNovelPlan → 总检
│   for 每章: buildContext → 生成流式正文(可省) → 质检 → acceptChapterCandidate
│             → facts 提案 → 逐条 accept
│   sealCycle(实际结束状态) → 下一周期
└─ 扩写模式：expand(chapter, newProse) → saveChapter + 版本快照
```

两条实现路径：

| 路径 | 做法 | 工作量 | 优点 | 风险 |
| --- | --- | --- | --- | --- |
| A. 纯数据直改 | 解析备份 JSON → 直接改 chapters/记忆 → 导回软件 | 小（1 个脚本） | 无需实现 Port；离线批量最快 | 绕过正史门禁/版本快照，需自建审计；导回产生"（恢复）"副本 |
| B. Node 宿主 | 实现 NodePlatformPort + 提取 runBatch 编排 | 中（Port 约 20+ 方法） | 走全部正史门禁、版本快照、契约测试可复用；真正合规的无头 | runBatch 提取需动 renderer 代码，需测试保障 |

**推荐**：短期用 A 做扩写批处理（扩写本就是作者直接改正文，软件的"全局修订"也是这个语义）；
中期做 B，把本轮验证过的"接受→续跑"逻辑下沉到 Application 层，顺便解决浏览器端的同源问题
——这同时是一个正当的产品增强（`BACKLOG.md` 可立项：无头/CLI 创作运行器）。

### 4.4 无头的收益量化（按本轮实测）

| 环节 | 浏览器自动化 | 无头 |
| --- | --- | --- |
| 生成并接受 10 章 | ~14 次工具调用（含超时重试） | 1 次进程运行 |
| 扩写 50 章 | ~15 次调用 + 超时风险 | 1 次脚本运行 |
| 记忆补录 30 条 | ~6 次调用 | 脚本内瞬时 |
| confirm 弹窗挂起 | 常见故障源 | 不存在 |

结论：**无头写作显著更优**，尤其对"AI 主笔连续产出"这种批量场景；
浏览器/软件 UI 保留给"人工审核、连读、导出"环节——这正是软件的正史门禁设计意图：
机器写、人审、门禁守。

---

## 5. 下次续作指南（Resume Playbook）

1. **环境**：`node scripts/amy-author-model.mjs`（8990）+ `pnpm dev:web`（5173）+
   浏览器打开 app 并确认设置里默认模型是"作者模型"。
2. **恢复数据**：若 IndexedDB 空 → #/data"恢复项目数据包"导入 `backups/boxport-backup-v6-expanded.json`。
3. **扩写续作**（优先级 31–70 → 71–120 → 11–30）：
   **优先用无头工具**（§4.3）：AI 写 manifest → `node scripts/author-headless.mjs apply backups/最新包.json manifest.json -o backups/v7.json`
   → 导入软件验收。浏览器管道（§2.4）仅作备用。每次批量后 `status` 核验 + 递增备份命名。
4. **新周期写作**（若开新书/续篇）：按 §2.1 周期循环；作者模型加 CYCLE13+ 时
   **必须同步加 structure 路由分支 + CHAPTER_PROSE + CHAPTER_EXTRA + CHAPTER_FACTS 四处**。
5. **调试口诀**：服务器行为异常先 `curl 127.0.0.1:8990` 分阶段验证；页面卡死先查
   `getJsDialog`；批次异常先删记录再看策划包是否要"重新生成"。

## 6. 《泊星港》故事要件速查（续写/扩写时保持一致）

- 主角：岑野舟（16，ESTP 船匠，起锚锤）；船灵阿泊+林晚照（双魂）；领航员洛云雀（INTJ）；
  战力巴图（星化已愈）；船医半夏（ENTJ 记账）；聂镇川（前第七桅首）；白鸦（前缉航卫队长）。
- 世界：云海（十二船岛）→ 新海（星骸/泊星港十二锚位）→ 旧海（十二锚港星海）。
- 力量：星髓契约九阶（锚缆舵帆桅灯辰枢泊）+ 星化代价。
- 大结局状态：群星归位完成，初火号=第十三锚位（天上），阿泊萤纹留在白鲸号，
  星化全面逆转，续篇接口=十二港全图边缘的"新世界"坐标。
- 全书主题句：「把灯还回去。别怕黑。」/ 终章句：「去没人的海。把灯，点到最远的地方。」

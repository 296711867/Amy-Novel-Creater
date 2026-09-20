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

### 5.1 全自动巡航新书实跑记录（2026-09-11，Web 端 + 作者模型）

- **做法**：新建同设定作品「（巡航版）」（120 章 / 单章 1100 字 / 每批 10 章），
  向导 1–9 步全由作者模型生成 + 浏览器逐步确认（约 5 分钟），第 10 步开启
  「全自动巡航」目标第 20 章。两个周期（1–10、11–20）自动规划→建批→连写→
  自动接受→封存，全程约 16 分钟，20 章全部入正史、字数与 `CHAPTER_PROSE`
  逐章一致，无补写污染；备份 `backups/boxport-cruise-20260911-ch1-20.json`。
- **单章字数为何设 1100**：自动接受有 90% 字数门，前 20 章预写正文最短 1026 字
  （第 15 章）；1100×0.9=990 全部过门，且不触发 60% 以下的补写请求。
  续写 21 章以后请先用 `CHAPTER_PROSE` 统计该区间最小字数再定 chapterWords。
- **两次人工介入**（产品缺陷，已登记 BACKLOG AN-042 / AN-043）：每个周期收尾时
  自动审阅按"本批完成"自停 → 巡航误判为质量门停机而 paused；封存后向导退回
  第 7 步，巡航卡片不可见，需手工过 7→9 步后再点「继续巡航」；第二周期还需在
  生成工作台手动重开「自动接受并连续创作」把 10 章候选收进正史。数据零损失。
- **作者模型 facts 路由修复**：软件的事实提取提示词只带正文不带章号，旧路由
  `/第(\d+)章/` 永远落空 → 20 章记忆库为 0 条（此前 120 章的记忆全是手工补录）。
  现已改为按正文开头反查章号（`chapterNumberByProse`），curl 验证 1/10/11/20/21 章
  均命中对应 `CHAPTER_FACTS`。巡航版 1–20 章的记忆仍为空，续跑前可用
  `author-headless.mjs apply` 按 `CHAPTER_FACTS` 补录后导入。

### 5.2 全自动巡航 120 章完本（2026-09-12，Web 端 + 作者模型）

- **成果**：「（巡航版）」在一天内续完 21–120 章，120/120 全部入正史、12 个周期
  全部封存，总字数 66,380；正史记忆 80 实体 / 40 时间线 / 33 伏笔 / 19 角色状态
  （facts 路由修复后 21–60 章自动产出；61–120 章作者模型无 CHAPTER_FACTS 数据，
  记忆为空属预期）。备份 `backups/boxport-cruise-20260912-complete-120chapters.json`。
- **本次修复的三个产品缺陷**（详见 BACKLOG AN-042/043/044）：巡航对自动审阅
  "本批完成"自停的误判暂停；巡航卡片在向导退回第 7 步后不可达；Web 端页面刷新
  杀死生成请求后任务永停 generating、接管把批次收成 completed 留下黑洞章。
  修复后 41–120 章全程无人值守。
- **运维铁律**（Web 端跑批时）：
  1. **绝不刷新/关闭跑批页面**——批次在渲染进程内执行，刷新即中断（AN-044 的
     修复只能事后自愈，中断那一章会重生成，但正在写的请求作废）；
  2. **后台页面定时器被深度节流到 1 次/分钟**（Electron webview 对遮挡页面），
    巡航/自动审阅会慢 30 倍——本次用同源 Worker 驱动 `tickCruise`/`tickAutoReview`
    绕过（临时脚本，已删；长期方案可考虑把编排定时器挪进 Worker 或页面可见性提示）；
  3. 监控读状态用页面内 `evaluate` 直查 store/IndexedDB 即可，不要 reload；
  4. 单章字数门：作者模型 71–120 章是骨架稿（最短 56 字），作品 chapterWords
    已调到 60 使 90% 门全过；扩写后应回调。

### 5.3 软件内批量扩写 71–120 章（2026-09-12，全流程闭环）

- **做法**：不走离线数据包，直接驱动软件自己的写作链路——页面内桥接拿到
  `useNovelStore`，对每章先 `createSnapshot`（骨架稿留版本快照，可回滚）再
  `saveChapter` 写入扩写正文（与写作台「保存版本」按钮完全同一链路），连读页
  核字数，最后在导出页出备份。50 章（71–120）分五波完成，每波：提取章纲与
  骨架 → 主笔成稿（骨架事件逐句保留）→ 写入 → 验收。
- **成果**：全书 120/120 章入正史、总字数 66,380 → 91,944；71–120 章从
  56–149 字骨架扩至 474–756 字（均值约 600）；版本快照 120 → 170（每章骨架
  稿均有回滚点）。备份
  `backups/boxport-cruise-20260912-expanded-120chapters.json`。
- **批量写入的工程细节**：正文经 `public/__expand.json` 由页面 fetch 获取
  （vite 静态服务）；每 5 章一批防止页面求值超时；写作期间**不刷新页面**
  （§5.2 铁律）；写入后用 IndexedDB 直读做终验（连读页同 URL goto 会恢复
  冻结渲染，需 `reload()` 才显示新字数——IAB 已知怪癖）。
- **对照**：本次软件内链路 50 章约 20 分钟（含写作），与 §4.3 的离线路径 A
  相比慢在逐章双写（快照+保存），但换来版本快照与零导入副本——正式修订
  优先这条链路，批量草稿加工仍可用 headless。

### 5.4 全书字数达标改造（2026-09-13，番茄上架标准）

- **目标**：单章 ≥2000 字（番茄上架硬线），全书 120 章约 24 万字。
- **软件修复（AN-046～053）**：重放已封存周期的完整链路——①巡航复用已
  就绪策划包时仍执行十步代签（AN-046）；②封存判定改看候选状态而非任务
  状态，新稿未入正史不冲线（AN-047）；③自动接受接受前改指同章最新候选
  （AN-049）；④封存前按门禁同口径消化残留正史建议（AN-050）；⑤运行
  一律新建自有批次，不复用历史批次（AN-051）；⑥封存前校验「本轮生成
  章节」的最新候选已接受（AN-052）；⑦新增 clearWorkflowRuns 产品动作，
  startCruise 自动清理陈旧运行索引（AN-053）。
- **测试替身修正**：作者模型升级为长度自适应——按提示词「目标约 N 字」
  从章纲确定性扩写到达标（此前无视字数要求返回固定短文，字数门必挂）。
  替身内容是结构性填充文，只验证链路；正式写作请接真实模型。
- **成果**：120/120 章经软件自动链路（生成→90% 字数门→AI 审查→事实
  提取→自动接受→封存）全部达标：全书 242,437 字，单章最短 1816，
  零低于 1800；版本快照 477 个。书稿《书稿/泊星港-巡航版-全120章-达标版.md》，
  备份 backups/boxport-cruise-20260913-standard-120chapters.json。
- **注意**：单章 targetWords 随作品 chapterWords 全局生效；改字数标准后
  已有章节需重跑才会按新标准生成（字数门对存量不追溯）。

## 6. 《泊星港》故事要件速查（续写/扩写时保持一致）

- 主角：岑野舟（16，ESTP 船匠，起锚锤）；船灵阿泊+林晚照（双魂）；领航员洛云雀（INTJ）；
  战力巴图（星化已愈）；船医半夏（ENTJ 记账）；聂镇川（前第七桅首）；白鸦（前缉航卫队长）。
- 世界：云海（十二船岛）→ 新海（星骸/泊星港十二锚位）→ 旧海（十二锚港星海）。
- 力量：星髓契约九阶（锚缆舵帆桅灯辰枢泊）+ 星化代价。
- 大结局状态：群星归位完成，初火号=第十三锚位（天上），阿泊萤纹留在白鲸号，
  星化全面逆转，续篇接口=十二港全图边缘的"新世界"坐标。
- 全书主题句：「把灯还回去。别怕黑。」/ 终章句：「去没人的海。把灯，点到最远的地方。」

## 7. Mock 作者模型时代收口与真实 API 切换（2026-09-18）

**决定：本地确定性作者模型退役，后续写作一律走真实模型 API。**

### 7.1 Mock 时代成果归档（2026-09-17，全部经完整巡航链路达标）

| 书 | 弧线 | 结果 | 导出 |
| --- | --- | --- | --- |
| 《泊星港·巡航版》 | 星海冒险 | 244,810 字 / 最短 1816 / 零重复段（AN-042~056 收口期） | 书稿/泊星港-巡航版-全120章-达标版.md |
| 《灯匠与雾海》 | 雾海点灯治愈冒险 | 244,969 字 / 最短 2000 / 2688 段零重复（AN-057/058） | 书稿/灯匠与雾海-全120章-达标版.md |
| 《万纹忍尊》 | 火影×斗罗风升级流 | 245,626 字 / 最短 2000 / 2657 段零重复（AN-059） | 书稿/万纹忍尊-全120章-达标版.md |

三本书的价值是**链路验证**（规划→生成→审阅→封存→导出的全自动闭环、
重复段治理、跨书隔离、重放机制），不是文学成品。mock 服启动方式
（已退役）：`AMY_AUTHOR_PORT=8991 node scripts/amy-author-model.mjs`。

### 7.2 切换操作记录（2026-09-18 08:4x）

1. 杀掉 8991 本地作者模型进程（mock 时代结束）。
2. 应用设置页将模型档替换为真实 API：智谱 GLM-5.2（Coding Plan 订阅，
   `https://open.bigmodel.cn/api/coding/paas/v4`），Key 存应用密钥库
   （hasSecret=true），设为默认档。
3. 应用内 `testModelConnection` 实测连通通过。
4. 删除 mock 版《万纹忍尊》（novelId 971Dlg_1Z3WKzBMmJHvCc，书稿与
   项目包均已归档），以同一设定全新建书，`startCruise(120)` 走真实模型
   全自动巡航（wizard 十步仍由巡航代签）。

### 7.3 真实 API 巡航注意事项（对比 mock 的差异）

- 规划阶段（简报/圣经/人物/场景/策划包）为真实模型生成，不再受
  `scripts/amy-author-model.mjs` 三书路由控制；该脚本的 NEW_BOOK_* 数据块
  自此仅作设定参考，不再被线上请求触达。
- 真实响应可能触发 AN-004 低温修复（一次）后仍失败 → 巡航暂停并留原因，
  按「继续巡航」续跑即可；字数门（90%）与 AI 审查 error 级 findings 同样
  会暂停转人工，这是设计行为不是缺陷。
- 速度从 mock 的 ~30 秒/章变为 ~1-2 分钟/章（视网络与排队），全书预计
  2~4 小时；费用由 API 账户承担（用户已明确授权）。

### 7.4 首次真实 API 巡航完本记录（2026-09-19～20）

**《万纹忍尊》novelId JnxaVB8GBDJmRNhiS-I9N，真实 GLM-5.2（Coding Plan）全程生成，120/120 章入正史、12/12 周期封存。**

- 成果：251,365 字、单章 1802–2998、零章低于 1800 字门、120 标题全唯一、
  长文段首跨章查重 0（仅 4 处短节拍句风格性复现）、英文残留 7 处已清
  （originally/foot/scrape/sled×3/second，经 reviseChapterContent 逐章替换）。
- 真实模型适配六缺陷与修复见 BACKLOG AN-060（thinking 烧 token、预算不足、
  facts 截断/非法 JSON/payload 类型、AN-048 镜像空读）。
- 质量门实战：7 处 error 级拦截全部由操作员以作者代理身份处置——人名错乱
  （41/77 章石大力系）、时间线矛盾（55 章「七年/十年」）、场景漂移（82/97 章
  重写）、字数不足重写（71/97 章）、标题不符（117 章）、设定矛盾甄别（112 章
  「旧物 vs 遗物」以正文为准）。全部处置走应用内正史路径，留修订快照可回滚。
- 遗留待办（记入 AN-060）：Web 端 sessionStorage 会话密钥在 IAB 重载后丢失
  （长跑需值守重填，建议产品化改进）；重写残留僵尸任务与封存门的互锁需人工
  清理（建议：任务改指最新候选后自动收敛）。
- 导出：`书稿/万纹忍尊-真实GLM5.2-全120章.md`、
  `backups/万纹忍尊-真实GLM5.2.amy-novel.json`。

## 8. 真实模型全自动制作一本书：操作手册（Playbook）

> 2026-09-20 由《万纹忍尊》首次真实 API 全程实战沉淀（AN-060）。
> 适用场景：Web 端 + 智谱 GLM Coding Plan（或任意 OpenAI 兼容真实模型），
> 从 0 到 120 章完本 + 导出 + 提交。下一本书照本宣科即可。

### 8.0 前置检查清单（开跑前 5 分钟）

1. **模型档**：设置页确认默认档为真实模型（如「智谱 GLM（Coding Plan 订阅）」，
   `open.bigmodel.cn/api/coding/paas/v4`），Key 已填（Web 端 Key 存 sessionStorage，
   见 8.5 故障 #1）。有「测试连接」结果成功。
2. **mock 服已死**：`curl http://127.0.0.1:8991` 必须拒绝连接（作者模型已退役，
   谁再起 8991 就是在造 mock 书）。
3. **桥接文件**：`cp scripts/dev-helpers/__*.js public/`（public/ 不存在则先 mkdir）。
4. **dev 服务器**：`pnpm dev:web` 后台起（5173）；长跑建议用守护循环
   （vite 偶发自退，见 8.5 故障 #7）：
   `while true; do pnpm dev:web >> .tmp-vite.log 2>&1; sleep 3; done &`
5. **浏览器**：ZCode 内置浏览器开 `http://localhost:5173`，**整个巡航期间
   标签页保持打开、不导航、不刷新**（否则 Key 丢 + 巡航断）。
6. **费用确认**：真实 API 按量计费，一本书（120 章 × 2000 字）实测消耗
   数百万 tokens，开跑前确认账户额度。

### 8.1 建书与开跑（2 分钟）

浏览器 DevTools 或自动化脚本在页面上下文执行（桥接已就位）：

```js
// 1) 建书（premise 决定全书走向，写足卖点/矛盾/结局方向）
const novel = await store.getState().createNovel({
  title: "书名", genre: "玄幻",
  premise: "世界观 + 主角 + 金手指 + 主线矛盾 + 结局方向 + 平台节奏要求",
  targetChapters: 120, chapterWords: 2000, cycleSize: 10,
});
// 2) 开巡航（目标=总章数；wizard 十步由巡航自动代签）
await store.getState().startCruise(novel.id, 120);
// 3) 装心跳（绕过后台节流；每次页面刷新后需重装）
const w = new Worker("/__tick_worker.js");
w.onmessage = () => {
  const s = window.__store.getState();
  try { void s.tickCruise(novel.id); } catch (e) {}
  try { void s.tickAutoReview(novel.id); } catch (e) {}
};
w.postMessage({ cmd: "start", ms: 2000 });
window.__driver = w;
```

### 8.2 监控节奏与判读（每 5–10 分钟一查）

读状态三件套：`cruise[记录].status/message`、accepted 章数
（`chapters` 过滤 novelId + status==="accepted"）、最新批次状态。
注意 store 的 chapters/workflowRuns/planningCycles 是**对象不是数组**，
用 `Object.values(x ?? {}).flat()` 展开。

| 周期形态 | 正常耗时 | 判读 |
| --- | --- | --- |
| 规划（structure 阶段） | 2–6 分钟 | message 含「本轮检查耗时较长」即正常等待 |
| 生成 10 章 | 15–25 分钟 | 批次事件「候选稿已保存：N 字」逐章推进 |
| 自动接受入正史 | 生成完稍滞后 | accepted 追到本周期 +10 即收齐 |
| 封存 + 下一周期 | 1–3 分钟 | 「第 X–Y 章已封存，开始规划…」 |

**120 章全程实测约 5.5 小时**（含事故处置；纯净跑约 4 小时）。

### 8.3 恢复套餐（巡航暂停时的标准动作）

巡航 paused 时先读 `cruise.message` 定类，再执行对应套餐。所有套餐都先
「重挂桥接/心跳」（页面可能已重载），统一收尾 `resumeCruise`（cruise 条目
不存在则 `startCruise(novelId, 120)`）。

**通用前置**：Key 检查（8.5 #1）→ `testModelConnection`（注意读返回体
`result.ok`，它不抛错！）→ 取消 failed 批次（`setBatchStatus(id,"cancelled")`）
→ 处理 pending 提案 → `clearWorkflowRuns` → resume。

**提案批处理**（pause 原因含「设定提案」）：
```js
for (const p of pendingProposals) {
  try { await s.reviewPlanningProposal(novelId, p.id, true); }   // 先试接受
  catch { try { await s.reviewPlanningProposal(novelId, p.id, false); } catch {} } // 重名等再拒
}
```

**质量门 error**（pause 原因含「error 级检查问题」）：读该章最新候选的
findings（`platform.listFindings`）分三类处置：
- **可文本修复**（人名错乱/编号/时间线数字/英文残留）→ 定位锚点后
  `editCandidateContent` 精确替换 + `updateFinding(id,"resolved")`；
- **字数/情节性问题** → `setBatchStatus(batchId,"running")` +
  `regenerateGenerationJob(batchId, jobId, "修订要求…")`（修订要求要具体：
  目标字数、必须用的人名、场景）；
- **计划与正文哪个对**：正文更好就改计划对齐正文，反之改正文——
  `updateChapterPlan({chapterId, volumeId, title, outline, targetWords})`。
- 处置完 `setAutoReview(novelId, true, "处置说明")` 再 resume。

**僵尸任务清理**（pause 原因含「仍有待审候选」但实际已全部入正史）：
遍历所有批次任务，`chapter.status==="accepted"` 且任务仍 candidate_ready 的，
`platform.updateGenerationJob(job.id, "completed", { candidateId: 已接受候选id })`。
（根因与产品化建议见 8.5 #5。）

### 8.4 收工终检 + 导出（30 分钟）

**终检**（全 accepted 章节上跑）：
1. 字数：每章 ≥1800（0 章低于即达标）；
2. 跨章段首 30 字查重：长文（≥8 个汉字）段首应 0 重复；短节拍句
   （「——」「饿。」类）允许，甄别标准是长度；
3. 标题唯一性 120/120；
4. 英文残留：正则 `[A-Za-z]{2,}` 扫描，合法实体引用（E-XXX 编号）除外，
   其余用 `reviseChapterContent(chapterId, 查询词, 替换词)` 逐章清除。

**导出**（页面上下文，大文件分块拉取）：
1. 书稿：注入 `__export_bridge.js` → `novelAsMarkdown(novel, chapters)` 存
   `window.__mdText` → 按 120k 字符 slice 分块拉回 → 写
   `书稿/<书名>-<模型标识>-全<章数>章.md`；
2. 项目包：`buildProjectBundle(novelId)` → JSON.stringify → 分块拉回 →
   写 `backups/<书名>-<模型标识>.amy-novel.json`（backups/ 已 gitignore）。

**收尾**：停心跳 → 删 `window.__store/__platform/__NOVEL/__mdText/__bundleJson` →
删 `public/` 全目录 → 停 vite 守护 → BACKLOG 记任务 ID + 结论段 →
`pnpm check` 全绿 → 书稿与文档一并提交推送。

### 8.5 已知故障与状态（真实 API 实战全录）

| # | 故障 | 根因 | 处置 | 状态 |
| --- | --- | --- | --- | --- |
| 1 | 全请求 401，批次重试耗尽暂停 | Web 端 Key 存 sessionStorage，IAB 重载/导航即丢 | 重存 Key（saveModelProfile 带 apiKey）后照常；**测试连接要读返回体 ok 字段，它不抛错** | 已有绕行；产品化建议：巡航中密钥丢失前置提示/引导重填 |
| 2 | 正文 0 字（输出 N 千 tokens） | GLM coding 端点在 max_tokens 内先推理后正文 | AN-060 修复：流式生成显式 `thinking:"disabled"` | ✅ 已修 |
| 3 | 补写后仍不足 1800 字门 | 生成/补写共用 `chapterWords×1.5=3000` 预算 | AN-060 修复：+4000 推理余量 | ✅ 已修 |
| 4 | 事实提取 JSON 截断（Unterminated string） | 预算 1800 < JSON 实际 2–4k 字 | AN-060 修复：6000 + 低温修复一次 | ✅ 已修 |
| 5 | 批次整批失败：payload 校验 | 模型把 payload 写成非对象 | AN-060 修复：preprocess 归一 | ✅ 已修 |
| 6 | 批次误报「Novel or chapter not found」 | AN-048 镜像偶发读空 | AN-060 修复：listNovels 空表延迟重读 | ✅ 已修 |
| 7 | vite 偶发自退，页面失联连锁丢 Key | dev 服务器稳定性 | 守护循环拉起（8.0 #4）；重载后重装桥接+Key | 已有绕行 |
| 8 | 「仍有待审候选」暂停但全部已入正史 | 重写残留 candidate_ready 僵尸任务 × 封存门「最新候选须 accepted」互锁 | **AN-061 已根治**：自动接受自愈僵尸任务（指向本批次前旧稿且章节已入正史→收尾+改指）、巡航判定排除本轮前悬空稿与已拒稿；8.3 清理套餐保留作兜底 | ✅ 已修（AN-061，含双回归测试） |
| 9 | 提案「找不到要更新的设定」连败 3 次自停 | 模型 update 提案 targetName 带括号注释对不上实体 | 拒绝该提案 + 手工删除重复实体后重规划 | 已有绕行；产品化建议：提案名匹配归一化 |
| 10 | 周期弧线撞车（mock 时代遗留教训） | 每周期标题若非全书唯一，段首标签跨章重复 | 真实模型自拟标题无此问题；mock 路由数据须 12 弧线齐备 | 仅 mock 相关 |

### 8.6 文件地图（一本书的完整产物）

| 路径 | 内容 |
| --- | --- |
| `书稿/<书名>-<模型>-全N章.md` | 全书 Markdown（novelAsMarkdown，导出头+分章） |
| `backups/<书名>-<模型>.amy-novel.json` | 完整项目包（设定/正史/候选/审查/用量，可 #/data 页恢复；gitignore） |
| `scripts/amy-author-model.mjs` | mock 作者模型（已退役；泊星港/灯匠与雾海/万纹忍尊 mock 版数据留存备查） |
| `scripts/dev-helpers/` | 巡航桥接四件套 + 说明（复制到 public/ 使用） |
| `docs/BACKLOG.md` | 每本书的任务 ID、结论段与缺陷收口记录 |
| `docs/AI_AUTHORING_WORKFLOW.md` | 本手册 + 各书实跑记录（§5 mock 时代 / §7 切换 / §8 手册） |

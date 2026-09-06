# 任务台账

> 本文件是任务状态的唯一权威来源。路线图只描述阶段目标，验收报告只记录已经执行的验证。
> 状态定义见 `DEVELOPMENT_GUIDE.md`。最近审计：2026-09-05。

## 当前结论

2026-08-31：v1.0.0 已发布（安装包冒烟与验收记录见 `ACCEPTANCE_REPORT.md`，版本
说明见 `RELEASE.md`）。P0 全部收口；P1 中 AN-010/011/012/024/025 完成，AN-013（前端
拆包）、AN-014（CI）与 AN-015（签名/自动更新，等证书与发布渠道）留待后续。
真实模型 autopilot 评估已通过；运行语义见 `AUTOPILOT_WORKFLOW.md` 6.1 节。
评估发现的“候选已生成但事实提案为 0 无提示”问题与 AN-021 版本化记忆、
AN-023 审查重写留待 v1 后迭代。
发布后用户实测发现点击作品进入规划页白屏，AN-025 已定位修复（zustand selector
不稳定引用引发无限重渲染），并补全局 ErrorBoundary 与回归测试。
用户实测又发现审阅链路两处问题：正史建议按钮在候选稿未接受时禁用但无禁用样式
（“看着能点点不动”），且逐章审阅需 7+ 次点击过于繁琐；AN-026 修复界面可用性并
实现作者委托的「自动接受并连续创作」（指定章数自动跑完，含质量门与自动停止）。

2026-09-01：AN-027 全局一致性审查 harness 完成（确定性校验 + AI 语义审查 + 审查
反馈重写联动，双端端口与迁移齐备）。用户全自动连跑实测又停摆两次，AN-028 定位并
修复：自动审阅开关不持久化（重启即丢）、圣经外新角色提案抛错触发连续失败自停、
别名冲突规则重复 id 致 global_findings 落库整批失败；同时补批次互斥、排队批次可
停止、横幅状态提示与运行器丢失自动接管。真实数据回放复现并全部回归覆盖。
续跑成功后用户反馈历史批次无删除入口，AN-029 补批次记录删除（双端端口 + 门禁 +
级联清理 + 工作台删除按钮）。

2026-09-02（下午）：AN-013（一）完成——路由懒加载 + vendor 分包 + 修复 Electron
renderer 生产构建未压缩（主包 1.39MB → 全部 chunk <500KB，入口 190KB），
novel-store 拆出三个切片。随后用户开启巡航实测，连续定位修复六个线上停摆：
① 重复新增设定提案自动跳过（还魂灯形态）；② 接管检查点运行时代确认
plan_review 策划包（建批次门禁自愈）；③ running 分支批次终态主动对账；
④ chapter_review 残留对账绕过 sync 的 running 前置（秒回死洞）；⑤ 单轮
检查看门狗（挂起超时解锁，390s，代际标记）；⑥ 周期已被人工封存时跳过
封存直接进下一周期。另修巡航卡片样式对齐与"从当前进度"文案、进度数字
显示。巡航用例增至 12 项，全套 218 项测试通过。
下午第二波七个问题（章级进度/悬空自愈+伏笔年龄/自动审阅看门狗/收尾模式/
进度刷新/陈旧缓存互搏/周期记忆清理），巡航 13 项、自动审阅 13 项、全套
222 项测试通过；41–70 章真实数据端到端连跑成功，循环体全流程文档化到
AUTOPILOT_WORKFLOW §6.3。

2026-09-02（晚）：挂账问题清零行动。AN-037 书稿阅读/导出（作品卡片按钮 +
连读页导出）与卡片布局美化；AN-036 SQLite 写锁挂起根治（WAL+busy_timeout
连接卫生、20s 操作守卫快速失败、事件驱动锁探测+自动重开连接，端到端测试
覆盖）；AN-038 伏笔/时间线上下文瘦身（175 条开放伏笔与全量时间线限量注入，
久埋伏笔优先回收，第 61 章曾膨胀到 10.6 万 tokens）；AN-021 版本化记忆收口
（stale-memory 记忆体检 + 上下文待复核前缀 + 候选 0 正史建议警示）；AN-023
审查驱动重写闭环（error 自动重写≤N 轮，默认关，巡航/自动运行开 2 轮）；
AN-014 CI 工作流（check 常跑 + release 双构建）。附带修复：数据库仓库字段
显式类型化暴露隐性 any 掩盖的类型错误（含 novel-ipc 圣经标签引用不存在的
title 字段——运行时全局审查提示词的圣经标签一直是 undefined）。全套 245
项测试通过。AN-013（二）大文件拆分（web-platform/PlanningWorkflowPage/
novel-store 续切）为可维护性重构，非缺陷，留待后续按切片工厂模式继续。

2026-09-02：用户 1–20 章全部完成后提出“全局整体查看+整体微调”。数据实证了记忆债
务（伏笔 84 条未回收 82、状态同章重复/矛盾、142 条建议零人工过目）。AN-030~034
整批落地：故事总览仪表盘（零 token 聚合 + 记忆体检）、记忆清理（重复状态合并、
伏笔批量废弃/删除）、整书连读（疑点标记入全局审查台账）、全书分窗口 AI 通读审稿
（Application 共享编排，双端薄壳）、全局微调（查找→逐章预览→确认替换+版本快照）。
安全边界不变：AI 只出发现与建议，正文改动逐章人工确认并留快照。




2026-09-07：AN-041 收口 Web 端接受候选稿后的任务状态刷新缺陷（详见 P1 表）。同期新增实验性外部工具（不属产品能力）：`scripts/amy-author-model.mjs`（本地 OpenAI 兼容"作者模型"示例）、`scripts/author-headless.mjs`（项目数据包无头批处理 CLI）、`docs/AI_AUTHORING_WORKFLOW.md`（AI 主笔操控写作工作流记录，含 120 章完本示例数据）。
## P0：数据正确性与连续性

| ID | 状态 | 事项 | 当前证据 | 完成验收 |
| --- | --- | --- | --- | --- |
| AN-001 | [x] | 下一周期规划注入封存记忆 | Electron/Web 通过同一 `rollingPlanningMemoryText` 注入上一已封存周期、人物最新状态、开放伏笔和时间线尾部；动态正史优先于旧预期；总长限制 4,000 字符 | `planning.test.ts` 证明第 11–20 章规划能看到第 10 章实际结束状态、人物退场、拆塔伏笔和时间线；预算上限测试通过；`pnpm verify` 通过 |
| AN-002 | [x] | 事实提案 payload 容错 | `fact-extraction.ts` 已支持自由文本伏笔状态、字符串数组、字段别名和 summary 回退；含域测试 | 当前自动化测试通过；保留真实模型失败样例回归 |
| AN-003 | [x] | 单章审批与记忆审核硬门禁 | Electron/Web 接受候选后仅写入正史；该候选的事实提案全部接受/拒绝后，`candidate_ready` 才转为 `completed`；周期封存会汇总范围内已接受候选并拒绝任何待处理提案 | 共享 Domain 门禁测试与 SQLite 周期封存集成用例通过；`pnpm verify` 通过（96 项测试，双端生产构建） |
| AN-004 | [x] | 低温 JSON 修复一次 | Electron/Web 在规划 JSON/Schema 解析失败时以 0.1 温度修复一次；业务完整性错误不触发；`planning_runs` 分别保存原始与修复响应并累计 Token，旧库和旧项目包兼容 | 修复成功与二次失败测试、SQLite 留痕测试通过；`pnpm verify` 通过（98 项测试，双端生产构建） |
| AN-005 | [x] | 实体短引用、跨阶段合并与周期去重 | 规划 Prompt 用实体 ID 派生的稳定短引用；明确引用或名称/别名完全匹配才更新；限定名同核心称呼生成全局合并提案，不静默合并或建双卡；已接受/待审新增提案跨周期去重 | Domain、Application、SQLite、项目导入短引用重映射测试通过；`pnpm verify` 通过（102 项测试，双端生产构建） |
| AN-006 | [x] | Web 长篇存储迁移到 IndexedDB | `web-storage.ts` 以内存镜像保持原同步 read/write 接口，全部 `amy-novel:` 键落 IndexedDB；启动一次性迁入旧 localStorage 数据并清源；首屏读取前经 `PlatformPort.ready()` 等待装载 | jsdom + fake-indexeddb 测试覆盖迁移清源、60 章×3200 字重载恢复且 localStorage 无数据键、项目包导入往返与删除清理；`pnpm verify` 通过 |

## P1：可维护性、测试与发布安全

| ID | 状态 | 事项 | 当前证据 | 完成验收 |
| --- | --- | --- | --- | --- |
| AN-010 | [x] | Renderer 关键流程测试 | `tests/web/novel-store-flows.test.ts`（jsdom + 模拟平台）覆盖：规划门禁（跳步确认被拒、第 9 步未确认拒绝建批）；候选接受与事实审核（未接受候选稿时提案写入被正史门禁拒绝，接受后伏笔以 ai_candidate 来源写入）；生成中切页恢复（后台推进后仅靠 loadBatches/loadJobs 恢复运行与待审状态，全部提案处理后批次收敛完成） | 三流程测试通过，顺带暴露并修复 PersonaPanel selector 不稳定引用的无限重渲隐患；`pnpm verify` 通过（147 项测试） |
| AN-011 | [x] | PlatformPort 双端契约测试 | `tests/contract/platform-port.contract.ts` 同一组 7 项用例分别驱动 Electron（NovelDatabase，经 novel-ipc 同款方法映射）与 Web（webPlatform + IndexedDB）：ready 门、cycleSize 归一化、CJK 字数与版本快照、第 9 步门禁错误语义、workflow run DTO、文风模板、项目包导入与短引用重映射 | 双端 14 项契约用例通过（并验证孤儿提案按 cycleId 过滤的规则两端一致）；`pnpm verify` 通过（132 项测试） |
| AN-012 | [x] | IPC 运行时校验和 Electron 导航安全 | `registerNovelIpc` 入口统一包裹写通道守卫表（ipc-guard 组合子 + ipc-write-guards，约 50 个写通道含付费生成调用）；`window-security.ts` 纯函数策略接入 will-navigate / setWindowOpenHandler（外链转系统浏览器）；双端入口 html 配置差异化 CSP（Electron 渲染层零网络，Web 放开模型端点） | 守卫表完整性、类型攻击拒绝、导航前缀逃逸、新窗口决策与双端 CSP 断言共 9 项测试通过；`pnpm verify` 通过且双端构建产物含 CSP |
| AN-013 | [~] | 拆分前端热点文件并按路由懒加载 | 2026-09-02 完成第一批：① 13 个页面 React.lazy 按路由分包（HashRouter，file:// 与 Web 均验证）；② 双端 vite manualChunks（vendor-react 232KB / vendor-zod 140KB / vendor-icons 22KB），并修复 electron-vite renderer 生产构建未压缩问题（原 1.39MB 主包 → 入口 190KB）；③ novel-store（2,760 行）按业务边界拆出 store/auto-review.ts（281）、store/cruise.ts（348）、store/global-review.ts（132）+ utils，主文件降至 2,033 行，对外导出（useNovelStore/NovelState）不变 | 剩余：novel-store 仍 >2,000 行（可再切批次/工作流运行段）、web-platform.ts 2,455 行与 PlanningWorkflowPage 1,505 行未拆；已达成部分：构建无 500KB 警告（全部 chunk <500KB）、懒加载落地、行为测试不退化（214 项通过）；继续拆分时沿用切片工厂 + 共享 utils 模式 |
| AN-014 | [x] | 建立可重复 CI | `.github/workflows/ci.yml`（2026-09-02）：PR/推送到 main 运行 `pnpm check`（typecheck:node+web 与全量测试）；release 分支与 v* 标签追加 `pnpm verify`（check + Web/Electron 双端生产构建）；pnpm/action-setup 按 package.json 的 pnpm@11.19.0 安装、setup-node 缓存 pnpm store、`--frozen-lockfile` 锁定依赖 | 工作流语法由 YAML 结构核对（本地无 GitHub Runner）；「失败阻止合并」需在 GitHub 仓库 Settings→Branches 把 check（及 release 的 verify）设为必需状态检查——这步只能在仓库设置里做，非仓库文件可表达。首次推送后确认运行绿 |
| AN-015 | [!] | Windows 商业签名与自动更新 | 需要证书和发布源，不属于仓库内可独立完成事项 | 用户提供证书/发布渠道后，签名安装包和更新回滚冒烟通过 |
| AN-025 | [x] | 规划页白屏修复与渲染层崩溃兜底 | 三处 selector 兜底 `?? []` 改为模块级常量（`PlanningWorkflowPage` 的 activityEvents、`App.tsx` GeneratePage 的 planningCycles、`BatchesPage` ActivityLog 的 activityEvents）；`main.tsx` 增加全局 `ErrorBoundary`（返回首页/重新加载），任何页面级渲染异常不再整站白屏；规范新增 Renderer selector 稳定引用硬规则（`DEVELOPMENT_GUIDE.md` §6/§7） | `tests/web/planning-workflow-mount.test.tsx` 在空数据状态整页挂载规划页：旧写法失败、新写法通过（双向验证）；`pnpm check` 通过（148 项测试）；浏览器复现路径（首页→点击作品→规划页第 1/10 步正常渲染）验证通过，见 `ACCEPTANCE_REPORT.md` 2026-08-31 |

## P2：产品能力

| ID | 状态 | 事项 | 当前证据 | 完成验收 |
| --- | --- | --- | --- | --- |
| AN-020 | [x] | 文风模板库 | 已有 Domain、SQLite/Web、IPC/Preload、模板页、单章/批量应用和域/数据库测试；样章只在本地保存，生成只注入抽象风格卡 | 当前自动化检查通过；真实模型效果留待专项评估 |
| AN-021 | [x] | 版本化记忆 | 三项验收全部落地（2026-09-02）：①派生记忆失效传播——`story-overview` 记忆体检新增 `stale-memory`（派生判定：已入正史章节 updatedAt 晚于记忆记录 updatedAt 即"正文在记忆回写后被修改"，人物状态/时间线/伏笔按章聚合提示复核，连续性页「记忆过期」标签），`context-pack` 注入时该类记录带【待复核】前缀提示模型谨慎采信（双端 batch-runner/novel-store 接线 chapterUpdatedAtById）；②后续候选失效——`staleEarlierChapterTitle` + 「按最新前文重写本章」（既有能力，验收确认）；③项目包版本链——project-export 含 ChapterVersion[]（既有能力，验收确认）；④0 提案警示——候选审阅页 0 条正史建议时显示警示条（引用 2026-08-31 评估形态，提示改稿或手动补录，接受前后文案区分）。章节摘要/关系版本属于尚未提取的记忆种类，待未来模型能力扩展时随类型一并纳入失效传播 | `tests/domain/story-overview.test.ts` 新增 2 项（按章聚合三类记录+targetIds；新鲜记忆/草稿章编辑不误报）；`tests/domain/context-pack.test.ts` 新增 1 项（stale 带【待复核】前缀、fresh 不带）；`pnpm check` 通过 |
| AN-022 | [x] | Autopilot Workflow Runner | `workflow_runs` 表与 `run-workflow.ts` 编排已落地，复用现有规划器和 BatchRunner；三档检查点（阶段/提案/章节审核）、批次事件驱动的状态收敛、失败重试与断点恢复、规划页运行台均已实现，运行语义见 `AUTOPILOT_WORKFLOW.md` 6.1 | 三档模式暂停点、提案门禁、重试耗尽、失败恢复重置预算、双端批次收敛差异的编排测试与 SQLite 持久化用例通过；2026-09-04 `pnpm verify` 复验通过（241 项通过、11 项按条件跳过，双端生产构建）；真实模型 autopilot 全流程评估通过（两轮驱动、候选不入正史、预算 4.7k/80k），记录见 `ACCEPTANCE_REPORT.md` 2026-08-31 |
| AN-023 | [x] | 审查驱动重写与可选自动采纳 | 闭环落地（2026-09-02，2026-09-04 双端收口）：`domain/quality-check.ts` 提供 shouldAutoRewrite（仅 error 级触发、受轮数上限控制）与 rewriteNotesFrom（error 清单注入重写上下文）。Electron 与 Web 均把确定性检查和 AI 章节审查 findings 落库并共同驱动重写；旧候选稿保留可回看，轮数耗尽退回人工审核。无人值守显式开启 2 轮重写并执行 90% 字数门；接受候选时仍生成章节快照，可回滚 | 域测试覆盖触发条件、轮数、修订清单与 90% 门；`tests/web/chapter-analysis.test.ts` 覆盖 Web findings/事实提案/用量落库和非法审查结果 fail-closed；`pnpm check` 通过 |
| AN-024 | [x] | 人物阵容建议与运行日志 | 域测试覆盖解析与过滤；`tests/web/web-advisory-chain.test.ts` 走真实 webPlatform + stub fetch 全链路（别名命中、extra/未知人物过滤、请求载荷与会话密钥、非 200 错误可读）；`tests/web/persona-panel.test.tsx` 覆盖推荐→调整→批量确认写入正式设定的 UI 回归 | `pnpm verify`、关键 UI 回归与双端契约（AN-011 契约套件 + 共享解析域测试）通过 |
| AN-026 | [x] | 自动接受并连续创作（委托审阅）+ 审阅界面可用性修复 | store 新增 `setAutoReview`/`tickAutoReview`（2 秒轮询）：接受候选稿 → 接受全部正史建议 → 自动恢复批次写下一章；error 级 findings 未解决时暂停交还人工，批次完成/候选被拒/连续 3 次失败自动关闭；`auto_review` 事件留痕。UI：工作台开关与状态条、生成配置页“全自动连续创作”开关、建议列表“全部接受”按钮及候选门禁提示。无人值守的 90% 字数门、AI 审查与失败关闭语义已由 AN-039 接入，运行语义见 `AUTOPILOT_WORKFLOW.md` §6.2 | 自动审阅与 UI 回归覆盖完整循环、质量/全局门、校验异常 fail-closed、失败自停、拒绝让位、持久化和防重复任务；`pnpm check` 通过 |
| AN-027 | [x] | 全局一致性审查 harness（章节入正史后的全局校验与修复提案） | ① `domain/global-consistency.ts`：确定性校验器（悬空引用/位置跳变/道具重复持有/伏笔超期/别名冲突/停用实体仍有状态，零 token），每条建议入正史后增量跑、封存周期前全量跑（PlanningWorkflowPage finishCycle 门禁），error 级发现接入 AN-026 自动接受质量门（`collectGlobalErrors`）；② AI 语义审查：`reviewGlobalConsistency` 端口（Web/Electron 双端），复用 Context Pack 预算装配全局审查包，产出 findings（忽略状态可跨轮延续）与设定修复提案（走 planning_proposals，cycleId=global-review，人工审核）；③ 重写联动：GlobalFinding → `regenerateGenerationJob(revisionNotes)` 注入「审查修订要求」上下文源；任务/批次链路携带 `revisionNotes`（generation_jobs 新列 + 双端读写）。UI：连续性页「全局审查」视图（发现分级列表、忽略、按反馈重写第 N 章、修复提案审核）。global_findings 表 + 索引迁移，契约测试双端 16 项含 findings 往返。线上事故修复：别名冲突规则对同一实体组逐名称键重复产出同 id，导致 saveGlobalFindings 主键冲突整批回滚（用户库中校验结果一直存不下来）——已改为按实体组合并去重 + 校验器输出与 AI 解析双重 id 去重（AN-028 域回归） | `tests/domain/global-consistency.test.ts` 12 项（规则一正一反 + id 唯一不变量 + AI 解析去重）；`tests/web/global-review-chain.test.ts` 真实 webPlatform 全链路；`tests/web/auto-review.test.ts` 全局门用例；`tests/contract` 双端 findings 往返；`tests/main/database.test.ts` 迁移与 revisionNotes 留痕；`pnpm check` 通过（177 项测试）；真实模型审查效果需专项评估 |
| AN-028 | [x] | 全自动连续创作鲁棒性（断点续跑、新角色自动建档、状态可见、批次互斥） | 线上两次停摆的根因修复：① 自动审阅开关仅存内存，dev 重启/刷新即静默丢失（第一次停摆）——开关持久化 localStorage（`amy-novel:auto-review`），store 启动时重挂载断点续跑，自动停用同步清除不复活；② 圣经外新角色的 character_state 提案直接抛错，自动审阅连续 3 次失败自动关闭（第二次停摆，实测卡在「平顺镖局遗女」）——自动路径先建最小实体卡（summary 注明自动建档与首出章节）再写状态，人工路径保持原报错；③ tick 逐条建议独立容错：单条失败不阻断整批、活动日志注明待人工处理，全部失败才计入连续失败；④ 消灭静默假死：批次暂停/排队/生成中状态写入自动审阅横幅（noteAutoReview，内容不变不重渲染）；运行器丢失接管（应用重启后批次停在 running 但无人推进，或任务卡 generating 超 5 分钟）自动重新 dispatch；⑤ 批次互斥：同一作品同时只允许一个未完结批次（web-platform 门禁之后 + Electron 仓库层），排队批次可停止，杜绝自动审阅在批次间跳与重复生成已入正史章节 | `tests/web/auto-review.test.ts` 12 项（自动建档双路径/部分失败/状态横幅/持久化/运行器丢失接管）；`tests/main/database.test.ts` 批次互斥用例；用户真实库数据回放复现 id 重复并验证修复（临时用例转正式回归）；`pnpm check` 通过；渲染层修复经 dev HMR 即时生效，主进程批次互斥随下次应用重启生效 |
| AN-029 | [x] | 批次记录删除（历史任务清理） | 用户实测反馈：已取消/已完成的历史批次一直留在批次切换器里，没有删除入口（1–10 完成后切到 11–20，旧任务越积越多）。新增 `deleteGenerationBatch` 端口（Web storage 清理 + Electron 仓库事务级联删除 generation_events/generation_jobs/generation_batches），双端同一状态门禁：仅 completed/cancelled 可删，进行中/等待审核先停止；已入正史的章节、候选稿与用量统计不受影响。UI：工作台对已完结批次显示「删除记录」（危险色 + window.confirm 二次确认）；store `deleteBatch` 同步清理列表与任务缓存，选中批次删除后自动回退到最需关注的批次 | `tests/contract` 双端“删除不存在批次错误语义一致”；`tests/main/database.test.ts` 生命周期用例（进行中拒绝 → 取消 → 级联清理任务与活动日志）；`tests/web/novel-store-flows.test.ts` store 状态清理用例；`pnpm check` 通过（181 项测试） |
| AN-030 | [x] | 故事总览仪表盘（整书视角“看得见”） | 用户 1–20 章完成后提出全局查看+微调需求；数据实证：伏笔 84 条未回收 82、人物状态同章重复/矛盾（28 岁 vs 24 岁）、142 条 AI 建议零人工过目。`domain/story-overview.ts` 纯本地聚合（零 token）：人物出场（首末章/活跃章/状态数/最新状态）、道具流转链（跨人跨章持有合并）、伏笔进度（埋设→回收+年龄+超期）、各章摘要行、统计卡片；连续性页新增「故事总览」默认首视图，左栏记忆体检问题清单可跳转对应台账 | `tests/domain/story-overview.test.ts` 8 项（聚合一正一反 + 体检形态含线上事故复现）；`pnpm check` 通过（202 项测试） |
| AN-031 | [x] | 整书连读 + 作者疑点标记 | 新 BookReaderPage（路由 /novels/:id/book，连续性页顶栏入口）：左侧章节目录锚点跳转、右侧连续滚动连读全部已入正史章节；每章「标记疑点」内联表单把问题写入全局审查台账。GlobalFinding.source 扩展 `author`，三处合并逻辑（store 规则校验 / web 与 electron AI 审查）均保留 author 记录不随轮次清除 | `tests/web/global-review-chain.test.ts`：规则与作者记录均不被 AI 审查清除；类型贯穿双端；`pnpm check` 通过 |
| AN-032 | [x] | 全书分窗口 AI 通读审稿 | `domain/whole-book-review.ts`：窗口切分（默认 5 章/窗，只收已入正史）、窗口 prompt（滚动摘要续读 + 人物速览 + 已知问题防重 + 正文按预算均分裁剪）、解析（zod 兜底 + 同窗复述去重 + 含章节定位的稳定 id）。编排下沉 `application/whole-book-review-runner.ts`（双端共享：逐窗口事件/用量留痕、book:* 发现整体替换上一轮、跨窗口重复 id 去重防主键冲突、忽略状态延续、author/rule 发现保留）。端口 `reviewWholeBook`：Web/Electron 薄壳装配（requestWebPlanning / streamOpenAICompatible）。审查页「全书通读审稿」按钮（费用确认 + 逐窗口进度事件） | `tests/domain/whole-book-review.test.ts` 7 项；`tests/web/whole-book-review.test.ts` 3 项（窗口顺序/滚动摘要/留痕/替换语义/跨窗去重/空书错误）；`pnpm check` 通过（202 项） |
| AN-033 | [x] | 记忆清理（重复状态合并 + 伏笔批量处置） | `buildStoryOverview` 记忆体检结构化产出：duplicate-state（同人物同章完全相同 → 一键保留最早条删重复）、multi-state-chapter（同章多条不同状态 → 提示人工核对矛盾）、overdue-foreshadow、dangling-ref（error）。总览页重复状态卡片逐条「保留一条删重复」；伏笔进度表勾选后批量废弃（abandoned，保留记录）或批量删除（confirm 二次确认），全部走既有正史写路径 | `tests/domain/story-overview.test.ts` 体检 4 用例（含 28 岁 vs 24 岁形态与一键修复清单）；`pnpm check` 通过 |
| AN-035 | [x] | 全自动巡航（跨周期无人值守连跑到目标章数） | 用户定案的两段式：地基期人工精控现有流程不变；信任建立后开启「全自动巡航」一个按钮循环跑到目标章数。循环体：周期规划（提案自动处理）→ 建批次 → 正文连写+正史建议自动接受（复用 AN-026/028）→ 封存（实际结束状态从最新正史记忆确定性起草，门禁照跑：提案清零+全局校验无 error）→ 下一周期，直至目标章/出错/额度耗尽。已定参数：① 不卡第一卷封存，10 步向导完成即可开启；② 不设预算上限——途中额度耗尽即停在原地并记录状态，修复后可续跑。安全边界：全局校验 error 整线暂停、连续失败暂停并留原因、全程留痕可事后审计（总览/连读/通读审稿）、断点续跑（重启自动重挂载）。实现：domain/workflow-cruise.ts（CruiseState 状态机、draftClosingState 从最新正史记忆确定性起草实际结束状态≤480字、nextCycleRange 对齐目标/目录、cruisePolicy 沿用策略只换范围）；store tickCruise（3 秒轮询）：无运行→按封存进度启动 autopilot 运行；proposal_review→自动接受全部 pending 设定提案并续跑；phase_review→代点继续；chapter_review→交给自动接受；批次预算耗尽/运行失败/全局校验 error/连续 3 次失败→转 paused 并记录原因（继续巡航一键续跑）；completed→章节全部入正史后过 AN-027 门禁→自动封存（起草实际结束状态）→开下一周期运行→到达目标收工并关闭自动接受。开关持久化 amy-novel:cruise，启动重挂载（paused 保持暂停）。UI：规划页第 10 步「全自动巡航」卡片（目标章数、开启确认弹窗、状态与暂停原因、继续/停止）。不卡第一卷封存（用户定案）；不设预算上限，批次预算耗尽即停可续（用户定案） | tests/domain/workflow-cruise.test.ts 5 项（起草/范围/策略）；tests/web/cruise.test.ts 7 项（启动新周期、提案自动接受续跑、失败暂停、预算耗尽暂停、等待入正史、封存+下一周期、目标收工+持久化清理）；pnpm check 通过（214 项测试）；真实模型长跑效果待用户实测。实测三连修：① 重复新增设定提案自动跳过（还魂灯形态）；② 接管检查点运行时代确认 plan_review 策划包（建批次门禁自愈）；③（二）精化：第 2 周期起运行直接从 structure 阶段启动（startWorkflowRun 新增 startPhase，省每周期 3 次圣经/人物/场景重复调用）、规划页步骤条巡航自动跟随（structure→7/generation→10）、卡片正名「全自动巡航（自动规划 + 自动创作）」并写明含 7–9 步；216 项测试通过 |
| AN-036 | [x] | 主进程 SQLite 写锁挂起的取证与根治 | 一天内两次复现（19:4x/20:5x）：读正常、全部写入 IPC 挂起 ≥30 分钟（事件/封存/删除均不落库），巡航看门狗重试无效；重启应用后巡航断点恢复并在 2 分钟内完成封存（第二次附带清理 565 条重复伏笔，740→175）。根治落地（2026-09-02）：`src/main/db/client-guard.ts` 连接卫生（WAL + busy_timeout=5000 + synchronous NORMAL + foreign_keys）+ 操作守卫（execute/batch 挂起 >20s 抛可读错误而非永久等待，错误文案含断点续跑指引，经 IPC 到达渲染层巡航暂停提示）；超时回调触发事件驱动锁自检（BEGIN IMMEDIATE 探测 3s），失败自动重开连接并整体重建 repositories（swapClient），主进程 index 挂 onRecovery 时间戳留痕（取代人工先取证再重启——复现即自动取证+自愈）。repositories 排查：全部 batch 均为本地语句数组、无跨模型调用的长事务。现场笔记见 `CRUISE_FIELD_NOTES.md` §二 | `tests/main/db-guards.test.ts` 5 项：PRAGMA 生效（WAL/busy_timeout/NORMAL）、挂起操作超时抛错且触发 onStall、正常操作透传、锁探测真假判定、端到端（写入挂起→快速失败→自动重开→同库续写成功）；`pnpm check` 通过。线上再复现时自动重连+时间戳日志即为取证记录 |
| AN-037 | [x] | 书稿阅读与导出 | `domain/book-export.ts` buildBookText（只收已入正史、按章序、书名/题材/简介/字数统计导出头，空书兜底文案）；`renderer/book-download.ts` Blob TXT 下载（《书名》N章.txt）。作品卡片新增「阅读」（NavLink /novels/:id/book）与「导出书稿」按钮（章节不在内存先装载，只读）；连读页工具栏同步加导出。卡片布局纵向重排：链接区在上、动作行沉底+虚线分隔、两按钮等宽对齐 | `tests/domain/book-export.test.ts` 2 项（已入正史过滤+排序+导出头；空书文案）；视觉验证（无障碍边界：两按钮 211/210px 等宽同高对齐）；`pnpm check` 通过 |
| AN-038 | [x] | 伏笔/时间线上下文膨胀治理 | 实测第 61 章上下文 10.6 万 tokens，主因：章节生成上下文无上限注入全部开放伏笔（清理后仍 175 条）与全部历史时间线。`domain/context-pack.ts` 新增 selectForeshadowThreads（过滤已回收/废弃/未来埋设；本章计划提及优先，其余按埋设账龄降序——久埋超期优先回收；上限 16）与 selectTimelineEvents（截至本章最近 24 条，作者手动事件钉住优先保留）；buildContextPack 注入「伏笔治理」提示源（优先回收最早埋下伏笔、勿凭空新开线）；planning.ts 开放伏笔改按埋设章升序再截断 12 条并把提示写进规划节标题。双端调用点（batch-runner / novel-store）同步接线，通读审稿仍用全量记忆不受影响 | `tests/domain/context-pack.test.ts` 新增 6 项（过滤语义/提及优先+账龄排序/上限截断/时间线手动钉住+尾部窗口/治理提示源有无）；`tests/domain/planning.test.ts` 12 项回归；`pnpm check` 通过 |
| AN-034 | [x] | 全局微调（查找 → 逐章预览 → 确认替换 + 版本快照） | `domain/revision.ts`：确定性全书查找（计数+首命中上下文预览，空词拒绝、单字允许）与整章替换（同词/空词不执行、替换为空即删除）。连读页「全局修订」面板：输入查找/替换词即时检索 → 命中章节列表（预览片段高亮）→ 逐章 confirm 确认替换 → `saveChapter` createSnapshot=true（origin=manual，写作台版本历史可回滚），并明示正史记忆不自动联动（AN-021 范围） | `tests/domain/revision.test.ts` 5 项（跨章命中/空词拒绝/单字/计数/删除语义）；`pnpm check` 通过 |
| AN-039 | [x] | 全自动创作安全链收口 | 双端无人值守批次统一启用 `chapter_review`；90% 字数门、AI 语义 findings 与本地 findings 共同驱动最多 2 轮重写；AI 审查/事实提取失败 fail-closed；全局校验异常不再吞错；看门狗超时保持防重入锁；封存按 `updatedAt` 选择人物最新状态；预算耗尽后「继续巡航」自动追加 60,000 tokens | 域/巡航/自动审阅/数据库与 Web 真实适配回归覆盖；`pnpm check` 247 项通过；双端生产构建见验收报告 |
| AN-040 | [x] | 分章文本 ZIP 导出 | 导出页新增标准 ZIP（Store）下载：作品信息、汇总设定、每章独立 TXT；只包含已入正史且非空章节，按章号排序，文件名兼容 Windows；无第三方依赖 | `tests/domain/text-archive.test.ts` 覆盖文件清单、正史过滤、设定内容与 ZIP 目录签名；`pnpm check` 通过 |
| AN-041 | [x] | 接受候选稿后同步刷新批次任务状态 | Web 端接受/拒绝候选稿后，store 内 jobs/batches 立即与平台层落库结果对齐；修复此前内存任务仍停留在 candidate_ready、『继续生成下一章』被陈旧 awaitingBlocker 渲染为禁用按钮、点击无响应的问题 | 修复前连跑批次每章必卡死需删批重建；修复后 120 章连续生成零卡死；`pnpm check` 247 项测试与双端类型检查通过（2026-09-06 运行） |

## 已完成基础能力

- Phase 0 工程基线与 Phase 1 本地写作闭环；
- 滚动批次范围、规划日志、正史门禁、候选链、硬 Token 预算、429/5xx 退避；
- 真实 API `1–10 → 11–20` 闭环评估；
- 可配置批次大小、篇幅顾问、AI 简报起草和确定性结束状态拼装；
- Windows 0.1.0 安装/启动/卸载历史验收。

详细历史证据见 `ACCEPTANCE_REPORT.md` 和 `E2E_ROLLING_CYCLE.md`。

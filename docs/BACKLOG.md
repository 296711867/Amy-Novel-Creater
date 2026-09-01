# 任务台账

> 本文件是任务状态的唯一权威来源。路线图只描述阶段目标，验收报告只记录已经执行的验证。
> 状态定义见 `DEVELOPMENT_GUIDE.md`。最近审计：2026-08-31。

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

2026-09-02：用户 1–20 章全部完成后提出“全局整体查看+整体微调”。数据实证了记忆债
务（伏笔 84 条未回收 82、状态同章重复/矛盾、142 条建议零人工过目）。AN-030~034
整批落地：故事总览仪表盘（零 token 聚合 + 记忆体检）、记忆清理（重复状态合并、
伏笔批量废弃/删除）、整书连读（疑点标记入全局审查台账）、全书分窗口 AI 通读审稿
（Application 共享编排，双端薄壳）、全局微调（查找→逐章预览→确认替换+版本快照）。
安全边界不变：AI 只出发现与建议，正文改动逐章人工确认并留快照。



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
| AN-013 | [ ] | 拆分前端热点文件并按路由懒加载 | `web-platform.ts`、`novel-store.ts`、`PlanningWorkflowPage.tsx` 均超过 1,200 行；页面静态导入；Web 主包约 537KB | 先按现有业务边界拆分；路由懒加载；构建无 500KB 主包警告；行为测试不退化 |
| AN-014 | [ ] | 建立可重复 CI | 本地已有 `pnpm check` / `pnpm verify`，仓库暂无 CI 工作流 | PR/推送运行 check；发布分支运行双构建；缓存 pnpm；失败阻止合并 |
| AN-015 | [!] | Windows 商业签名与自动更新 | 需要证书和发布源，不属于仓库内可独立完成事项 | 用户提供证书/发布渠道后，签名安装包和更新回滚冒烟通过 |
| AN-025 | [x] | 规划页白屏修复与渲染层崩溃兜底 | 三处 selector 兜底 `?? []` 改为模块级常量（`PlanningWorkflowPage` 的 activityEvents、`App.tsx` GeneratePage 的 planningCycles、`BatchesPage` ActivityLog 的 activityEvents）；`main.tsx` 增加全局 `ErrorBoundary`（返回首页/重新加载），任何页面级渲染异常不再整站白屏；规范新增 Renderer selector 稳定引用硬规则（`DEVELOPMENT_GUIDE.md` §6/§7） | `tests/web/planning-workflow-mount.test.tsx` 在空数据状态整页挂载规划页：旧写法失败、新写法通过（双向验证）；`pnpm check` 通过（148 项测试）；浏览器复现路径（首页→点击作品→规划页第 1/10 步正常渲染）验证通过，见 `ACCEPTANCE_REPORT.md` 2026-08-31 |

## P2：产品能力

| ID | 状态 | 事项 | 当前证据 | 完成验收 |
| --- | --- | --- | --- | --- |
| AN-020 | [x] | 文风模板库 | 已有 Domain、SQLite/Web、IPC/Preload、模板页、单章/批量应用和域/数据库测试；样章只在本地保存，生成只注入抽象风格卡 | 当前自动化检查通过；真实模型效果留待专项评估 |
| AN-021 | [~] | 版本化记忆 | 人物状态、技能、过期候选识别已有基础；章节摘要、通用实体状态、关系版本和完整失效传播未完成。2026-08-31 真实评估发现：第 4–5 章事实提取静默产出 0 条提案，候选审核界面无任何提示，接受后将得不到记忆回写 | 改写章节后所有派生记忆与后续候选可追踪失效；项目包保留版本链；候选的事实提案为 0 时界面有可见警示 |
| AN-022 | [x] | Autopilot Workflow Runner | `workflow_runs` 表与 `run-workflow.ts` 编排已落地，复用现有规划器和 BatchRunner；三档检查点（阶段/提案/章节审核）、批次事件驱动的状态收敛、失败重试与断点恢复、规划页运行台均已实现，运行语义见 `AUTOPILOT_WORKFLOW.md` 6.1 | 三档模式暂停点、提案门禁、重试耗尽、失败恢复重置预算、双端批次收敛差异的编排测试与 SQLite 持久化用例通过；`pnpm verify` 通过（115 项测试，双端生产构建）；真实模型 autopilot 全流程评估通过（两轮驱动、候选不入正史、预算 4.7k/80k），记录见 `ACCEPTANCE_REPORT.md` 2026-08-31 |
| AN-023 | [ ] | 审查驱动重写与可选自动采纳 | 尚无自动重写闭环；默认不得自动写正史 | error 反馈最多 N 次；默认关闭自动采纳；启用时满足质量门槛并保留回滚版本 |
| AN-024 | [x] | 人物阵容建议与运行日志 | 域测试覆盖解析与过滤；`tests/web/web-advisory-chain.test.ts` 走真实 webPlatform + stub fetch 全链路（别名命中、extra/未知人物过滤、请求载荷与会话密钥、非 200 错误可读）；`tests/web/persona-panel.test.tsx` 覆盖推荐→调整→批量确认写入正式设定的 UI 回归 | `pnpm verify`、关键 UI 回归与双端契约（AN-011 契约套件 + 共享解析域测试）通过 |
| AN-026 | [x] | 自动接受并连续创作（委托审阅）+ 审阅界面可用性修复 | store 新增 `setAutoReview`/`tickAutoReview`（2 秒轮询）：接受候选稿 → 接受全部正史建议 → 自动恢复批次写下一章；error 级 findings 未解决时暂停交还人工，批次完成/候选被拒/连续 3 次失败自动关闭；`auto_review` 事件留痕。UI：工作台开关与状态条、生成配置页“全自动连续创作”开关（章数沿用任务范围）、建议列表“全部接受”按钮、候选稿未接受时的禁用样式与解锁提示条（修复“按钮看着能点点不动”）。运行语义见 `AUTOPILOT_WORKFLOW.md` §6.2 | `tests/web/auto-review.test.ts` 覆盖完整循环/质量门/失败自停/拒绝让位/开关同步（5 项）；`tests/web/auto-review-ui.test.tsx` 覆盖三处 UI 接线（3 项）；`pnpm check` 通过（155 项测试）；字数 90% 门槛留待 AN-023 联动 |
| AN-027 | [x] | 全局一致性审查 harness（章节入正史后的全局校验与修复提案） | ① `domain/global-consistency.ts`：确定性校验器（悬空引用/位置跳变/道具重复持有/伏笔超期/别名冲突/停用实体仍有状态，零 token），每条建议入正史后增量跑、封存周期前全量跑（PlanningWorkflowPage finishCycle 门禁），error 级发现接入 AN-026 自动接受质量门（`collectGlobalErrors`）；② AI 语义审查：`reviewGlobalConsistency` 端口（Web/Electron 双端），复用 Context Pack 预算装配全局审查包，产出 findings（忽略状态可跨轮延续）与设定修复提案（走 planning_proposals，cycleId=global-review，人工审核）；③ 重写联动：GlobalFinding → `regenerateGenerationJob(revisionNotes)` 注入「审查修订要求」上下文源；任务/批次链路携带 `revisionNotes`（generation_jobs 新列 + 双端读写）。UI：连续性页「全局审查」视图（发现分级列表、忽略、按反馈重写第 N 章、修复提案审核）。global_findings 表 + 索引迁移，契约测试双端 16 项含 findings 往返。线上事故修复：别名冲突规则对同一实体组逐名称键重复产出同 id，导致 saveGlobalFindings 主键冲突整批回滚（用户库中校验结果一直存不下来）——已改为按实体组合并去重 + 校验器输出与 AI 解析双重 id 去重（AN-028 域回归） | `tests/domain/global-consistency.test.ts` 12 项（规则一正一反 + id 唯一不变量 + AI 解析去重）；`tests/web/global-review-chain.test.ts` 真实 webPlatform 全链路；`tests/web/auto-review.test.ts` 全局门用例；`tests/contract` 双端 findings 往返；`tests/main/database.test.ts` 迁移与 revisionNotes 留痕；`pnpm check` 通过（177 项测试）；真实模型审查效果需专项评估 |
| AN-028 | [x] | 全自动连续创作鲁棒性（断点续跑、新角色自动建档、状态可见、批次互斥） | 线上两次停摆的根因修复：① 自动审阅开关仅存内存，dev 重启/刷新即静默丢失（第一次停摆）——开关持久化 localStorage（`amy-novel:auto-review`），store 启动时重挂载断点续跑，自动停用同步清除不复活；② 圣经外新角色的 character_state 提案直接抛错，自动审阅连续 3 次失败自动关闭（第二次停摆，实测卡在「平顺镖局遗女」）——自动路径先建最小实体卡（summary 注明自动建档与首出章节）再写状态，人工路径保持原报错；③ tick 逐条建议独立容错：单条失败不阻断整批、活动日志注明待人工处理，全部失败才计入连续失败；④ 消灭静默假死：批次暂停/排队/生成中状态写入自动审阅横幅（noteAutoReview，内容不变不重渲染）；运行器丢失接管（应用重启后批次停在 running 但无人推进，或任务卡 generating 超 5 分钟）自动重新 dispatch；⑤ 批次互斥：同一作品同时只允许一个未完结批次（web-platform 门禁之后 + Electron 仓库层），排队批次可停止，杜绝自动审阅在批次间跳与重复生成已入正史章节 | `tests/web/auto-review.test.ts` 12 项（自动建档双路径/部分失败/状态横幅/持久化/运行器丢失接管）；`tests/main/database.test.ts` 批次互斥用例；用户真实库数据回放复现 id 重复并验证修复（临时用例转正式回归）；`pnpm check` 通过；渲染层修复经 dev HMR 即时生效，主进程批次互斥随下次应用重启生效 |
| AN-029 | [x] | 批次记录删除（历史任务清理） | 用户实测反馈：已取消/已完成的历史批次一直留在批次切换器里，没有删除入口（1–10 完成后切到 11–20，旧任务越积越多）。新增 `deleteGenerationBatch` 端口（Web storage 清理 + Electron 仓库事务级联删除 generation_events/generation_jobs/generation_batches），双端同一状态门禁：仅 completed/cancelled 可删，进行中/等待审核先停止；已入正史的章节、候选稿与用量统计不受影响。UI：工作台对已完结批次显示「删除记录」（危险色 + window.confirm 二次确认）；store `deleteBatch` 同步清理列表与任务缓存，选中批次删除后自动回退到最需关注的批次 | `tests/contract` 双端“删除不存在批次错误语义一致”；`tests/main/database.test.ts` 生命周期用例（进行中拒绝 → 取消 → 级联清理任务与活动日志）；`tests/web/novel-store-flows.test.ts` store 状态清理用例；`pnpm check` 通过（181 项测试） |
| AN-030 | [x] | 故事总览仪表盘（整书视角“看得见”） | 用户 1–20 章完成后提出全局查看+微调需求；数据实证：伏笔 84 条未回收 82、人物状态同章重复/矛盾（28 岁 vs 24 岁）、142 条 AI 建议零人工过目。`domain/story-overview.ts` 纯本地聚合（零 token）：人物出场（首末章/活跃章/状态数/最新状态）、道具流转链（跨人跨章持有合并）、伏笔进度（埋设→回收+年龄+超期）、各章摘要行、统计卡片；连续性页新增「故事总览」默认首视图，左栏记忆体检问题清单可跳转对应台账 | `tests/domain/story-overview.test.ts` 8 项（聚合一正一反 + 体检形态含线上事故复现）；`pnpm check` 通过（202 项测试） |
| AN-031 | [x] | 整书连读 + 作者疑点标记 | 新 BookReaderPage（路由 /novels/:id/book，连续性页顶栏入口）：左侧章节目录锚点跳转、右侧连续滚动连读全部已入正史章节；每章「标记疑点」内联表单把问题写入全局审查台账。GlobalFinding.source 扩展 `author`，三处合并逻辑（store 规则校验 / web 与 electron AI 审查）均保留 author 记录不随轮次清除 | `tests/web/global-review-chain.test.ts`：规则与作者记录均不被 AI 审查清除；类型贯穿双端；`pnpm check` 通过 |
| AN-032 | [x] | 全书分窗口 AI 通读审稿 | `domain/whole-book-review.ts`：窗口切分（默认 5 章/窗，只收已入正史）、窗口 prompt（滚动摘要续读 + 人物速览 + 已知问题防重 + 正文按预算均分裁剪）、解析（zod 兜底 + 同窗复述去重 + 含章节定位的稳定 id）。编排下沉 `application/whole-book-review-runner.ts`（双端共享：逐窗口事件/用量留痕、book:* 发现整体替换上一轮、跨窗口重复 id 去重防主键冲突、忽略状态延续、author/rule 发现保留）。端口 `reviewWholeBook`：Web/Electron 薄壳装配（requestWebPlanning / streamOpenAICompatible）。审查页「全书通读审稿」按钮（费用确认 + 逐窗口进度事件） | `tests/domain/whole-book-review.test.ts` 7 项；`tests/web/whole-book-review.test.ts` 3 项（窗口顺序/滚动摘要/留痕/替换语义/跨窗去重/空书错误）；`pnpm check` 通过（202 项） |
| AN-033 | [x] | 记忆清理（重复状态合并 + 伏笔批量处置） | `buildStoryOverview` 记忆体检结构化产出：duplicate-state（同人物同章完全相同 → 一键保留最早条删重复）、multi-state-chapter（同章多条不同状态 → 提示人工核对矛盾）、overdue-foreshadow、dangling-ref（error）。总览页重复状态卡片逐条「保留一条删重复」；伏笔进度表勾选后批量废弃（abandoned，保留记录）或批量删除（confirm 二次确认），全部走既有正史写路径 | `tests/domain/story-overview.test.ts` 体检 4 用例（含 28 岁 vs 24 岁形态与一键修复清单）；`pnpm check` 通过 |
| AN-035 | [x] 全自动巡航（跨周期无人值守连跑到目标章数） | 用户定案的两段式：地基期人工精控现有流程不变；信任建立后开启「全自动巡航」一个按钮循环跑到目标章数。循环体：周期规划（提案自动处理）→ 建批次 → 正文连写+正史建议自动接受（复用 AN-026/028）→ 封存（实际结束状态从最新正史记忆确定性起草，门禁照跑：提案清零+全局校验无 error）→ 下一周期，直至目标章/出错/额度耗尽。已定参数：① 不卡第一卷封存，10 步向导完成即可开启；② 不设预算上限——途中额度耗尽即停在原地并记录状态，修复后可续跑。安全边界：全局校验 error 整线暂停、连续失败暂停并留原因、全程留痕可事后审计（总览/连读/通读审稿）、断点续跑（重启自动重挂载）。实现：domain/workflow-cruise.ts（CruiseState 状态机、draftClosingState 从最新正史记忆确定性起草实际结束状态≤480字、nextCycleRange 对齐目标/目录、cruisePolicy 沿用策略只换范围）；store tickCruise（3 秒轮询）：无运行→按封存进度启动 autopilot 运行；proposal_review→自动接受全部 pending 设定提案并续跑；phase_review→代点继续；chapter_review→交给自动接受；批次预算耗尽/运行失败/全局校验 error/连续 3 次失败→转 paused 并记录原因（继续巡航一键续跑）；completed→章节全部入正史后过 AN-027 门禁→自动封存（起草实际结束状态）→开下一周期运行→到达目标收工并关闭自动接受。开关持久化 amy-novel:cruise，启动重挂载（paused 保持暂停）。UI：规划页第 10 步「全自动巡航」卡片（目标章数、开启确认弹窗、状态与暂停原因、继续/停止）。不卡第一卷封存（用户定案）；不设预算上限，批次预算耗尽即停可续（用户定案） | tests/domain/workflow-cruise.test.ts 5 项（起草/范围/策略）；tests/web/cruise.test.ts 7 项（启动新周期、提案自动接受续跑、失败暂停、预算耗尽暂停、等待入正史、封存+下一周期、目标收工+持久化清理）；pnpm check 通过（214 项测试）；真实模型长跑效果待用户实测 |
| AN-034 | [x] | 全局微调（查找 → 逐章预览 → 确认替换 + 版本快照） | `domain/revision.ts`：确定性全书查找（计数+首命中上下文预览，空词拒绝、单字允许）与整章替换（同词/空词不执行、替换为空即删除）。连读页「全局修订」面板：输入查找/替换词即时检索 → 命中章节列表（预览片段高亮）→ 逐章 confirm 确认替换 → `saveChapter` createSnapshot=true（origin=manual，写作台版本历史可回滚），并明示正史记忆不自动联动（AN-021 范围） | `tests/domain/revision.test.ts` 5 项（跨章命中/空词拒绝/单字/计数/删除语义）；`pnpm check` 通过 |

## 已完成基础能力

- Phase 0 工程基线与 Phase 1 本地写作闭环；
- 滚动批次范围、规划日志、正史门禁、候选链、硬 Token 预算、429/5xx 退避；
- 真实 API `1–10 → 11–20` 闭环评估；
- 可配置批次大小、篇幅顾问、AI 简报起草和确定性结束状态拼装；
- Windows 0.1.0 安装/启动/卸载历史验收。

详细历史证据见 `ACCEPTANCE_REPORT.md` 和 `E2E_ROLLING_CYCLE.md`。

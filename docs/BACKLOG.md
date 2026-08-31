# 任务台账

> 本文件是任务状态的唯一权威来源。路线图只描述阶段目标，验收报告只记录已经执行的验证。
> 状态定义见 `DEVELOPMENT_GUIDE.md`。最近审计：2026-08-31。

## 当前结论

2026-08-31：P0 全部收口；P1 中 AN-010 Renderer 流程测试、AN-011 双端契约、
AN-012 安全加固已完成，发布阻塞项只剩发布工程（版本号、发布说明、安装包冒烟）
与 AN-015 签名决策。AN-013（前端拆包）、AN-014（CI）不阻塞发布，留待 v1 后。
真实模型 autopilot 评估已通过（`ACCEPTANCE_REPORT.md`）；运行语义见
`AUTOPILOT_WORKFLOW.md` 6.1 节。评估发现的“候选已生成但事实提案为 0 无提示”
问题与 AN-021 版本化记忆、AN-023 审查重写留待 v1 后迭代。

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

## P2：产品能力

| ID | 状态 | 事项 | 当前证据 | 完成验收 |
| --- | --- | --- | --- | --- |
| AN-020 | [x] | 文风模板库 | 已有 Domain、SQLite/Web、IPC/Preload、模板页、单章/批量应用和域/数据库测试；样章只在本地保存，生成只注入抽象风格卡 | 当前自动化检查通过；真实模型效果留待专项评估 |
| AN-021 | [~] | 版本化记忆 | 人物状态、技能、过期候选识别已有基础；章节摘要、通用实体状态、关系版本和完整失效传播未完成。2026-08-31 真实评估发现：第 4–5 章事实提取静默产出 0 条提案，候选审核界面无任何提示，接受后将得不到记忆回写 | 改写章节后所有派生记忆与后续候选可追踪失效；项目包保留版本链；候选的事实提案为 0 时界面有可见警示 |
| AN-022 | [x] | Autopilot Workflow Runner | `workflow_runs` 表与 `run-workflow.ts` 编排已落地，复用现有规划器和 BatchRunner；三档检查点（阶段/提案/章节审核）、批次事件驱动的状态收敛、失败重试与断点恢复、规划页运行台均已实现，运行语义见 `AUTOPILOT_WORKFLOW.md` 6.1 | 三档模式暂停点、提案门禁、重试耗尽、失败恢复重置预算、双端批次收敛差异的编排测试与 SQLite 持久化用例通过；`pnpm verify` 通过（115 项测试，双端生产构建）；真实模型 autopilot 全流程评估通过（两轮驱动、候选不入正史、预算 4.7k/80k），记录见 `ACCEPTANCE_REPORT.md` 2026-08-31 |
| AN-023 | [ ] | 审查驱动重写与可选自动采纳 | 尚无自动重写闭环；默认不得自动写正史 | error 反馈最多 N 次；默认关闭自动采纳；启用时满足质量门槛并保留回滚版本 |
| AN-024 | [x] | 人物阵容建议与运行日志 | 域测试覆盖解析与过滤；`tests/web/web-advisory-chain.test.ts` 走真实 webPlatform + stub fetch 全链路（别名命中、extra/未知人物过滤、请求载荷与会话密钥、非 200 错误可读）；`tests/web/persona-panel.test.tsx` 覆盖推荐→调整→批量确认写入正式设定的 UI 回归 | `pnpm verify`、关键 UI 回归与双端契约（AN-011 契约套件 + 共享解析域测试）通过 |

## 已完成基础能力

- Phase 0 工程基线与 Phase 1 本地写作闭环；
- 滚动批次范围、规划日志、正史门禁、候选链、硬 Token 预算、429/5xx 退避；
- 真实 API `1–10 → 11–20` 闭环评估；
- 可配置批次大小、篇幅顾问、AI 简报起草和确定性结束状态拼装；
- Windows 0.1.0 安装/启动/卸载历史验收。

详细历史证据见 `ACCEPTANCE_REPORT.md` 和 `E2E_ROLLING_CYCLE.md`。

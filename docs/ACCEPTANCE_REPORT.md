# Amy Novel 0.1.0 发布验收报告

> 本文前半部分保留 0.1.0 发布时的历史结果。后续开发分支验证单独记录，不回写历史数字。

验收日期：2026-08-30  
平台：Windows x64  
安装包：`release/Amy-Novel-0.1.0-Setup-x64.exe`

## 自动化检查

| 检查项 | 结果 |
| --- | --- |
| Node/Electron TypeScript 检查 | 通过 |
| Web TypeScript 检查 | 通过 |
| 单元与数据库测试 | 12 个文件、26 项测试全部通过 |
| Web 生产构建 | 通过 |
| Electron 生产构建 | 通过 |
| Windows NSIS x64 打包 | 通过 |

## 安装闭环

安装包被静默安装到独立的 Windows 临时目录，并使用隔离的测试 Profile 启动，因此未读取或修改现有 Amy Novel 用户数据库。

| 检查项 | 结果 |
| --- | --- |
| NSIS 安装退出码 | 0 |
| 安装后主程序存在 | 通过 |
| Electron 窗口进入 Input Idle | 通过 |
| 主程序持续运行、无启动闪退 | 通过 |
| NSIS 卸载退出码 | 0 |
| 卸载后主程序删除 | 通过 |
| 临时 Profile 与安装目录清理 | 通过 |

## 已验证的核心链路

- 小说创建、章节正文保存与不可变版本。
- 故事圣经、角色实体、分卷与场景。
- Context Pack 与 Token 预算。
- 单章及批量候选稿状态机。
- 确定性质量检查与 AI 事实建议审阅。
- TXT、Markdown 和完整项目包导出。
- 项目包校验、ID 重映射与恢复为新作品。
- API Key 不进入数据库、诊断报告或项目包。

## 外部验收项

以下项目依赖发布者持有的外部资源，未在自动化环境中伪造：

- 使用真实模型 API Key 完成一次在线章节生成。
- Windows 商业代码签名与 SmartScreen 信誉。
- 自动更新发布源。

这三项不影响 0.1.0 本地开源 MVP 使用，其中代码签名和自动更新属于正式分发增强项。

## 2026-08-30 开发分支增量验证

本轮为 Autopilot Workflow Runner 补齐前置可靠性，没有发布新版本：

| 检查项 | 结果 |
| --- | --- |
| Node/Electron TypeScript 检查 | 通过 |
| Web TypeScript 检查 | 通过 |
| Vitest | 16 个文件、56 项测试全部通过 |
| Web 生产构建 | 通过 |
| Electron 主进程、预加载与 Renderer 生产构建 | 通过 |
| 十步向导浏览器回归 | 通过：未补全不可确认、确认后逐步解锁、无控制台错误 |
| Git diff 空白错误检查 | 通过 |

已覆盖：未接受候选稿的正史门禁、Web/Electron 共用模型请求体、429/5xx 退避、
`Retry-After`、串行硬 Token 预算、单批次单执行器、候选链上下文，以及当前策划范围的
章节标题与章纲数量门禁。

本轮同时验证 `planning_workflows` 在 Web/Electron 适配器中的持久化、项目包导入导出、
上游修改导致下游确认失效，以及生成批次在界面与数据库入口的双重门禁。Web 与 Electron
现在共用规划提示词选择、输出预算和结构化结果落库服务；“我的作品”页已验证显示独立删除入口。

尚未执行真实 10–20 章在线评估。该步骤需要作者提供真实模型配置并确认 API 费用；评估
门槛见 `AUTOPILOT_WORKFLOW.md`。在评估通过前不把 Workflow Runner 标记为已完成。

## 2026-08-30 滚动十章 Harness 增量

本轮把第 7–10 步从“一次规划全书”改为可重复的十章闭环。已通过 TypeScript 检查和
Vitest 19 个文件、62 项测试。覆盖范围包括：范围化策划 Schema、规划原始响应恢复、
策划周期门禁、锁定设定拒绝修改、设定提案审核、人物技能记忆、候选接受状态和规划数据
随项目包备份恢复。

Web 与 Electron 生产构建均通过。本地浏览器回归确认新版第 7–10 步文案、渐进锁定和
旧作品工作流恢复正常，页面无控制台警告或错误；本次没有调用外部模型，也没有把静态
页面检查冒充真实生成闭环。

尚未在本记录中宣称完成的项目：真实 API 1–10/11–20 连续评估、批次事实提案全部处理
门禁、通用实体状态版本化、章节改写后的记忆失效传播，以及最终 Workflow Runner。

## 2026-08-30 真实 API 滚动十章闭环

首次用真实模型（智谱 GLM-5.2 Coding Plan）完成 `1–10 规划 → 正文 → 正史 → 记忆回写 →
封存 → 11–20 规划` 全链路，由 `tests/e2e/rolling-cycle.e2e.test.ts` 无头驱动（默认
跳过，需 `AMY_E2E_REAL=1`），复用产品自身的数据库、BatchRunner 与领域服务。

| 检查项 | 结果 |
| --- | --- |
| Node/Electron TypeScript 检查 | 通过 |
| Web TypeScript 检查 | 通过 |
| Vitest | 19+1 个文件、64 项通过、9 项 E2E 环境门控跳过 |
| 规划调用（含重试） | 12 次，6 次失败全部落 `planning_runs` 并可恢复 |
| 1–10 章正文 | 10/10 生成并接受，860–1,266 字/章，0 个 error 级质检问题 |
| 记忆回写 | 72 条事实提案，32 条进入正史（26 timeline + 6 人物状态） |
| 周期状态机 | 周期 1 封存 completed，周期 2 七项检查通过进入 ready |
| 记忆进入下一批 | 第 11 章 Context Pack 含全部人物状态与时间线；规划侧缺口已记录 |

评估暴露并已修复两项解析边界：`profile` 数组/数字值归一化、卷名范围后缀归一化匹配
（均含域测试）。遗留问题与下一步排序见 `E2E_ROLLING_CYCLE.md`：事实提案 payload
形状容错与批次记忆审核硬门禁、滚动提示词注入封存记忆、一次低温 JSON 修复调用、
实体短引用与跨阶段合并。评估通过前 Workflow Runner 仍不标记完成。

## 2026-08-30 生成状态跨页面保持

修复“AI 生成中切换页面，回来后按钮不再旋转、误以为已完成”的问题。根因：规划向导与
单章生成页的进行中状态是组件本地 state，页面卸载即丢失。现改为挂在全局 store：
`planningBusy`（每作品的规划阶段）、`planningMessage`（跨页面回显的结果/错误文案）、
`activeRequests`（每章节的生成请求，返回后按钮显示已进行秒数并禁用，防止重复发起）。
单章生成页的候选稿改为从 store 派生，生成期间离开页面、完成后返回可直接审阅。

浏览器实测（本地 mock 模型 + Web dev）：规划生成中切页返回按钮保持“正在生成”、
完成后结果文案回显；单章生成中切页返回按钮显示“生成中… N 秒”且禁用，完成后候选稿
自动出现。TypeScript 双端检查与 64 项测试通过。

## 2026-08-30 滚动批次大小可配置

把“每批规划章数”从硬编码 10 章改为作品级配置 `cycleSize`（5–15，默认 10）。域层
`Novel.cycleSize` + `normalizeCycleSize` 归一化；novels 表迁移补列（插入改为显式列名，
兼容新旧库）；Electron IPC `novels:settings:update` 与 Web localStorage 双端实现，读取
时对旧数据统一归一化；项目包 schema 对旧包回退默认值。新建作品表单增加“每批规划章
数”，规划向导第 7 步可中途调整——已开始的批次不受影响，从下一个新批次生效；步骤名、
按钮与提示文案按批次大小动态渲染，滚动提示词本就范围无关无需修改。

验证：TypeScript 双端检查通过；Vest 67 项测试通过（新增 `planningCycleRange` 自定义
批大小/归一化用例与 `cycleSize` 持久化/更新用例）；浏览器实测创建 6 章/批作品后第 7
步范围显示第 1–6 章、mock 模型按范围返回 6 章、中途改为 8 保存后侧栏文案即时更新且
当前批次保持 1–6 不变；旧作品（无 cycleSize 的 localStorage 数据）正常显示与规划。

## 2026-08-30 开书篇幅顾问（番茄平台规则内置）

新增「Amy 篇幅顾问」：新建作品页可按核心设定与补充想法生成开书建议——体量档位、
总章数、单章字数、日更章数与预计完本天数、分卷骨架、关键里程碑（黄金三章/30 章
考核/大高潮）与新人注意事项，一键应用到创建表单。平台规则（单章 2000–3000 字、
黄金三章、30 章追读考核、新人 20–60 万字起步）内置在 `scope_advisory` 提示词模板
中，模型只做实例化，不临场发明平台标准；建议不落库、应用前不改任何表单。

实现：`@domain/scope-advisor`（zod 校验 + 复用规划 JSON 解析边界）、双端
`suggestNovelScope`（Electron IPC `advisory:scope:suggest` / Web fetch，关闭思考、
输出上限 3000 token）、store 动作与建议卡 UI。验证：TypeScript 双端通过；70 项
测试通过（新增 3 项：提示词含平台规则与作者输入、围栏 JSON 解析、越界与多 JSON
拒绝）；浏览器确认入口与建议卡正常渲染，交互链路因会话内浏览器输入通道退化未完
整演练，留待下次回归。

## 2026-08-30 AI 代笔简报、记忆生成结束状态与全流程审核要点

把十步向导进一步推向“AI 代笔、作者审阅”：第 1 步新增「让 Amy 起草全部简报（第
1–2 步）」，一次模型调用生成七项简报草稿填入表单（作者逐项修改后照常确认）；起草
结果挂在全局 store，切页不丢。提示词内置各字段写法规范（文风要可操作规范、禁忌是
作者死设定只做保守占位），复用规划 JSON 解析边界与七项非空校验。第 10 步新增「由
本批记忆生成」：`composeClosingState` 确定性组装本批人物最新状态（位置/目标/道具/
技能）与未决伏笔，不调模型，作者改两笔即可封存。每一步新增静态「审核要点」卡（3
条左右），明确看什么、什么算有问题，不消耗 token。

修复一处过程中引入的缺陷：起草完成曾触发工作流同步副作用把 `activeStep` 重置回
`nextPlanningStep`，导致起草后跳步；已将“草稿播种表单”与“步骤重置”拆分为独立
effect。验证：TypeScript 双端通过；74 项测试通过（新增简报起草 3 项与
composeClosingState 范围过滤/最新状态/伏笔过滤 1 项）；浏览器实测第 1 步起草填
充、按钮态切换、要点卡渲染与不跳步回归（mock 模型新增 brief 分支）。

## 2026-08-31 看板审计与开发门槛规范化

本轮没有把旧路线图描述直接当作完成事实，而是按当前代码、测试和真实 E2E 证据逐项
复核。原 6 项交接任务的结论为：文风模板完成；事实提案容错完成、记忆审核硬门禁部分
完成；封存记忆注入、低温 JSON 修复、实体短引用/去重和 Workflow Runner 未完成。
详细状态、证据和验收标准已集中到 `BACKLOG.md`。

新增根目录 `AGENTS.md`、`docs/DEVELOPMENT_GUIDE.md`、`.editorconfig` 和统一命令
`pnpm check` / `pnpm verify`。路线图只维护阶段目标，任务状态只在 Backlog 更新，历史
验收只追加不改写。同步修正技术架构文档中 Web 存储、实际目录和测试现状，并清理
`GenerationBatch` 重复类型声明。

本轮实际执行结果：

| 检查项 | 结果 |
| --- | --- |
| Markdown 本地链接 | 通过 |
| Git diff 空白错误 | 通过 |
| Node/Electron TypeScript | 通过 |
| Web TypeScript | 通过 |
| Vitest | 23 个文件、93 项通过；1 个文件、9 项真实 API E2E 跳过 |
| Web 生产构建 | 通过；主 JS 537.24 kB，保留大于 500 kB 的拆包警告 |
| Electron 生产构建 | 通过；main 216.19 kB、preload 12.64 kB、renderer 1,226.54 kB |

本轮没有运行真实付费模型 E2E、Windows NSIS 打包或安装冒烟；这些结果不得从历史记录
推断为当前工作区已验证。

## 2026-08-31 AN-001 下一周期封存记忆

完成滚动策划的动态正史输入：第 2 个及后续周期读取上一已封存周期的预期/实际结束状态、
当前范围前每名人物的最新状态、开放伏笔与时间线尾部。摘要在共享 Domain 函数组装并硬
限制为 4,000 字符，Electron 与 Web 只负责提供同构数据；Prompt 明确实际结束状态和动态
正史优先，禁止无解释复活已退场人物或忽略开放伏笔。

新增回归复现真实评估的第 10→11 章问题：测试确认第 11–20 章规划 Prompt 能看到“洛沉璧
残念已经消散”“银帆拆塔”人物状态、伏笔和时间线。`pnpm verify` 为 23 个测试文件、95 项
通过，9 项真实 API E2E 跳过；规划定向测试 13 项通过，Web/Electron 生产构建通过。
真实付费模型 E2E 尚未重跑。

## 2026-08-31 AN-003 单章审批与记忆审核硬门禁

完成候选正文与派生记忆的两阶段门禁。Electron IPC 与 Web Platform 接受候选稿后只将
正文写入正史；若该候选仍有 `proposed` 事实提案，生成任务保持 `candidate_ready`，最后
一条提案接受或拒绝后才转为 `completed`，下一章才可运行。周期保存到 `completed` 前，
数据层会汇总范围内全部已接受候选的事实提案，存在待处理项时拒绝封存。

新增共享 Domain 规则测试，覆盖“候选已接受但尚有待审事实”“事实全部处理”“候选尚未
接受”三种状态；SQLite 集成用例覆盖周期有 1 条待审事实时封存失败、处理后封存成功。
`pnpm verify` 通过：23 个测试文件、96 项测试通过，1 个文件、9 项真实 API E2E 跳过；
Web 与 Electron 生产构建均通过。Web 主包 540.87 kB 的拆包警告仍由 AN-013 跟踪，真实
付费模型 E2E 未重跑。

## 2026-08-31 AN-004 一次低温 JSON 修复

Electron 与 Web 的规划生成现在先保存模型原始响应，再用共享校验器判断是否属于 JSON
语法或 Schema 结构错误。仅此类错误会构造只修结构、不改故事事实的修复提示，以 0.1
温度调用同一模型一次；章节范围不完整等业务错误不会触发修复。修复结果再次走同一校验，
仍失败时直接结束，不进行第二次修复。

`planning_runs` 新增兼容迁移字段 `repair_response`，原始响应与修复响应分别保留，Token
累计记录；项目包 Schema 对旧包默认空修复响应，导入 SQL 改为显式列名。规划页生成记录
可分别查看两份响应。测试覆盖首次修复成功、修复结果再次失败只调用一次，以及 SQLite
双响应和累计 Token 留痕。

`pnpm verify` 通过：24 个测试文件、98 项测试通过，1 个文件、9 项真实 API E2E 跳过；
Web 与 Electron 生产构建均通过。Web 主包 543.17 kB 的拆包警告仍由 AN-013 跟踪，真实
付费模型 E2E 未重跑。

## 2026-08-31 AN-005 实体短引用、合并提案与周期去重

既有实体现在以实体 ID 派生的稳定 `E-…` 短引用进入滚动结构、人物和场景规划 Prompt；
模型返回明确引用，或名称/别名完全匹配时，才会更新既有卡。短引用在章节计划落库前还原
为作者可读名称。对于“守灯人旧部首脑·崔衡”与“崔衡”这类限定名同核心称呼，系统不再
静默合并或新建第二张卡，而是生成全局合并提案，作者接受后把新称呼并入既有卡别名。

规划提案新增 `target_ref` 兼容迁移与 `merge` 动作；同类型、同规范化名称的新增提案在
待审或已接受后不会跨周期重复创建。SQLite 与 Web 共用同一提案身份规则。项目包支持新
字段，恢复成新作品时提案短引用会按实体的新 ID 重映射。

测试覆盖短引用解析与重映射、限定名近似检测不误认错字、跨阶段重复卡转合并提案、合并
审核、跨周期已接受新增提案去重，以及项目恢复引用重映射。`pnpm verify` 通过：24 个测试
文件、102 项测试通过，1 个文件、9 项真实 API E2E 跳过；Web 与 Electron 生产构建通过。
Web 主包 547.99 kB 的拆包警告仍由 AN-013 跟踪，真实付费模型 E2E 未重跑。

## 2026-08-31 AN-022 Autopilot Workflow Runner

Workflow Runner 按既定约束实现：复用现有规划器（`generateNovelPlan`）与 BatchRunner，
不另建调度框架。新增 `workflow_runs` 表持久化运行状态（阶段、检查点、重试计数、挂接
批次），`src/application/run-workflow.ts` 编排五个阶段的推进与恢复；规划页第 10 步新增
Autopilot 运行台，提供三档模式选择、启动/继续/重试入口和运行状态卡。

三档检查点落地为：checkpoint 模式逐规划阶段暂停等作者审核；存在待审设定提案时三种
模式一律暂停（含全自动候选）；正文阶段 autopilot 关闭单章审批连续生成候选稿、其余两
档沿用单章审批，任何模式都不自动写正史。批次状态到运行状态的收敛规则（完成/失败/
等待章节审核/暂停）由 `workflow-run.ts` 单点维护：Web 在恢复调用内同步收敛，Electron
由批次广播事件驱动 store 收敛，避免后台批次完成后运行状态悬挂在 running。

实现过程中修复两处重入缺陷：其一，暂停在提案审核的运行恢复时直接跳到建批次，绕过
提案复检与九步代签，导致提案处理完毕后反而因第 9 步未确认而失败，现恢复时强制重走
`prepareGeneration`；其二，失败运行的恢复不重置阶段重试预算，重试一次即再次失败，现
从失败恢复视为作者再试一次，预算归零。非 checkpoint 模式在提案清零后由 Runner 代签
九步向导确认（等价规则：范围内提案全部处理视为规划确认），checkpoint 模式永不代签；
运行语义整体记录在 `AUTOPILOT_WORKFLOW.md` 6.1 节。

测试新增 13 项：Application 层覆盖三档模式暂停点、提案门禁、阶段失败重试耗尽、失败
恢复重置预算、批次完成不重复拉起、Web/Electron 暂停收敛差异；Domain 层覆盖阶段推进/
回退互逆、标签完备性与批次映射全分支；SQLite 集成用例覆盖运行记录创建、部分更新、
断点恢复与删除级联清理。`pnpm verify` 通过：26 个测试文件、115 项测试通过，1 个文件、
9 项真实 API E2E 跳过；Web 与 Electron 生产构建通过。Web 主包 1,264.65 kB 的拆包警告
仍由 AN-013 跟踪；真实付费模型下的全自动运行评估未执行，留待专项授权。

## 2026-08-31 AN-022 真实模型全自动运行评估（用户授权）

作者明确授权后，以 `tests/e2e/workflow-autopilot.e2e.test.ts`（`AMY_E2E_REAL=1`）
用智谱 GLM-5.2（Coding Plan 端点）驱动真实 `resumeWorkflowRun` 完成 autopilot
全流程：新作品《全自动运行评估·灯约残响》（10 章目标、每批 5 章、单章 800 字），
运行范围第 1–5 章。驱动端口与产品同构：规划镜像 `novel-ipc` 处理器（含 AN-004
低温修复路径），正文复用 BatchRunner，批次状态收敛镜像
`store.syncWorkflowRunFromBatch`。

结果（总耗时约 7.3 分钟，2 项断言全绿）：

- **两轮驱动到达终态**。第 1 轮单次 resume 连跑圣经→人物（12 实体）→场景（21 实体）
  →结构（3 卷、5 章策划）四个阶段，随后按设计暂停在 proposal_review（“仍有 1 条设定
  提案等待作者处理”）；作者接受 1 项新增提案后第 2 轮创建批次并连续生成，批次完成后
  运行收敛为 completed。
- **正史门禁在真实链路成立**：5 章候选全部停在“候选稿”，章节未接受，事实提案全部
  待处理——全自动模式产候选不写正史。
- **预算与留痕**：批次输出 4,693 / 80,000 tokens；37 条生成事件、4 条规划运行记录
  （含原始响应）全部落库；累计输入 59,344 / 输出 38,202 tokens（含首次尝试中
  评估脚本自身缺陷造成的 3 次圣经调用，原始响应均已留痕，无付费结果丢失）。
- **重试语义经过真实失败验证**：首轮评估因测试脚本错误导入（`validateNovelPlanContent`
  来源模块写错）三次圣经调用全部失败，Runner 按预算正确转入 failed 并保留错误；修复
  导入后从 failed 恢复，重试预算重置，一次通过全部阶段。

评估发现与后续跟踪：

1. 第 1–3 章各提取 9–10 条事实提案，**第 4–5 章为 0 条**。事实提取是设计的非阻塞
   辅助调用，失败不阻断候选稿；但“候选已生成而记忆提案缺失”目前无任何提示，作者
   接受这两章时不会得到记忆回写。建议在候选审核界面显示“事实提案 0 条”警示，纳入
   AN-021 版本化记忆范围。
2. 四个规划阶段本次均一次解析成功，AN-004 修复路径未触发（保持既有自动化测试覆盖）。

工程改进（同日）：`tests/` 纳入 `tsconfig.node.json` typecheck 范围，清掉 23 处
存量类型欠账（fixture 缺 `cycleSize`/`scopeAdvice`、空值收窄、未使用导入等）；
规范写入 `DEVELOPMENT_GUIDE.md` 第 4 节。`pnpm check`（115 项测试）与
`pnpm verify` 均通过；评估后临时密钥文件已删除。

## 2026-08-31 AN-006 Web 长篇存储迁移 IndexedDB

Web 端所有 `amy-novel:` 键值数据从 localStorage 迁至 IndexedDB。新增
`src/renderer/src/platform/web-storage.ts`：内存镜像维持原同步 `read/write` 接口
（约 40 处调用点零改动），持久化走写穿队列按提交顺序执行；启动装载 IndexedDB 到
镜像后，一次性把旧 localStorage 数据迁入并清源（中断重跑不会用旧值覆盖新数据），
localStorage 只保留迁移标记。首屏读取前由新增的 `PlatformPort.ready()` 等待装载
完成，store 的 `loadNovels` 统一走该门（Electron 端立即返回）；`deleteNovel` 与
findings/proposals 键扫描改为经存储层删除/枚举，不再直接触碰 localStorage。

测试（jsdom + fake-indexeddb，走真实 `webPlatform` 端口）：旧 localStorage 作品与
章节迁移后可读、原键清源且无关键不受影响；60 章 × 4,000 字正文写入后模拟页面重载
全部恢复、localStorage 无任何数据键；项目包导入往返（正文/版本/实体/工作流一致）
与删除作品后的存储清理。工程侧新增 `tests/web/` 归属 web typecheck 工程（渲染层
测试不再拉入 node 工程，避免 `window` 全局声明失效）。`pnpm verify` 通过：
27 个测试文件、118 项测试通过，双端生产构建通过。

## 2026-08-31 AN-011 PlatformPort 双端契约测试

新增 `tests/contract/platform-port.contract.ts` 共享契约套件：同一组 7 项用例分别经
`tests/contract/electron-port.test.ts`（NovelDatabase 内存库，方法映射与 novel-ipc
一致）和 `tests/web/web-platform-contract.test.ts`（webPlatform + IndexedDB，
jsdom + fake-indexeddb）运行。覆盖：`ready()` 就绪门、小说创建/章节骨架/cycleSize
上限归一化、章节保存 CJK 字数与不可变版本快照、第 9 步未确认时创建正文批次的
错误文案、workflow run 创建/部分更新/列表 DTO、文风模板保存与列表、项目包导入的
恢复标题/章节/版本/工作流与实体短引用按新 ID 重映射。

套件首轮即发现并澄清两处边界：`getStyleTemplate` 只存在于数据库层、不属于端口
契约（测试面已对齐端口定义）；项目包中 cycleId 不存在于包内周期的提案会被过滤，
该规则两端一致执行。双端 14 项契约用例通过；`pnpm verify` 通过：29 个测试文件、
132 项测试通过，双端生产构建通过。契约套件位置与维护规则已写入
`DEVELOPMENT_GUIDE.md`。

## 2026-08-31 AN-012 IPC 运行时校验与 Electron 导航安全

**IPC 信任边界**：`registerNovelIpc` 入口对全部 `ipc.handle` 做单点包裹，写通道参数
先经 `ipc-write-guards.ts` 守卫表（约 50 个通道：小说/章节/结构/圣经/连续性/批次/
工作流运行/文风模板，以及直接产生付费调用的单章生成）。守卫只做类型与形状检查
（非空 ID、数值区间、封闭枚举、数组元素），不重建对象、不记录参数值（密钥与正文
永不进入日志）；校验失败以 rejected promise 返回渲染层并带通道名与原因。守卫形状
与 Domain 输入类型逐一核对（createChapter/SaveVolume/SaveScene 无 position、
characterState.chapterId 可空等），避免过度限制正常调用。

**导航安全**：`window-security.ts` 把决策做成纯函数——窗口内只允许应用自身页面
（开发服务器 origin 或生产 renderer 目录的 file:// 前缀，带分隔符防同前缀目录逃逸），
`setWindowOpenHandler` 一律拒绝新窗口、http(s) 外链转交系统浏览器；`will-navigate`
拦截一切非应用导航。窗口原本已具备 sandbox + contextIsolation。

**CSP**：双端入口分别配置——Electron 渲染层（`src/renderer/index.html`）零网络
（connect-src 仅开发 HMR），Web 入口（`index.html`）放开 https: 与本机端口供渲染
进程直连用户配置的模型端点；脚本源均只允许自身，无 unsafe-eval/inline。测试同时
断言源文件与 `pnpm verify` 的双端构建产物（out/renderer、dist-web）均含 CSP。

测试：守卫表键完整性、原型污染/枚举伪造/数值越界拒绝、合法参数与密钥字段放行、
导航前缀与逃逸、新窗口决策、双端 CSP 差异共 9 项通过；`pnpm verify` 通过
（30 个测试文件、141 项测试，双端生产构建）。开发模式 HMR 的 CSP 实机表现待下次
`pnpm dev` 冒烟确认。

## 2026-08-31 AN-010 Renderer 关键流程测试 与 AN-024 人物阵容收尾

**AN-010**：新增 Renderer 测试基建（vitest `@renderer` 别名、`.tsx` 用例支持、
@testing-library/react），`tests/web/novel-store-flows.test.ts` 以真实 zustand
store + 可推进的模拟平台覆盖三条发布关键链路：规划门禁（跳步确认被域规则直接拒绝
"请先确认第 8 步"，第 9 步未确认时创建正文批次被数据层拒绝；按序确认 1–9 后放行）、
候选接受与事实审核（候选稿未接受时 `reviewFactProposal` 被
`assertCandidateAcceptedForCanon` 拒绝且不产生任何正史写入；接受后伏笔以
ai_candidate 来源写入并同步状态）、生成中切页恢复（批次由模拟主进程后台推进，
页面重新挂载只做 loadBatches/loadJobs 即恢复 running 与 awaitingReview 状态；
全部事实提案处理后任务与批次按 AN-003 门禁收敛为完成）。

测试首跑即暴露一个真实隐患：PersonaPanel 的 zustand selector 写作
`?? []` 每次返回新数组引用，`useSyncExternalStore` 快照不稳定可触发无限重渲
（页面主体均用稳定 EMPTY_LIST 常量，该后写组件不一致）。已修复为快照外兜底，
UI 测试同时锁定该写法。

**AN-024**：`tests/web/web-advisory-chain.test.ts` 用真实 webPlatform（IndexedDB +
sessionStorage 密钥）+ stub fetch 走通人物阵容建议全链路：别名命中主角卡、
extra 与未知人物被过滤、请求载荷与会话密钥正确、非 200 错误可读不静默；
`tests/web/persona-panel.test.tsx` 以真实组件 + 真实 store 完成"推荐 → 调整 →
批量确认"的 UI 回归，断言人格/写作约束/语言习惯以 ai 建议字段写入正式人物设定。
Electron 端同一链路经 IPC 镜像 novel-ipc 处理器，解析与过滤规则由共享 Domain
承担（域测试覆盖），端口 DTO 由 AN-011 契约套件约束。

`pnpm verify` 通过：31 个测试文件、147 项测试通过，双端生产构建。

## 2026-08-31 v1.0.0 发布工程

版本升至 1.0.0（package.json 与 Web 诊断 appVersion 同步），`docs/RELEASE.md`
新增 v1.0.0 版本记录。`pnpm verify` 通过后执行 `pnpm build:win`，产出
`release/Amy-Novel-1.0.0-Setup-x64.exe`（101 MB，NSIS，per-user 安装）。

隔离环境安装/启动/卸载冒烟（临时目录安装，不触碰既有安装）：

- 静默安装 `/S /D=<临时目录>` 退出码 0，`Amy Novel.exe` 与卸载器就位；
- 启动安装版应用，主/渲染进程运行，用户数据目录生成且 `amy-novel.db` 初始化
  （应用完成启动、数据库与 IPC 就绪的证据）；
- 结束进程后静默卸载退出码 0，安装目录清除；
- 按设计卸载保留用户数据（`deleteAppDataOnUninstall: false`），数据库文件仍在。

发布边界：安装包未签名（SmartScreen 提示）、无自动更新（AN-015 待证书与发布渠道）；
gh CLI 不可用，安装包未附到 GitHub Release 附件，需要时经网页端手动上传。

# 技术架构

## 1. 总体分层

```text
┌──────────────── React Renderer ────────────────┐
│ pages / components / features / Zustand       │
└──────────────────────┬────────────────────────┘
                       │ PlatformPort
┌──────────────────────▼────────────────────────┐
│ Application                                  │
│ use cases / generation orchestrator / DTOs   │
└──────────────────────┬────────────────────────┘
                       │ repository + provider ports
┌──────────────────────▼────────────────────────┐
│ Domain                                       │
│ novel / outline / canon / generation policy  │
└──────────────────────┬────────────────────────┘
                       │ adapters
┌──────────────┬───────────────┬────────────────┐
│ Electron IPC │ Web HTTP/IDB  │ Model adapters │
│ SQLite/files │ local preview │ LLM providers  │
└──────────────┴───────────────┴────────────────┘
```

依赖只能向内：Domain 不导入 React、Electron、SQLite、HTTP 或模型 SDK。

## 2. 双宿主策略

### Electron

- 主进程拥有 SQLite、文件系统、模型请求、密钥访问和任务调度器。
- Preload 只暴露白名单方法，渲染器不直接访问 Node。
- 长任务由主进程运行，窗口关闭或页面切换不影响批次。

### Web

- 本机浏览器预览模式的 `web-platform.ts` 数据落 IndexedDB（AN-006）：键值经
  `web-storage.ts` 的内存镜像同步读写，写穿队列持久化；启动时旧 localStorage
  数据一次性迁入并清源，localStorage 只保留迁移标记。首屏读取前由
  `PlatformPort.ready()` 等待装载与迁移完成（Electron 端立即返回）。
- 正式部署时增加 `WebApiPlatformAdapter`，调用独立 Node 服务。
- Web 服务实现同一组 Application Ports；React 页面不做条件分支。
- 浏览器不能安全长期保存第三方 API Key，正式部署必须由服务端密钥库管理。

## 3. 目录职责

```text
src/
├─ domain/             纯实体、值对象、规则、状态机
├─ application/        用例、端口、DTO、生成编排
├─ main/               Electron composition root、SQLite、模型、密钥、后台任务与 IPC
├─ preload/            安全桥
├─ renderer/src/       React 页面、组件、Store 与当前 Web 平台适配
└─ shared/             跨进程协议、事件和可序列化类型
```

## 4. 生成调度器

规划页的人工检查点使用轻量 `PlanningWorkflow` 领域对象，通过 `PlatformPort` 读写：

- Electron 保存到 `planning_workflows`，Web 预览保存到对应适配器键；Renderer 不直接读写宿主存储。
- `brief_json` 保存作者原始创作简报，故事圣经重新生成不能覆盖它。
- `confirmed_steps_json` 只允许从第 1 步开始连续确认，不能伪造跳步。
- 修改故事圣经、人物、场景、分卷或章纲时，从受影响步骤起撤销后续确认。
- 第 9 步未确认时，数据库和 Web 适配器都拒绝创建正文生成批次。
- 项目备份携带工作流状态；旧版备份没有该字段时按未审核状态恢复。

`planning_workflows` 只记录人工规划检查点，不承担后台运行。Autopilot Runner 使用独立的
`workflow_runs` 表：`src/application/run-workflow.ts` 编排规划阶段与正文批次，运行状态
（阶段、检查点、重试计数、挂接批次）持久化到该表，暂停、失败和完成后都可从断点恢复。
批次状态到运行状态的收敛规则由 `src/domain/workflow-run.ts` 单点维护：Web 端批次在恢复
调用内同步执行完毕，返回时即收敛；Electron 端批次在主进程后台执行，由批次广播事件
驱动 store 收敛。两者职责不能混合，运行语义详见 `AUTOPILOT_WORKFLOW.md` 第 6.1 节。

`GenerationBatch` 拆成多个 `ChapterGenerationJob`，同一作品固定串行执行：

```text
queued → building_context → generating → validating
       → continuity_check → candidate_ready → completed
                        ↘ waiting_retry / failed / paused
```

每个阶段写入持久化检查点。恢复批次时读取 Job 状态而不是依赖内存队列。调度器支持：

- AbortSignal 取消当前网络请求。
- 指数退避与供应商 Retry-After。
- 单批次单执行器，防止重复请求和 Token 预算竞争。
- 每章上下文快照和 Prompt 指纹。
- 后章读取同批次前章候选链，候选内容带非正史标记。
- 每次请求的 `max_tokens` 不超过批次剩余硬预算；不足最小输出时安全暂停。

## 5. 模型抽象

模型端口分为能力而不是 SDK：

- `TextGenerationProvider`
- `StructuredGenerationProvider`
- `EmbeddingProvider`
- `ImageGenerationProvider`（P1）
- `SpeechProvider`（P1）

模型 Profile 保存 endpoint、model id、能力、上下文窗口、价格和任务分配。API Key 只保存
安全存储引用。OpenAI-compatible 是首个通用适配器，其他供应商通过相同流式事件协议接入。
Web 与 Electron 共用 URL 规范化和请求体构造规则；智谱 `thinking` 私有参数只发送到
`bigmodel.cn`，不得因双宿主复制而出现供应商兼容性漂移。

## 6. Context Pack Builder

Context Builder 接收章节、预算和检索策略，输出带来源的不可变快照：

1. 收集强制上下文。
2. 计算 CJK 感知 Token 估算。
3. 检索相关正史事实、资料，以及当前批次最近的候选链正文。
4. 根据优先级压缩摘要、裁剪低相关项。
5. 生成来源清单、预算报告与快照哈希。

模型返回后，校验器检查结构、最小字数、禁止内容、人物名称和章纲覆盖。连续性检查结果
只产生 Finding，不能自动改正史。

候选链只服务于当前批次连续性，不属于正史。候选稿接受后才创建不可变版本；事实提案
必须在对应候选稿已接受后才能由作者写入正史。接受候选只完成正文入史，生成任务仍停在
`candidate_ready`；该候选的全部事实提案均接受或拒绝后才转为 `completed` 并放行下一章。
封存周期时，Electron 与 Web 数据层都会再次检查范围内已接受候选，不允许遗留
`proposed` 提案。

## 7. 目标测试策略

- Domain：状态机、Token 预算、章节范围和正史规则。
- Application：使用内存仓库验证批次暂停、恢复、失败重试和幂等。
- Infrastructure：SQLite 迁移、Provider 响应解析、文件导入导出。
- Renderer：关键向导、接受/拒绝和保存状态。
- 契约测试：Electron IPC 与 Web API 必须返回同一 DTO。

Domain、Application、数据库与模型适配已有自动化覆盖；Renderer 关键流程和双端契约
也已完成，当前证据与后续状态统一见 `BACKLOG.md` AN-010、AN-011。

## 8. 滚动规划与版本化记忆

一次性全书结构调用将由范围化 `planning_cycle` 取代。步骤 7–10 循环执行当前默认十章，
规划候选和前置设定提案确认后才更新章节槽位。规划调用必须先持久化原始响应和解析错误，
因此供应商返回合法 JSON 后追加说明文字时可以重新解析，而不是丢失付费结果。

第 2 个及后续规划周期会把上一已封存周期的预期/实际结束状态、截至当前范围前的最新
人物状态、开放伏笔和时间线尾部装配为不超过 4,000 字符的动态正史摘要。Electron/Web
共用 `rollingPlanningMemoryText`，并明确以实际结束状态和动态正史覆盖旧预期或静态实体卡。

规划中的既有实体使用由实体 ID 派生的 `E-…` 短引用。明确短引用或名称/别名完全匹配时
才更新既有卡；“称号·姓名”这类同核心称呼只生成作者审核的合并提案，不做模糊静默合并。
新增设定提案按类型和规范化名称跨周期去重；项目恢复时短引用随实体新 ID 一起重映射。

规划模型原始响应先持久化，再做纯解析校验。仅 JSON 语法或 Schema 结构错误会触发一次
0.1 温度修复调用；范围完整性等业务错误直接失败。修复响应单独留痕并再次经过同一校验，
不得递归重试或覆盖原始响应。

永久设定、章节记忆、动态正史和临时 Context Pack 分层保存。AI 派生正史必须绑定候选稿
和不可变正文版本；章节重写使旧派生记忆失效。详细状态机、锁规则和实施顺序见
`ROLLING_STORY_HARNESS.md`。

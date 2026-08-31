# Amy Novel AI 开发约定

本文件适用于整个仓库。开始开发前，依次阅读：

1. `docs/BACKLOG.md`：唯一任务状态台账；
2. `docs/DEVELOPMENT_GUIDE.md`：开发、测试和文档规范；
3. `docs/TECHNICAL_ARCHITECTURE.md`：分层与依赖边界；
4. 当前功能对应的设计文档。

## 工作规则

- 一次只推进一个 Backlog ID。开始时确认验收标准，结束时记录验证证据。
- 不以“已有代码”“类型检查通过”代替完成。只有验收标准全部满足，任务才可标记 `[x]`。
- 不修改 `docs/ACCEPTANCE_REPORT.md` 中既有历史结果；新验证只能追加带日期的小节。
- 不把设计意图写成已实现能力。设计、任务状态、验收记录分别放在设计文档、`BACKLOG.md`、`ACCEPTANCE_REPORT.md`。
- 当前工作区可能有用户未提交修改；不得重置、覆盖或顺手格式化无关文件。

## 架构边界

- `src/domain`：纯规则、状态机和解析；不得依赖 React、Electron、数据库或网络。
- `src/application`：用例与端口；不得直接访问宿主 API。
- `src/main`：Electron、SQLite、密钥、模型调用和后台调度。
- `src/renderer`：页面、交互与 Web 适配；不复制可以下沉到 Domain/Application 的规则。
- `src/shared`：只放可序列化的跨进程协议。
- Web 与 Electron 必须实现同一个 `PlatformPort`；新增端口时同步更新两端和契约测试。

## 不可破坏的产品规则

- 未接受的候选稿不是正史；未审核的 AI 提案不得写入正史。
- API Key 不得进入数据库、日志、事件、导出包或错误消息。
- 批量生成必须受持久化检查点、单执行器和硬 Token 预算约束。
- 章节改写后，依赖旧正文生成的后续候选或记忆必须可识别为过期。
- Prompt/解析边界必须保留原始响应和可审计错误，不得静默吞掉付费结果。

## 完成前检查

普通修改运行 `pnpm check`；涉及打包、平台适配、路由或构建配置时运行 `pnpm verify`。
真实 API E2E 会产生费用，只有用户明确授权时运行。提交结果前同步更新
`docs/BACKLOG.md`；若完成正式验收，再追加 `docs/ACCEPTANCE_REPORT.md`。

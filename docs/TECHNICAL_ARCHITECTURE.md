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

- 第一阶段的 Web 是本机浏览器模式，使用 IndexedDB/localStorage 适配器用于界面开发。
- 正式部署时增加 `WebApiPlatformAdapter`，调用独立 Node 服务。
- Web 服务实现同一组 Application Ports；React 页面不做条件分支。
- 浏览器不能安全长期保存第三方 API Key，正式部署必须由服务端密钥库管理。

## 3. 目录职责

```text
src/
├─ domain/             纯实体、值对象、规则、状态机
├─ application/        用例、端口、DTO、生成编排
├─ infrastructure/     数据库、文件、模型、Web/Electron 适配
├─ main/               Electron composition root 与 IPC
├─ preload/            安全桥
├─ renderer/src/       React 页面与组件
└─ shared/             跨进程协议、事件和可序列化类型
```

## 4. 生成调度器

`GenerationBatch` 拆成多个 `ChapterGenerationJob`，同一作品默认串行执行：

```text
queued → building_context → generating → validating
       → continuity_check → candidate_ready → completed
                        ↘ waiting_retry / failed / paused
```

每个阶段写入持久化检查点。恢复批次时读取 Job 状态而不是依赖内存队列。调度器支持：

- AbortSignal 取消当前网络请求。
- 指数退避与供应商 Retry-After。
- 幂等键，防止恢复时重复写候选版本。
- 每章上下文快照和 Prompt 指纹。
- 全局与供应商并发门控。
- Token/费用硬上限和软预警。

## 5. 模型抽象

模型端口分为能力而不是 SDK：

- `TextGenerationProvider`
- `StructuredGenerationProvider`
- `EmbeddingProvider`
- `ImageGenerationProvider`（P1）
- `SpeechProvider`（P1）

模型 Profile 保存 endpoint、model id、能力、上下文窗口、价格和任务分配。API Key 只保存
安全存储引用。OpenAI-compatible 是首个通用适配器，其他供应商通过相同流式事件协议接入。

## 6. Context Pack Builder

Context Builder 接收章节、预算和检索策略，输出带来源的不可变快照：

1. 收集强制上下文。
2. 计算 CJK 感知 Token 估算。
3. 检索相关正史事实与资料。
4. 根据优先级压缩摘要、裁剪低相关项。
5. 生成来源清单、预算报告与快照哈希。

模型返回后，校验器检查结构、最小字数、禁止内容、人物名称和章纲覆盖。连续性检查结果
只产生 Finding，不能自动改正史。

## 7. 测试策略

- Domain：状态机、Token 预算、章节范围和正史规则。
- Application：使用内存仓库验证批次暂停、恢复、失败重试和幂等。
- Infrastructure：SQLite 迁移、Provider 响应解析、文件导入导出。
- Renderer：关键向导、接受/拒绝和保存状态。
- 契约测试：Electron IPC 与 Web API 必须返回同一 DTO。

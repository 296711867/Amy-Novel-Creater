# Amy Novel

Amy Novel 是一个本地优先、面向长篇小说的 AI 创作工作台。它复用同一套 React
界面同时运行在 Windows Electron 和浏览器中，并通过可替换的平台适配层接入本地
文件、SQLite 与主流大模型。

当前已具备产品与架构基线、书架、小说创建、章节规划、批量生成任务配置，以及 Electron
SQLite 持久化、章节正文自动保存和手动版本快照。Web 模式使用同一平台契约和浏览器本地存储。

## 开发

```bash
pnpm install
pnpm dev:web
pnpm dev
```

- `pnpm dev:web`：浏览器模式，使用浏览器本地存储。
- `pnpm dev`：Windows Electron 模式。
- `pnpm typecheck`：检查主进程和渲染进程类型。
- `pnpm test`：运行单元测试。
- `pnpm icons`：从品牌 PNG 生成桌面平台图标。
- `pnpm build:win`：生成 Windows x64 NSIS 安装包。

## 文档

- [产品规格](docs/PRODUCT_SPEC.md)
- [界面信息架构](docs/INFORMATION_ARCHITECTURE.md)
- [技术架构](docs/TECHNICAL_ARCHITECTURE.md)
- [数据库设计](docs/DATABASE_DESIGN.md)
- [阶段路线图](docs/ROADMAP.md)
- [AI 全自动小说工作流设计](docs/AUTOPILOT_DESIGN.md)
- [Windows 发布说明](docs/RELEASE.md)
- [0.1.0 发布验收报告](docs/ACCEPTANCE_REPORT.md)

## License

Apache-2.0

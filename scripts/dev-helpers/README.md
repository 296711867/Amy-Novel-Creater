# Web 端自动化巡航开发辅助脚本（不属于产品能力，不随发布）

真实模型全自动巡航（docs/AI_AUTHORING_WORKFLOW.md §8）需要在 vite dev
服务器的 public/ 下放这四个桥接文件。开跑前：

    cp scripts/dev-helpers/__*.js public/

跑完收尾时删除 public/ 整个目录（正常构建不含这些文件）。

- __store_bridge.js   → window.__store（zustand store 全量动作）
- __store_bridge2.js  → window.__platform（平台层读写接口）
- __tick_worker.js    → 巡航心跳 Worker（绕过后台节流，AN-045）
- __export_bridge.js  → window.__novelAsMarkdown（书稿导出）

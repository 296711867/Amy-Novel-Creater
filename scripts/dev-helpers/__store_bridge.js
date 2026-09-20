// 开发期浏览器桥接：把 zustand store 暴露到 window.__store，供自动化巡航
// 的监控/恢复脚本在页面上下文里调用 store 动作（详见
// docs/AI_AUTHORING_WORKFLOW.md §8）。复制到 public/ 后随 vite 生效。
import { useNovelStore } from "/src/renderer/src/store/novel-store.ts";
window.__store = useNovelStore;

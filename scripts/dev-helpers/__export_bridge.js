// 导出桥接：暴露 novelAsMarkdown，供书稿导出脚本在页面上下文调用。
import { novelAsMarkdown } from "/src/domain/project-export.ts";
window.__novelAsMarkdown = novelAsMarkdown;

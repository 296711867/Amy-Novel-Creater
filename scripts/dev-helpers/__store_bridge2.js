// 平台桥接：暴露 web-platform 单例到 window.__platform，供脚本直接调
// listGenerationEvents / listGenerationJobs / listChapterCandidates /
// listFindings / updateGenerationJob 等平台层接口。
import { platform } from "/src/renderer/src/platform/web-platform.ts";
window.__platform = platform;

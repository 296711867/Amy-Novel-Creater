/**
 * Electron 窗口导航安全策略（AN-012）。
 *
 * 决策逻辑做成纯函数便于测试：窗口内只允许应用自身的页面导航，
 * 外部 http(s) 链接交给系统浏览器，其余一律拒绝。
 */

/** 应用自身页面的导航前缀（带路径分隔符，防止同前缀目录逃逸）。 */
export function appNavigationBase(options: {
  devServerUrl?: string;
  rendererDirFileUrl?: string;
  isDev: boolean;
}): string | null {
  if (options.isDev) {
    if (!options.devServerUrl) return null;
    return options.devServerUrl.endsWith("/")
      ? options.devServerUrl
      : `${options.devServerUrl}/`;
  }
  if (!options.rendererDirFileUrl) return null;
  return options.rendererDirFileUrl.endsWith("/")
    ? options.rendererDirFileUrl
    : `${options.rendererDirFileUrl}/`;
}

/** will-navigate：仅允许应用自身页面；hash 路由是同文档导航，不触发本事件。 */
export function isAllowedNavigation(
  targetUrl: string,
  base: string | null,
): boolean {
  if (!base) return false;
  return targetUrl === base.slice(0, -1) || targetUrl.startsWith(base);
}

/** window.open：一律拒绝新窗口；http(s) 外链转交系统浏览器。 */
export function windowOpenDecision(
  url: string,
  base: string | null,
): { action: "deny"; openExternally?: boolean } {
  const isHttp = /^https?:\/\//i.test(url),
    isAppPage = isAllowedNavigation(url, base);
  return isHttp && !isAppPage
    ? { action: "deny", openExternally: true }
    : { action: "deny" };
}

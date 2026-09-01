import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 全局兜底错误边界：单个页面组件抛出运行时异常时展示可恢复的错误页，
 * 而不是让 React 卸载整棵渲染树导致白屏。数据层不受影响。
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 只输出到本地控制台供排查；渲染层错误不包含密钥等敏感信息。
    console.error("[Amy Novel] 页面渲染崩溃", error, info.componentStack);
  }

  private goHome(): void {
    this.setState({ error: null });
    if (location.hash !== "#/") location.hash = "#/";
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <h1>页面出了点问题</h1>
        <p>当前页面渲染时发生错误，作品数据都在本地，不受影响。</p>
        <pre>{this.state.error.message}</pre>
        <div className="crash-actions">
          <button type="button" onClick={() => this.goHome()}>
            返回首页
          </button>
          <button type="button" onClick={() => location.reload()}>
            重新加载应用
          </button>
        </div>
      </div>
    );
  }
}

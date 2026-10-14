/** 渲染错误边界（v0.9）：子组件崩溃时显示错误与重试，不再白屏；错误文本供诊断 */
import { Component, type ReactNode } from "react";

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[ErrorBoundary${this.props.label ? ":" + this.props.label : ""}]`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ borderColor: "var(--accent)" }}>
          <h3>⚠ 界面渲染出错{this.props.label ? `（${this.props.label}）` : ""}</h3>
          <div className="muted small" style={{ margin: "8px 0", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>
            {this.state.error.message}
            {this.state.error.stack ? "\n" + this.state.error.stack.split("\n").slice(1, 4).join("\n") : ""}
          </div>
          <button className="primary small" onClick={() => this.setState({ error: null })}>重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}

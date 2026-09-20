import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Without this, an uncaught render error anywhere in the tree (a bad prop
// during a fast-refresh edit, a genuine bug) silently unmounts the whole
// app — the page goes blank and the mic session tears down with it, with
// no indication of why. This catches that instead of leaving a dead page.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <div className="panel" style={{ margin: "40px auto", maxWidth: 480, textAlign: "center" }}>
            <h2>Something went wrong</h2>
            <p className="muted small">{this.state.error.message}</p>
            <button className="action-btn" onClick={() => window.location.reload()}>
              Reload the page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface State { failed: boolean }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="panel error-state boundary" role="alert">
        <p className="empty-title">The caravan hit a rock.</p>
        <p className="muted">Something broke in the interface. Your goods and dinars are safe on the server.</p>
        <button type="button" className="btn btn-primary" onClick={() => this.setState({ failed: false })}>
          Try again
        </button>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    );
  }
}

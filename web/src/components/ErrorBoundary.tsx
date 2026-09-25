// ErrorBoundary.tsx - one view failing (for example a stale lazy chunk after
// an update) shows a calm message with a reload button instead of a blank app.
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props { resetKey: string; children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[cockpit view]', error.message, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="view-error">
        <p>This view could not load. The Cockpit may have been updated while this page was open.</p>
        <button type="button" className="page-action-btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

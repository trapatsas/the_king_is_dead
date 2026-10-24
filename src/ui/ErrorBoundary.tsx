import { Component } from "react";
import type { ReactNode } from "react";

/**
 * Catches render failures so a single bad draft cannot blank the page. The
 * committed session lives above this boundary, so recovery restarts only the
 * current turn. The raw error is never shown: invariant messages can name
 * hidden cards.
 */
export class GameErrorBoundary extends Component<
  { children: ReactNode; onRetry: () => void; onLeave: () => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="error-layout">
        <section className="privacy-panel error-panel" role="alert">
          <span className="privacy-symbol" aria-hidden="true">
            ♜
          </span>
          <h2>This turn could not be shown</h2>
          <p>
            Something unexpected went wrong. Every committed turn is intact;
            only the turn in progress was discarded.
          </p>
          <button autoFocus className="primary" onClick={this.props.onRetry}>
            Restart this turn
          </button>
          <button className="quiet" onClick={this.props.onLeave}>
            Leave game
          </button>
        </section>
      </main>
    );
  }
}

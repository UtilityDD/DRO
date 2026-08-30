import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, reloadOnceForStaleChunk } from '../lib/chunkReload';

function RouteFallback() {
  return (
    <div className="route-loading" aria-live="polite">
      <div className="loading-spinner" aria-label="Loading" />
    </div>
  );
}

class ChunkErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    if (isChunkLoadError(error)) reloadOnceForStaleChunk();
    else console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (isChunkLoadError(this.state.error)) return <RouteFallback />;
    return (
      <div className="route-loading" aria-live="polite">
        <p className="muted">Couldn’t open this page.</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

/** Keeps the app shell mounted while a lazy route loads, and recovers from stale chunks. */
export function RouteSuspense({ children }: { children: ReactNode }) {
  return (
    <ChunkErrorBoundary>
      <Suspense fallback={<RouteFallback />}>{children}</Suspense>
    </ChunkErrorBoundary>
  );
}

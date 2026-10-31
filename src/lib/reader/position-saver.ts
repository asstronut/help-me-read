import type { ReadingLocation } from '@/lib/types';

export class PositionSaveError extends Error {
  constructor(readonly status: number) {
    super(`Saving position failed: ${status}`);
  }
}

export type SaveResult = 'saved' | 'failed' | 'signed-out';

const MAX_DELAY_MS = 30_000;

/**
 * Saves at most once per interval, always the latest location. `flush` sends any pending
 * location right away, even while an earlier save is still in flight. A failed save keeps its
 * location and retries with a doubling delay, unless a newer location has been sent since; a
 * 401/403 stops saving. `dispose` makes a final attempt, then never retries or reports again.
 */
export function createPositionSaver(
  save: (location: ReadingLocation) => Promise<void>,
  intervalMs = 2000,
  onResult?: (result: SaveResult) => void,
): { update(location: ReadingLocation): void; flush(): Promise<void>; dispose(): Promise<void> } {
  let pending: ReadingLocation | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let delay = intervalMs;
  let stopped = false;
  let disposed = false;
  let sent = 0;

  function arm() {
    if (!stopped && !disposed) timer ??= setTimeout(() => void flush(), delay);
  }

  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    const location = pending;
    pending = null;
    if (!location || stopped) return;
    const seq = ++sent;
    try {
      await save(location);
      delay = intervalMs;
      if (!disposed && seq === sent) onResult?.('saved');
    } catch (e) {
      if (e instanceof PositionSaveError && (e.status === 401 || e.status === 403)) {
        stopped = true;
        if (!disposed) onResult?.('signed-out');
        return;
      }
      delay = Math.min(delay * 2, MAX_DELAY_MS);
      if (seq !== sent) return; // a newer location was sent meanwhile; it supersedes this one
      pending ??= location;
      arm();
      if (!disposed) onResult?.('failed');
    }
  }

  return {
    update(location) {
      if (disposed) return;
      pending = location;
      arm();
    },
    flush,
    dispose() {
      disposed = true;
      return flush();
    },
  };
}

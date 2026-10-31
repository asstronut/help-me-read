import type { ReadingLocation } from '@/lib/types';

/**
 * Saves at most once per interval, always the latest location. `flush` saves any pending
 * location now (used when the tab is hidden). A failed save keeps the location and retries
 * on the next interval unless a newer one has arrived; `onResult` reports each outcome.
 */
export function createPositionSaver(
  save: (location: ReadingLocation) => Promise<void>,
  intervalMs = 2000,
  onResult?: (saved: boolean) => void,
): { update(location: ReadingLocation): void; flush(): Promise<void> } {
  let pending: ReadingLocation | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function arm() {
    timer ??= setTimeout(() => void flush(), intervalMs);
  }

  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    const location = pending;
    pending = null;
    if (!location) return;
    try {
      await save(location);
      onResult?.(true);
    } catch {
      pending ??= location;
      arm();
      onResult?.(false);
    }
  }

  return {
    update(location) {
      pending = location;
      arm();
    },
    flush,
  };
}

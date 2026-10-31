import type { ReadingLocation } from '@/lib/types';

/**
 * Saves at most once per interval, always the latest location. `flush` saves any pending
 * location now (used when the tab is hidden).
 */
export function createPositionSaver(
  save: (location: ReadingLocation) => Promise<void>,
  intervalMs = 2000,
): { update(location: ReadingLocation): void; flush(): Promise<void> } {
  let pending: ReadingLocation | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    const location = pending;
    pending = null;
    if (location) await save(location);
  }

  return {
    update(location) {
      pending = location;
      timer ??= setTimeout(() => void flush().catch(() => undefined), intervalMs);
    },
    flush,
  };
}

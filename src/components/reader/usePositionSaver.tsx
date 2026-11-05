'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPositionSaver, PositionSaveError, type SaveResult } from '@/lib/reader/position-saver';
import type { ReadingLocation } from '@/lib/types';

const SAVE_TIMEOUT_MS = 10_000;

/** Where the reader is, and how far through the book that is (0 to 1), when the reader knows. */
type PositionUpdate = { location: ReadingLocation; progress: number | null };

/** Saves the reading position of a book; `status` is a line to show when saving is not working. */
export function usePositionSaver(bookId: string) {
  const [saveResult, setSaveResult] = useState<SaveResult>('saved');
  const saverRef = useRef<ReturnType<typeof createPositionSaver<PositionUpdate>> | null>(null);

  useEffect(() => {
    const saver = createPositionSaver<PositionUpdate>(
      async ({ location, progress }) => {
        const res = await fetch(`/api/books/${bookId}/position`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...location,
            progress: progress === null ? undefined : Math.min(Math.max(progress, 0), 1),
          }),
          keepalive: true,
          signal: AbortSignal.timeout(SAVE_TIMEOUT_MS),
        });
        if (!res.ok) throw new PositionSaveError(res.status);
      },
      undefined,
      setSaveResult,
    );
    saverRef.current = saver;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void saver.flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      void saver.dispose();
      saverRef.current = null;
    };
  }, [bookId]);

  const status =
    saveResult === 'saved' ? null : (
      <p role="status" className="px-3 py-1 text-xs text-amber-700">
        {saveResult === 'signed-out' ? 'Signed out — progress not saved' : 'Progress not saved'}
      </p>
    );

  const save = useCallback(
    (location: ReadingLocation, progress: number | null) => saverRef.current?.update({ location, progress }),
    [],
  );
  return { save, status };
}

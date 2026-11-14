'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPositionSaver, PositionSaveError, type SaveResult } from '@/lib/reader/position-saver';
import type { ReadingLocation } from '@/lib/types';

const SAVE_TIMEOUT_MS = 10_000;

/**
 * Where the reader is, how far through the book that is (0 to 1) when the reader knows, and the
 * chapter it is in. A chapter of undefined means the book's contents are not loaded yet, so the
 * stored chapter is kept; null means they are loaded and nothing covers this place.
 */
type PositionUpdate = { location: ReadingLocation; progress: number | null; chapter?: string | null };

/** Saves the reading position of a book; `status` is a line to show when saving is not working. */
export function usePositionSaver(bookId: string) {
  const [saveResult, setSaveResult] = useState<SaveResult>('saved');
  const saverRef = useRef<ReturnType<typeof createPositionSaver<PositionUpdate>> | null>(null);

  useEffect(() => {
    const saver = createPositionSaver<PositionUpdate>(
      async ({ location, progress, chapter }) => {
        const res = await fetch(`/api/books/${bookId}/position`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...location,
            progress: progress === null ? undefined : Math.min(Math.max(progress, 0), 1),
            chapter, // undefined is omitted, which tells the server to keep the stored one
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
    (location: ReadingLocation, progress: number | null, chapter: string | null | undefined) =>
      saverRef.current?.update({ location, progress, chapter }),
    [],
  );
  return { save, status };
}

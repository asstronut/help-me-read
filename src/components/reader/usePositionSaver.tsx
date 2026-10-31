'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPositionSaver, PositionSaveError, type SaveResult } from '@/lib/reader/position-saver';
import type { ReadingLocation } from '@/lib/types';

const SAVE_TIMEOUT_MS = 10_000;

/** Saves the reading position of a book; `status` is a line to show when saving is not working. */
export function usePositionSaver(bookId: string) {
  const [saveResult, setSaveResult] = useState<SaveResult>('saved');
  const saverRef = useRef<ReturnType<typeof createPositionSaver> | null>(null);

  useEffect(() => {
    const saver = createPositionSaver(
      async (location) => {
        const res = await fetch(`/api/books/${bookId}/position`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(location),
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

  const save = useCallback((location: ReadingLocation) => saverRef.current?.update(location), []);
  return { save, status };
}

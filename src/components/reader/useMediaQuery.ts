'use client';

import { useCallback, useSyncExternalStore } from 'react';

/** Whether the media query matches now; false on the server and in the first render. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Wider than a phone (Tailwind's `sm`). */
export const SM = '(min-width: 640px)';
/** Wide enough for the contents outline to sit open beside the book (Tailwind's `lg`). */
export const WIDE = '(min-width: 1024px)';
/** Wide enough for the side panels to sit beside the book rather than over it (Tailwind's `md`). */
export const BESIDE = '(min-width: 768px)';

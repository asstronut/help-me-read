'use client';

import { useEffect, useState } from 'react';

/**
 * Keeps something on screen while it animates out. `mounted` stays true for `exitMs` after `open`
 * turns false, and `closing` is true during that time (style it with `[data-closing]`). Opening
 * again before then just clears `closing`, so a CSS transition turns around where it is.
 */
export function usePresence(open: boolean, exitMs: number) {
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setMounted(false), exitMs);
    return () => clearTimeout(timer);
  }, [open, exitMs]);
  return { mounted, closing: mounted && !open };
}

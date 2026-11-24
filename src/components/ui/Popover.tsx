'use client';

import { useLayoutEffect, useRef, type ComponentProps } from 'react';
import { cn } from './cn';

/** How close a popover may come to the window's left and right edges. */
const GUTTER = 16;

type Props = ComponentProps<'div'> & {
  /** Escape was pressed, or the pointer went down outside the popover and the element it hangs from. */
  onClose: (reason: 'escape' | 'outside') => void;
  /**
   * Shrink the card to the longest line of its `[data-fit]` text. Wrapped text leaves a ragged
   * right edge short of the card's padding, so right-aligned buttons would stick out past it;
   * fitted, the longest line, the buttons and the padding share one edge. The width class still
   * sets where the text wraps.
   */
  fit?: boolean;
};

/** Sets the card's width to its longest line of `[data-fit]` text plus its padding and border. */
function fitToText(card: HTMLElement) {
  card.style.width = '';
  const style = getComputedStyle(card);
  const start = card.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
  let end = 0;
  const range = document.createRange();
  for (const text of card.querySelectorAll('[data-fit]')) {
    range.selectNodeContents(text);
    for (const line of range.getClientRects()) end = Math.max(end, line.right);
  }
  if (end <= start) return;
  const chrome =
    parseFloat(style.paddingLeft) +
    parseFloat(style.paddingRight) +
    parseFloat(style.borderLeftWidth) +
    parseFloat(style.borderRightWidth);
  // Rounded up, so no line is a fraction too wide and wraps differently.
  card.style.width = `${Math.ceil(end - start + chrome)}px`;
}

/**
 * A small card that hangs under the element it is placed in (its anchor, which must be
 * `relative` or `absolute`). It lines up with the anchor's right edge and slides sideways just
 * enough to stay 16px inside the window, so it fits on a phone whichever column it opens in.
 * It floats over the page, so nothing around it moves, and drops into place (`motion-drop`).
 * A press on the anchor itself is not "outside": the button there decides what that does.
 */
export function Popover({ onClose, fit = false, className, children, ...props }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });

  useLayoutEffect(() => {
    const card = ref.current;
    const anchor = card?.parentElement;
    if (!card || !anchor) return;
    // Placed before the first paint, so it never shows in the wrong spot.
    const place = () => {
      if (fit) fitToText(card);
      const box = anchor.getBoundingClientRect();
      const width = card.offsetWidth;
      const rightmost = document.documentElement.clientWidth - GUTTER - width;
      const left = Math.max(GUTTER, Math.min(box.right - width, rightmost));
      card.style.left = `${left - box.left}px`;
    };
    place();
    const onPointer = (e: PointerEvent) => {
      if (!anchor.contains(e.target as Node)) close.current('outside');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current('escape');
    };
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', place);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [fit]);

  return (
    <div
      ref={ref}
      className={cn(
        'motion-drop absolute top-full mt-1 rounded-xl border border-rule bg-surface text-ink shadow-[0_12px_32px_var(--shadow)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

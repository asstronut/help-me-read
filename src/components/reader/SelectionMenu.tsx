'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { countWords, orderMenu } from '@/lib/selection/menu';
import {
  HIGHLIGHT_COLORS,
  MAX_SELECTION_WORDS,
  type HighlightColor,
  type MenuItem,
  type ReaderSelection,
} from '@/lib/types';
import { cn } from '@/components/ui/cn';
import { PlusIcon } from '@/components/ui/icons';
import { HIGHLIGHT_HEX } from './highlight-colors';

/** Where the selection is on screen, in viewport pixels. */
export type SelectionBox = { top: number; bottom: number; left: number; right: number };

type Props = {
  selection: ReaderSelection;
  box: SelectionBox;
  onPick: (item: MenuItem) => void;
  onColor: (color: HighlightColor) => void;
};

const LABELS: Record<MenuItem, string> = {
  translate: 'Translate',
  define: 'Define',
  explain: 'Explain',
  simplify: 'Simplify',
  ask: 'Ask…',
  vocab: 'Vocab',
};

const FOCUS = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';
const ACTION = cn('inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 hover:bg-chip', FOCUS);
const Divider = () => <span aria-hidden="true" className="mx-1 hidden h-5 w-px shrink-0 bg-rule sm:block" />;

const GAP = 8;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Above the selection, else below it, else (a selection taller than the screen) at the
 * bottom of the screen; always inside the viewport.
 */
function placeNear(box: SelectionBox, width: number, height: number) {
  const lowest = window.innerHeight - height - GAP;
  const above = box.top - height - GAP;
  const below = box.bottom + GAP;
  const top = above >= GAP ? above : below <= lowest ? below : lowest;
  const centre = (box.left + box.right) / 2;
  return {
    top: clamp(top, GAP, lowest),
    left: clamp(centre - width / 2, GAP, window.innerWidth - width - GAP),
  };
}

// Keeps the reader's text selection alive while a menu button is pressed.
const keepSelection = (e: MouseEvent) => e.preventDefault();

/** The menu for a selection: docked to the bottom on a phone, above the selection otherwise. */
export function SelectionMenu({ selection, box, onPick, onColor }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setPlace(placeNear(box, el.offsetWidth, el.offsetHeight));
  }, [box]);

  const tooLong = countWords(selection.text) > MAX_SELECTION_WORDS;
  const style = place
    ? ({ '--menu-top': `${place.top}px`, '--menu-left': `${place.left}px` } as CSSProperties)
    : undefined;

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selection menu"
      style={style}
      onMouseDown={keepSelection}
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col border-t border-rule bg-surface p-1 font-sans text-[13px] whitespace-nowrap text-ink shadow-[0_8px_24px_var(--shadow)] sm:inset-x-auto sm:bottom-auto sm:top-(--menu-top) sm:left-(--menu-left) sm:w-max sm:flex-row sm:items-center sm:rounded-xl sm:border sm:py-0"
    >
      {tooLong ? (
        <p className="flex h-11 items-center px-3 text-muted">Select a shorter passage</p>
      ) : (
        <>
          <div role="group" aria-label="Highlight colour" className="flex">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Highlight ${color}`}
                onClick={() => onColor(color)}
                className={cn('flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-chip', FOCUS)}
              >
                <span
                  aria-hidden="true"
                  style={{ backgroundColor: HIGHLIGHT_HEX[color] }}
                  className="size-[18px] rounded-full"
                />
              </button>
            ))}
          </div>
          <Divider />
          <div role="group" aria-label="Actions" className="flex flex-wrap items-center sm:flex-nowrap">
            {orderMenu(selection.text).map((item) =>
              item === 'vocab' ? (
                <span key={item} className="contents">
                  <Divider />
                  {/* The visible "Vocab" is part of the name (WCAG 2.5.3, label in name). */}
                  <button type="button" aria-label="Save to vocab" onClick={() => onPick(item)} className={ACTION}>
                    <PlusIcon size={14} strokeWidth={1.8} />
                    <span>{LABELS[item]}</span>
                  </button>
                </span>
              ) : (
                <button key={item} type="button" onClick={() => onPick(item)} className={ACTION}>
                  {LABELS[item]}
                </button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

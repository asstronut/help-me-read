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
  vocab: '+Vocab',
};

const DOT_CLASSES: Record<HighlightColor, string> = {
  yellow: 'bg-yellow-300',
  green: 'bg-green-300',
  blue: 'bg-sky-300',
  pink: 'bg-pink-300',
};

const GAP = 8;

/** Above the selection, or below it when there is no room; kept inside the viewport. */
function placeNear(box: SelectionBox, width: number, height: number) {
  const top = box.top - height - GAP >= GAP ? box.top - height - GAP : box.bottom + GAP;
  const centre = (box.left + box.right) / 2;
  const left = Math.min(Math.max(centre - width / 2, GAP), window.innerWidth - width - GAP);
  return { top, left };
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
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 border-t border-black/10 bg-white p-2 text-sm text-black shadow-lg sm:inset-x-auto sm:bottom-auto sm:top-(--menu-top) sm:left-(--menu-left) sm:w-max sm:rounded-lg sm:border"
    >
      {tooLong ? (
        <p className="px-2 py-1">Select a shorter passage</p>
      ) : (
        <>
          <div role="group" aria-label="Highlight colour" className="flex gap-2 px-1">
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Highlight ${color}`}
                onClick={() => onColor(color)}
                className={`size-6 rounded-full border border-black/20 ${DOT_CLASSES[color]}`}
              />
            ))}
          </div>
          <div role="group" aria-label="Actions" className="flex flex-wrap gap-1">
            {orderMenu(selection.text).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onPick(item)}
                className="rounded px-2 py-1 hover:bg-black/5"
              >
                {LABELS[item]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

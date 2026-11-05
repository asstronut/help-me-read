'use client';

import { useId } from 'react';
import { IconButton } from '@/components/ui/IconButton';

export const FONT_SIZES = [14, 16, 18, 20, 24] as const;

type Props = {
  fontSize: number;
  onFontSize: (size: number) => void;
};

/**
 * The Aa button and the small panel it opens. For now it holds only the EPUB font size; the full
 * reading settings (theme, typeface, spacing) come later.
 */
export function ReadingSettings({ fontSize, onFontSize }: Props) {
  const id = useId();
  return (
    <>
      <IconButton aria-label="Reading settings" popoverTarget={id} className="font-serif text-[17px]">
        Aa
      </IconButton>
      {/* A native popover: it closes on Escape and on a click outside it, and sits above the book. */}
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Reading settings"
        className="fixed inset-auto top-14 right-2 m-0 w-64 max-w-[calc(100vw-1rem)] rounded-xl border border-rule bg-surface p-4 text-ink shadow-[0_8px_24px_var(--shadow)] sm:top-[72px] sm:right-7"
      >
        <label className="flex flex-col gap-1.5 text-[13px]">
          <span className="font-medium">Font size</span>
          <select
            value={fontSize}
            onChange={(e) => onFontSize(Number(e.target.value))}
            className="h-11 rounded-[10px] border border-rule bg-surface px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            {FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} px
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

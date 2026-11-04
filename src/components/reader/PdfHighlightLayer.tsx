import type { CSSProperties } from 'react';
import type { HighlightView, Rect } from '@/lib/types';
import { HIGHLIGHT_FILLS, HIGHLIGHT_INKS } from './highlight-colors';

const pdfRects = (h: HighlightView): Rect[] => (h.anchor.format === 'pdf' ? h.anchor.rects : []);

const percent = (n: number) => `${n * 100}%`;

/**
 * One page's highlights, drawn inside the rendered page: rects are fractions of the page, so the
 * boxes follow it at any zoom. Notes are filled; threads get a dotted underline. Taps are found by
 * `highlightsAt`, so the boxes never get in the way of selecting text.
 */
export function PdfHighlightLayer({ highlights }: { highlights: HighlightView[] }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[1] mix-blend-multiply">
      {highlights.flatMap((h) =>
        pdfRects(h).map((r, i) => {
          const style: CSSProperties = {
            left: percent(r.x),
            top: percent(r.y),
            width: percent(r.w),
            height: percent(r.h),
            ...(h.kind === 'note'
              ? { backgroundColor: HIGHLIGHT_FILLS[h.color], opacity: 0.6 }
              : { borderBottom: `2px dotted ${HIGHLIGHT_INKS[h.color]}` }),
          };
          return (
            <div
              key={`${h.id}-${i}`}
              data-highlight-id={h.id}
              data-highlight-kind={h.kind}
              data-highlight-color={h.color}
              className="absolute"
              style={style}
            />
          );
        }),
      )}
    </div>
  );
}

/** The highlights under a point given as fractions of the page, most recent first. */
export function highlightsAt(
  highlights: HighlightView[],
  page: number,
  x: number,
  y: number,
): HighlightView[] {
  return highlights
    .filter(
      (h) =>
        h.anchor.format === 'pdf' &&
        h.anchor.page === page &&
        h.anchor.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h),
    )
    .reverse();
}

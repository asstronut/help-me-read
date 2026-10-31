'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DrawAnnotationDetail,
  SectionLoadDetail,
  ShowAnnotationDetail,
  View,
} from 'foliate-js/view.js';
import { captureEpubSelection } from '@/lib/selection/capture-epub';
import { watchTaps } from '@/lib/selection/tap';
import { watchSelection } from '@/lib/selection/watch';
import type { HighlightView, ReaderSelection } from '@/lib/types';
import { HIGHLIGHT_FILLS, HIGHLIGHT_INKS } from './highlight-colors';
import { FONT_SIZES, ReaderToolbar } from './ReaderToolbar';
import type { SelectionBox } from './SelectionMenu';
import { usePositionSaver } from './usePositionSaver';

type Props = {
  bookId: string;
  fileUrl: string;
  initialCfi: string | null;
  onSelection: (selection: ReaderSelection | null, box?: SelectionBox) => void;
  highlights: HighlightView[];
  /** The highlights under a tap, most recent first. */
  onHighlightTap: (highlights: HighlightView[]) => void;
};

const FONT_SIZE_KEY = 'hmr.fontSize';
const DEFAULT_FONT_SIZE = 18;

function readFontSize(): number {
  try {
    const stored = Number(localStorage.getItem(FONT_SIZE_KEY));
    return (FONT_SIZES as readonly number[]).includes(stored) ? stored : DEFAULT_FONT_SIZE;
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

/** Font size, and the page's theme colours (the chapter is drawn in an iframe that does not inherit them). */
function readerCss(size: number): string {
  const theme = getComputedStyle(document.documentElement);
  const background = theme.getPropertyValue('--background');
  const foreground = theme.getPropertyValue('--foreground');
  return `html, body, p { font-size: ${size}px !important; }
html, body { background: ${background} !important; color: ${foreground} !important; }`;
}

/** The range's box in the reader's viewport (the section is drawn in an iframe). */
function boxInViewport(range: Range): SelectionBox {
  const r = range.getBoundingClientRect();
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement?.getBoundingClientRect();
  const dx = frame?.left ?? 0;
  const dy = frame?.top ?? 0;
  return { top: r.top + dy, bottom: r.bottom + dy, left: r.left + dx, right: r.right + dx };
}

/**
 * The book's EPUB highlights grouped by CFI, the key foliate draws an annotation under: highlights
 * on the same words share one annotation, which draws them all.
 */
function byCfi(highlights: HighlightView[]): Map<string, HighlightView[]> {
  const map = new Map<string, HighlightView[]>();
  for (const h of highlights) {
    if (h.anchor.format !== 'epub') continue;
    const group = map.get(h.anchor.cfi);
    if (group) group.push(h);
    else map.set(h.anchor.cfi, [h]);
  }
  return map;
}

const looks = (group: HighlightView[]) => group.map((h) => `${h.id}:${h.kind}:${h.color}`).join();

const SVG_NS = 'http://www.w3.org/2000/svg';

export default function EpubReader({
  bookId,
  fileUrl,
  initialCfi,
  onSelection,
  highlights,
  onHighlightTap,
}: Props) {
  const [fontSize, setFontSize] = useState(readFontSize);
  const [error, setError] = useState(false);
  const { save, status } = usePositionSaver(bookId);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const fontSizeRef = useRef(fontSize);
  const onSelectionRef = useRef(onSelection);
  const onHighlightTapRef = useRef(onHighlightTap);
  const highlightsRef = useRef(highlights);
  // What the view has been asked to draw, by CFI, oldest first.
  const drawnRef = useRef(new Map<string, HighlightView[]>());
  useEffect(() => {
    fontSizeRef.current = fontSize;
    onSelectionRef.current = onSelection;
    onHighlightTapRef.current = onHighlightTap;
    highlightsRef.current = highlights;
  });

  /** Brings the view's annotations in line with the current highlights. */
  const syncAnnotations = useCallback((view: View) => {
    const next = byCfi(highlightsRef.current);
    const drawn = drawnRef.current;
    drawnRef.current = next;
    for (const value of drawn.keys()) {
      if (!next.has(value)) view.deleteAnnotation({ value }).catch(() => undefined);
    }
    for (const [value, group] of next) {
      const old = drawn.get(value);
      if (!old || looks(old) !== looks(group)) view.addAnnotation({ value }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (viewRef.current) syncAnnotations(viewRef.current);
  }, [highlights, syncAnnotations]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let view: View | null = null;
    let unwatch: (() => void) | undefined;
    // Whether the last press in the section ended where it started; the end of a drag is not a tap.
    let lastReleaseWasTap = false;
    (async () => {
      const [, { Overlayer }] = await Promise.all([
        import('foliate-js/view.js'),
        import('foliate-js/overlayer.js'),
      ]);
      if (cancelled) return;
      view = document.createElement('foliate-view') as View;
      view.style.cssText = 'display:block;width:100%;height:100%';
      view.addEventListener('relocate', (e) => save({ cfi: (e as CustomEvent<{ cfi: string }>).detail.cfi }));
      view.addEventListener('load', (e) => {
        const { doc, index } = (e as CustomEvent<SectionLoadDetail>).detail;
        const current = e.currentTarget as View;
        unwatch?.();
        onSelectionRef.current(null);
        const unwatchSelection = watchSelection(doc, (range) => {
          const selection = range && captureEpubSelection(range, bookId, index, current.getCFI(index, range));
          onSelectionRef.current(selection, range ? boxInViewport(range) : undefined);
        });
        const unwatchTaps = watchTaps(doc, (tap) => {
          lastReleaseWasTap = tap;
        });
        unwatch = () => {
          unwatchSelection();
          unwatchTaps();
        };
      });
      // Each shown section gets a fresh overlay: draw its highlights again.
      view.addEventListener('create-overlay', (e) => {
        const current = e.currentTarget as View;
        for (const value of drawnRef.current.keys()) {
          current.addAnnotation({ value }).catch(() => undefined);
        }
      });
      view.addEventListener('draw-annotation', (e) => {
        const { draw, annotation } = (e as CustomEvent<DrawAnnotationDetail>).detail;
        const group = drawnRef.current.get(annotation.value);
        if (!group) return;
        // Fills first, so a thread underline on the same words stays on top.
        const ordered = [...group.filter((h) => h.kind === 'note'), ...group.filter((h) => h.kind === 'thread')];
        draw((rects) => {
          const g = document.createElementNS(SVG_NS, 'g');
          for (const h of ordered) {
            g.append(
              h.kind === 'thread'
                ? Overlayer.underline(rects, { color: HIGHLIGHT_INKS[h.color], width: 2 })
                : Overlayer.highlight(rects, { color: HIGHLIGHT_FILLS[h.color] }),
            );
          }
          return g;
        });
      });
      view.addEventListener('show-annotation', (e) => {
        if (!lastReleaseWasTap) return;
        const group = drawnRef.current.get((e as CustomEvent<ShowAnnotationDetail>).detail.value);
        if (group) onHighlightTapRef.current([...group].reverse());
      });
      host.append(view);
      await view.open(fileUrl);
      if (cancelled) return;
      view.renderer.setAttribute('flow', 'paginated');
      view.renderer.setStyles(readerCss(fontSizeRef.current));
      await view.init({ lastLocation: initialCfi, showTextStart: true });
      viewRef.current = view;
      syncAnnotations(view);
    })().catch(() => setError(true));
    return () => {
      cancelled = true;
      unwatch?.();
      viewRef.current = null;
      drawnRef.current = new Map();
      view?.close();
      view?.remove();
    };
  }, [bookId, fileUrl, initialCfi, save, syncAnnotations]);

  function chooseFontSize(size: number) {
    setFontSize(size);
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(size));
    } catch {
      // the choice just won't be remembered
    }
    viewRef.current?.renderer.setStyles(readerCss(size));
  }

  return (
    <div className="flex h-dvh flex-col">
      <ReaderToolbar
        format="epub"
        onPrev={() => void viewRef.current?.prev()}
        onNext={() => void viewRef.current?.next()}
        fontSize={fontSize}
        onFontSize={chooseFontSize}
      />
      {status}
      {error && (
        <p role="alert" className="p-4 text-sm text-red-600">
          Could not open this EPUB.
        </p>
      )}
      <div ref={hostRef} className="min-h-0 flex-1" />
    </div>
  );
}

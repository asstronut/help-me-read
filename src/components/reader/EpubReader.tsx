'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DrawAnnotationDetail,
  SectionLoadDetail,
  ShowAnnotationDetail,
  View,
} from 'foliate-js/view.js';
import { captureEpubSelection } from '@/lib/selection/capture-epub';
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
  onHighlightTap: (highlight: HighlightView) => void;
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

const fontCss = (size: number) => `html, body, p { font-size: ${size}px !important; }`;

/** The range's box in the reader's viewport (the section is drawn in an iframe). */
function boxInViewport(range: Range): SelectionBox {
  const r = range.getBoundingClientRect();
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement?.getBoundingClientRect();
  const dx = frame?.left ?? 0;
  const dy = frame?.top ?? 0;
  return { top: r.top + dy, bottom: r.bottom + dy, left: r.left + dx, right: r.right + dx };
}

/** The book's EPUB highlights by CFI, the key foliate draws annotations under. */
function byCfi(highlights: HighlightView[]): Map<string, HighlightView> {
  const map = new Map<string, HighlightView>();
  for (const h of highlights) if (h.anchor.format === 'epub') map.set(h.anchor.cfi, h);
  return map;
}

const drawsDiffer = (a: HighlightView, b: HighlightView) => a.kind !== b.kind || a.color !== b.color;

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
  // What the view has been asked to draw, by CFI.
  const drawnRef = useRef(new Map<string, HighlightView>());
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
    for (const [value, h] of next) {
      const old = drawn.get(value);
      if (!old || drawsDiffer(old, h)) view.addAnnotation({ value }).catch(() => undefined);
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
        unwatch = watchSelection(doc, (range) => {
          const selection = range && captureEpubSelection(range, bookId, index, current.getCFI(index, range));
          onSelectionRef.current(selection, range ? boxInViewport(range) : undefined);
        });
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
        const h = drawnRef.current.get(annotation.value);
        if (!h) return;
        if (h.kind === 'thread') draw(Overlayer.underline, { color: HIGHLIGHT_INKS[h.color], width: 2 });
        else draw(Overlayer.highlight, { color: HIGHLIGHT_FILLS[h.color] });
      });
      view.addEventListener('show-annotation', (e) => {
        const h = drawnRef.current.get((e as CustomEvent<ShowAnnotationDetail>).detail.value);
        if (h) onHighlightTapRef.current(h);
      });
      host.append(view);
      await view.open(fileUrl);
      if (cancelled) return;
      view.renderer.setAttribute('flow', 'paginated');
      view.renderer.setStyles(fontCss(fontSizeRef.current));
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
    viewRef.current?.renderer.setStyles(fontCss(size));
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

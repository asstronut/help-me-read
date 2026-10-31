'use client';

import { useEffect, useRef, useState } from 'react';
import type { SectionLoadDetail, View } from 'foliate-js/view.js';
import { captureEpubSelection } from '@/lib/selection/capture-epub';
import { watchSelection } from '@/lib/selection/watch';
import type { HighlightView, ReaderSelection } from '@/lib/types';
import { FONT_SIZES, ReaderToolbar } from './ReaderToolbar';
import type { SelectionBox } from './SelectionMenu';
import { usePositionSaver } from './usePositionSaver';

type Props = {
  bookId: string;
  fileUrl: string;
  initialCfi: string | null;
  onSelection: (selection: ReaderSelection | null, box?: SelectionBox) => void;
  highlights: HighlightView[];
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

export default function EpubReader({ bookId, fileUrl, initialCfi, onSelection }: Props) {
  const [fontSize, setFontSize] = useState(readFontSize);
  const [error, setError] = useState(false);
  const { save, status } = usePositionSaver(bookId);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const fontSizeRef = useRef(fontSize);
  const onSelectionRef = useRef(onSelection);
  useEffect(() => {
    fontSizeRef.current = fontSize;
    onSelectionRef.current = onSelection;
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let view: View | null = null;
    let unwatch: (() => void) | undefined;
    (async () => {
      await import('foliate-js/view.js');
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
      host.append(view);
      await view.open(fileUrl);
      if (cancelled) return;
      view.renderer.setAttribute('flow', 'paginated');
      view.renderer.setStyles(fontCss(fontSizeRef.current));
      await view.init({ lastLocation: initialCfi, showTextStart: true });
      viewRef.current = view;
    })().catch(() => setError(true));
    return () => {
      cancelled = true;
      unwatch?.();
      viewRef.current = null;
      view?.close();
      view?.remove();
    };
  }, [bookId, fileUrl, initialCfi, save]);

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

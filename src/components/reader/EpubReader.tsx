'use client';

import { useEffect, useRef, useState } from 'react';
import type { View } from 'foliate-js/view.js';
import type { HighlightView, ReaderSelection } from '@/lib/types';
import { FONT_SIZES, ReaderToolbar } from './ReaderToolbar';
import { usePositionSaver } from './usePositionSaver';

type Props = {
  bookId: string;
  fileUrl: string;
  initialCfi: string | null;
  onSelection: (selection: ReaderSelection | null) => void;
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

export default function EpubReader({ bookId, fileUrl, initialCfi }: Props) {
  const [fontSize, setFontSize] = useState(readFontSize);
  const [error, setError] = useState(false);
  const { save, status } = usePositionSaver(bookId);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const fontSizeRef = useRef(fontSize);
  useEffect(() => {
    fontSizeRef.current = fontSize;
  }, [fontSize]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let view: View | null = null;
    (async () => {
      await import('foliate-js/view.js');
      if (cancelled) return;
      view = document.createElement('foliate-view') as View;
      view.style.cssText = 'display:block;width:100%;height:100%';
      view.addEventListener('relocate', (e) => save({ cfi: (e as CustomEvent<{ cfi: string }>).detail.cfi }));
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
      viewRef.current = null;
      view?.close();
      view?.remove();
    };
  }, [fileUrl, initialCfi, save]);

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

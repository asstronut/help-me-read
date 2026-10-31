'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import { capturePdfSelection } from '@/lib/selection/capture-pdf';
import { watchSelection } from '@/lib/selection/watch';
import type { HighlightView, ReaderSelection } from '@/lib/types';
import { PdfHighlightLayer, highlightAt } from './PdfHighlightLayer';
import { ReaderToolbar } from './ReaderToolbar';
import type { SelectionBox } from './SelectionMenu';
import { usePositionSaver } from './usePositionSaver';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type Props = {
  bookId: string;
  fileUrl: string;
  initialPage: number;
  onSelection: (selection: ReaderSelection | null, box?: SelectionBox) => void;
  highlights: HighlightView[];
  onHighlightTap: (highlight: HighlightView) => void;
};

const MAX_FIT_WIDTH = 800;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
// Pages this far from the current one are drawn; the rest are sized placeholders.
const RENDER_AROUND = 1;
// A press that moves further than this before release is a drag, not a tap.
const TAP_SLOP_PX = 8;

const clampZoom = (z: number) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);

/** The page taking up the most of the visible area. */
function mostVisiblePage(container: HTMLElement): number | null {
  const view = container.getBoundingClientRect();
  let best: number | null = null;
  let bestArea = 0;
  for (const slot of container.querySelectorAll<HTMLElement>('[data-slot]')) {
    const r = slot.getBoundingClientRect();
    const visible = Math.min(r.bottom, view.bottom) - Math.max(r.top, view.top);
    if (visible > bestArea) {
      bestArea = visible;
      best = Number(slot.dataset.slot);
    }
  }
  return best;
}

const onPdfPage = (h: HighlightView, page: number) => h.anchor.format === 'pdf' && h.anchor.page === page;

export default function PdfReader({
  bookId,
  fileUrl,
  initialPage,
  onSelection,
  highlights,
  onHighlightTap,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  // height / width of the first page, used to size pages that are not drawn
  const [aspect, setAspect] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [error, setError] = useState(false);
  const { save, status } = usePositionSaver(bookId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(page);
  const pressedAt = useRef<{ x: number; y: number } | null>(null);
  const onSelectionRef = useRef(onSelection);
  useEffect(() => {
    pageRef.current = page;
    onSelectionRef.current = onSelection;
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (numPages > 0) save({ page });
  }, [page, numPages, save]);

  useEffect(
    () =>
      watchSelection(document, (range) => {
        const selection = range && capturePdfSelection(range, bookId);
        onSelectionRef.current(selection, range?.getBoundingClientRect());
      }),
    [bookId],
  );

  const scrollToPage = useCallback((target: number) => {
    scrollRef.current?.querySelector(`[data-slot="${target}"]`)?.scrollIntoView({ block: 'start' });
  }, []);

  function goTo(target: number) {
    const next = Math.min(Math.max(target, 1), Math.max(numPages, 1));
    setPage(next);
    scrollToPage(next);
  }

  /** A tap on a highlight; the end of a drag (a selection being made) is not a tap. */
  function onClick(e: MouseEvent) {
    const from = pressedAt.current;
    if (!from || Math.hypot(e.clientX - from.x, e.clientY - from.y) > TAP_SLOP_PX) return;
    const pageEl = (e.target as Element).closest<HTMLElement>('.react-pdf__Page[data-page-number]');
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    const tapped = highlightAt(
      highlights,
      Number(pageEl.dataset.pageNumber),
      (e.clientX - r.left) / r.width,
      (e.clientY - r.top) / r.height,
    );
    if (tapped) onHighlightTap(tapped);
  }

  function onScroll() {
    const el = scrollRef.current;
    const visible = el && mostVisiblePage(el);
    if (visible) setPage(visible);
  }

  const pageWidth = Math.min(containerWidth, MAX_FIT_WIDTH) * zoom;
  const ready = numPages > 0 && aspect > 0 && pageWidth > 0;

  // Keep the current page in view when the layout first appears and whenever page sizes change.
  useLayoutEffect(() => {
    if (ready) scrollToPage(pageRef.current);
  }, [ready, pageWidth, scrollToPage]);

  return (
    <div className="flex h-dvh flex-col">
      <ReaderToolbar
        format="pdf"
        page={page}
        numPages={numPages}
        onPage={goTo}
        onZoomIn={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
        onZoomOut={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
        onFitWidth={() => setZoom(1)}
      />
      {status}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={(e) => {
          pressedAt.current = { x: e.clientX, y: e.clientY };
        }}
        onClick={onClick}
        className="min-h-0 flex-1 overflow-auto"
      >
        {error && (
          <p role="alert" className="p-4 text-sm text-red-600">
            Could not open this PDF.
          </p>
        )}
        <Document
          file={fileUrl}
          loading={<p className="p-4 text-sm opacity-70">Loading…</p>}
          error=""
          onLoadSuccess={(doc) =>
            doc.getPage(1).then((first) => {
              const { width, height } = first.getViewport({ scale: 1 });
              setAspect(height / width);
              setNumPages(doc.numPages);
              setPage((p) => Math.min(p, doc.numPages));
            }, () => setError(true))
          }
          onLoadError={() => setError(true)}
        >
          {ready && (
            <div className="mx-auto flex w-fit flex-col gap-2">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
                <div
                  key={n}
                  data-slot={n}
                  aria-current={n === page ? 'page' : undefined}
                  style={{ width: pageWidth, minHeight: pageWidth * aspect }}
                >
                  {Math.abs(n - page) <= RENDER_AROUND && (
                    <Page pageNumber={n} width={pageWidth} renderAnnotationLayer={false}>
                      <PdfHighlightLayer highlights={highlights.filter((h) => onPdfPage(h, n))} />
                    </Page>
                  )}
                </div>
              ))}
            </div>
          )}
        </Document>
      </div>
    </div>
  );
}

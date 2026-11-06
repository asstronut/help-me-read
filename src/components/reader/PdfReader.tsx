'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import { currentPdfItem, pdfContents, type ContentsItem } from '@/lib/reader/contents';
import { listenForPageKeys } from '@/lib/reader/page-keys';
import { PREFS, usePref, type PdfFit } from '@/lib/reader/reading-prefs';
import { capturePdfSelection } from '@/lib/selection/capture-pdf';
import { watchTaps } from '@/lib/selection/tap';
import { watchSelection } from '@/lib/selection/watch';
import type { HighlightView, ReaderSelection } from '@/lib/types';
import type { ReaderControls } from './reader-controls';
import { ContentsOutline, ContentsRail } from './ContentsOutline';
import { PdfHighlightLayer, highlightsAt } from './PdfHighlightLayer';
import { PdfPageBar } from './PdfPageBar';
import { ProgressFooter } from './ProgressFooter';
import { ReaderTopBar } from './ReaderTopBar';
import { PdfOptions, ReadingSettings } from './ReadingSettings';
import type { SelectionBox } from './SelectionMenu';
import { usePositionSaver } from './usePositionSaver';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type Props = {
  bookId: string;
  title: string;
  fileUrl: string;
  initialPage: number;
  onSelection: (selection: ReaderSelection | null, box?: SelectionBox) => void;
  highlights: HighlightView[];
  /** The highlights under a tap, most recent first. */
  onHighlightTap: (highlights: HighlightView[]) => void;
  /** False while a side panel takes the room beside the book. */
  roomBeside: boolean;
  highlightsOpen: boolean;
  onHighlights: () => void;
  /** Filled in by the reader, so the page around it can move it to a highlight. */
  controlsRef: { current: ReaderControls | null };
  /** The PDF's bookmarks, once read (the highlights panel groups by them). */
  onContents: (items: ContentsItem[]) => void;
};

const MAX_FIT_WIDTH = 800;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;
// Pages this far from the current one are drawn; the rest are sized placeholders.
const RENDER_AROUND = 1;

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
  title,
  fileUrl,
  initialPage,
  onSelection,
  highlights,
  onHighlightTap,
  roomBeside,
  highlightsOpen,
  onHighlights,
  controlsRef,
  onContents,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  // The PDF's bookmarks; null until they are read.
  const [contents, setContents] = useState<ContentsItem[] | null>(null);
  // height / width of the first page, used to size pages that are not drawn
  const [aspect, setAspect] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = usePref(PREFS.pdfFit);
  const [keepColours, setKeepColours] = usePref(PREFS.keepPdfColours);
  // The pages' column, inside its padding: the room a fitted page has.
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [error, setError] = useState(false);
  const { save, status } = usePositionSaver(bookId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(page);
  const lastReleaseWasTap = useRef(false);
  const onSelectionRef = useRef(onSelection);
  useEffect(() => {
    pageRef.current = page;
    onSelectionRef.current = onSelection;
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setContainer({ width: entry.contentRect.width, height: entry.contentRect.height }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (numPages > 0) save({ page });
  }, [page, numPages, save]);

  useEffect(
    () =>
      watchTaps(document, (tap) => {
        lastReleaseWasTap.current = tap;
      }),
    [],
  );

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

  /** Goes to the page; with `y` (0 to 1 down the page), scrolls that point a third of the way down the view. */
  function goTo(target: number, y?: number) {
    const next = Math.min(Math.max(target, 1), Math.max(numPages, 1));
    setPage(next);
    const scroller = scrollRef.current;
    const slot = scroller?.querySelector<HTMLElement>(`[data-slot="${next}"]`);
    if (y === undefined || !scroller || !slot) scrollToPage(next);
    else scroller.scrollTop = slot.offsetTop + y * slot.offsetHeight - scroller.clientHeight / 3;
  }
  const goToRef = useRef(goTo);
  useEffect(() => {
    goToRef.current = goTo;
  });

  useEffect(() => listenForPageKeys(window, (dir) => goToRef.current(pageRef.current + dir)), []);

  useEffect(() => {
    controlsRef.current = {
      goTo: (anchor) => {
        if (anchor.format === 'pdf') goToRef.current(anchor.page, anchor.rects[0]?.y);
      },
    };
    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef]);

  /** A tap on a highlight; the end of a drag (a selection being made) is not a tap. */
  function onClick(e: MouseEvent) {
    if (!lastReleaseWasTap.current) return;
    const pageEl = (e.target as Element).closest<HTMLElement>('.react-pdf__Page[data-page-number]');
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    const tapped = highlightsAt(
      highlights,
      Number(pageEl.dataset.pageNumber),
      (e.clientX - r.left) / r.width,
      (e.clientY - r.top) / r.height,
    );
    if (tapped.length > 0) onHighlightTap(tapped);
  }

  function onScroll() {
    const el = scrollRef.current;
    const visible = el && mostVisiblePage(el);
    if (visible) setPage(visible);
  }

  // Whole page also keeps the page's height within the column, above the room left for the page bar.
  const widthFit = Math.min(container.width, MAX_FIT_WIDTH);
  const fitted = fit === 'page' && aspect > 0 ? Math.min(widthFit, container.height / aspect) : widthFit;
  const pageWidth = fitted * zoom;

  function chooseFit(next: PdfFit) {
    setFit(next);
    setZoom(1);
  }
  const ready = numPages > 0 && aspect > 0 && pageWidth > 0;

  // Keep the current page in view when the layout first appears and whenever page sizes change.
  useLayoutEffect(() => {
    if (ready) scrollToPage(pageRef.current);
  }, [ready, pageWidth, scrollToPage]);

  const current = contents && currentPdfItem(contents, page);
  const outline = {
    items: contents,
    currentId: current?.id ?? null,
    onGo: (item: ContentsItem) => {
      if (item.target && 'page' in item.target) goTo(item.target.page);
    },
    emptyText: 'No contents in this PDF',
  };

  return (
    <div className="flex h-dvh flex-col" data-pdf-colours={keepColours ? 'keep' : 'invert'}>
      <ReaderTopBar
        title={title}
        chapter={current?.label ?? null}
        contents={<ContentsOutline {...outline} placement="bar" />}
        highlightsOpen={highlightsOpen}
        onHighlights={onHighlights}
      >
        <ReadingSettings>
          <PdfOptions fit={fit} onFit={chooseFit} keepColours={keepColours} onKeepColours={setKeepColours} />
        </ReadingSettings>
      </ReaderTopBar>
      {status}
      {/* The pages start at the top of their column: line the ☰ icon (13px into its box) up with them. */}
      <ContentsRail {...outline} roomBeside={roomBeside} top={-13} className="sm:gap-6">
        <div className="relative min-h-0 min-w-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            onClick={onClick}
            // Room at the bottom so the last page can scroll up clear of the page bar.
            className="h-full overflow-auto pb-24"
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
              onLoadSuccess={(doc) => {
                void pdfContents(doc).then((items) => {
                setContents(items);
                onContents(items);
              });
                return doc.getPage(1).then((first) => {
                  const { width, height } = first.getViewport({ scale: 1 });
                  setAspect(height / width);
                  setNumPages(doc.numPages);
                  setPage((p) => Math.min(p, doc.numPages));
                }, () => setError(true));
              }}
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
          <PdfPageBar
            page={page}
            numPages={numPages}
            onPage={goTo}
            zoom={zoom}
            fittedToWidth={fit === 'width' && zoom === 1}
            onZoomIn={() => setZoom((z) => clampZoom(z + ZOOM_STEP))}
            onZoomOut={() => setZoom((z) => clampZoom(z - ZOOM_STEP))}
            onFitWidth={() => chooseFit('width')}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 sm:bottom-5"
          />
        </div>
      </ContentsRail>
      <ProgressFooter fraction={numPages > 0 ? page / numPages : null} />
    </div>
  );
}

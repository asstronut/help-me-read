'use client';

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import { currentPdfItem, pdfContents, type ContentsItem } from '@/lib/reader/contents';
import { listenForPageKeys, type PageTurn } from '@/lib/reader/page-keys';
import {
  NO_CROP,
  detectCrop,
  inkBoxOfCanvas,
  placeInSlot,
  saveCrop,
  savedCrop,
  sticksOut,
  type CropBox,
} from '@/lib/reader/pdf-crop';
import { isWholePage } from '@/lib/reader/pdf-motion';
import { CSS_PX_PER_POINT, zoomStep } from '@/lib/reader/pdf-zoom';
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
import { usePdfMotion } from './usePdfMotion';
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
  highlightsOpen: boolean;
  onHighlights: () => void;
  /** The book's languages, last in Aa. */
  languageOptions: ReactNode;
  /** Filled in by the reader, so the page around it can move it to a highlight. */
  controlsRef: { current: ReaderControls | null };
  /** The PDF's bookmarks, once read (the highlights panel groups by them). */
  onContents: (items: ContentsItem[]) => void;
};

// Pages this far from the current one are always drawn: after a jump, `page` is ahead of the observer.
const RENDER_AROUND = 1;
// A page is shaped unlike the book's first when their height / width differ by more than this share.
const ODD_SHAPE = 0.01;
// The longest the pages wait for the book's box on its first open with Crop white margins; then they show uncropped.
const CROP_WAIT_MS = 1500;

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

const NO_HIGHLIGHTS: HighlightView[] = [];

/** The PDF highlights of each page, so a page's list stays the same object while its highlights do. */
function highlightsByPage(highlights: HighlightView[]): ReadonlyMap<number, HighlightView[]> {
  const byPage = new Map<number, HighlightView[]>();
  for (const h of highlights) {
    if (h.anchor.format !== 'pdf') continue;
    const list = byPage.get(h.anchor.page);
    if (list) list.push(h);
    else byPage.set(h.anchor.page, [h]);
  }
  return byPage;
}

type SlotProps = {
  n: number;
  current: boolean;
  drawn: boolean;
  /** The size of the book's usual page, drawn whole. */
  width: number;
  height: number;
  /** The part of the page the slot shows ("Crop white margins"); null shows all of it. */
  crop: CropBox | null;
  /** Set for a page the crop would cut, to its own height / width: it is shown whole inside the slot. */
  ownAspect: number | null;
  highlights: HighlightView[];
  onDrawn: (n: number) => void;
};

/**
 * One page's place in the column. Memoized, as scrolling onto a new page changes the props of only
 * the few slots around it, and a book can have hundreds.
 *
 * With a crop the slot is a window onto the page: it has the box's size and clips, and the page is
 * drawn whole and moved so the window shows the box. The page element keeps the whole page's size,
 * so highlights and selections (fractions of the page) mean the same with and without a crop.
 */
const PdfPageSlot = memo(function PdfPageSlot({
  n,
  current,
  drawn,
  width,
  height,
  crop,
  ownAspect,
  highlights,
  onDrawn,
}: SlotProps) {
  const place = crop && placeInSlot(width, height, crop, ownAspect);
  return (
    <div
      data-slot={n}
      aria-current={current ? 'page' : undefined}
      className={
        crop
          ? 'overflow-clip bg-(--pdf-paper)'
          : // Paper only while nothing is drawn: a page shaped unlike the first would otherwise look as big as its slot.
            'not-has-[canvas]:bg-(--pdf-paper)'
      }
      style={crop ? { width: width * (crop.r - crop.l), height: height * (crop.b - crop.t) } : { width, minHeight: height }}
    >
      {drawn && (
        // Always here, so switching the crop moves the page without drawing it again from nothing.
        <div style={place ? { width: place.width, marginLeft: place.left, marginTop: place.top } : undefined}>
          <Page
            pageNumber={n}
            width={place ? place.width : width}
            // react-pdf paints the page white inline, which would flash white in Dark.
            className="bg-(--pdf-paper)!"
            loading=""
            renderAnnotationLayer={false}
            onRenderSuccess={() => onDrawn(n)}
          >
            <PdfHighlightLayer highlights={highlights} />
          </Page>
        </div>
      )}
    </div>
  );
});

export default function PdfReader({
  bookId,
  title,
  fileUrl,
  initialPage,
  onSelection,
  highlights,
  onHighlightTap,
  highlightsOpen,
  onHighlights,
  languageOptions,
  controlsRef,
  onContents,
}: Props) {
  const [numPages, setNumPages] = useState(0);
  // The PDF's bookmarks; null until they are read.
  const [contents, setContents] = useState<ContentsItem[] | null>(null);
  // height / width of the first page, used to size pages that are not drawn
  const [aspect, setAspect] = useState(0);
  // The first page's real width, in CSS pixels: what 100% means.
  const [realWidth, setRealWidth] = useState(0);
  const [page, setPage] = useState(initialPage);
  // The pages whose slots are within a screen of the view; the others stay empty slots.
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set());
  const [fit, setFit] = usePref(PREFS.pdfFit);
  // A zoom picked with − and +, as a share of the real size; null while the page is fitted.
  const [zoom, setZoom] = useState<number | null>(null);
  const [keepColours, setKeepColours] = usePref(PREFS.keepPdfColours);
  const [cropMargins, setCropMargins] = usePref(PREFS.cropPdfMargins);
  // The box that holds the book's content; null until it is found. `NO_CROP` for a book not worth cropping.
  // A box found on an earlier visit is used at once.
  const [bookCrop, setBookCrop] = useState<CropBox | null>(() => savedCrop(bookId));
  // With the option on, the pages wait for the box so they do not change size just after they appear;
  // they wait no longer than CROP_WAIT_MS, and once they have appeared they are never hidden again.
  const [cropWaitOver, setCropWaitOver] = useState(false);
  const holdForCrop = cropMargins && bookCrop === null && !cropWaitOver;
  // The pages the crop would cut, each with its own height / width: they are shown whole.
  const [wholePages, setWholePages] = useState<ReadonlyMap<number, number>>(() => new Map());
  const crop = cropMargins && bookCrop && bookCrop !== NO_CROP ? bookCrop : null;
  // The pages' column, inside its padding: the room a fitted page has.
  const [container, setContainer] = useState({ width: 0, height: 0 });
  const [error, setError] = useState(false);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const { save, status } = usePositionSaver(bookId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(page);
  const lastReleaseWasTap = useRef(false);
  const onSelectionRef = useRef(onSelection);
  const cropRef = useRef(crop);
  const aspectRef = useRef(aspect);
  useEffect(() => {
    pageRef.current = page;
    onSelectionRef.current = onSelection;
    cropRef.current = crop;
    aspectRef.current = aspect;
  });

  // Whole page: one page fills the column's height exactly, so no other page shows beside it.
  // With a crop the box is what gets fitted, so the page itself is drawn wider than the column.
  const boxShare = crop ? crop.r - crop.l : 1;
  const boxAspect = crop ? (aspect * (crop.b - crop.t)) / boxShare : aspect;
  const fitted =
    fit === 'page' && aspect > 0 ? Math.min(container.width, Math.floor(container.height / boxAspect)) : container.width;
  // The width the whole page is drawn at, so the zoom percentage is the page's real scale with a crop too.
  const pageWidth = zoom === null ? fitted / boxShare : realWidth * zoom;
  const scale = realWidth > 0 ? pageWidth / realWidth : 0;
  const zoomIn = zoomStep(scale, 1);
  const zoomOut = zoomStep(scale, -1);
  const ready = numPages > 0 && aspect > 0 && pageWidth > 0 && !holdForCrop;
  // Once the pages have appeared, they stay: turning the option on later only changes their size.
  if (ready && !cropWaitOver) setCropWaitOver(true);

  // Finds the book's box the first time the option is on, and remembers it for the next visit.
  useEffect(() => {
    if (!cropMargins || !pdfDoc || bookCrop) return;
    let cancelled = false;
    const stopWaiting = () => setCropWaitOver(true);
    const timer = window.setTimeout(stopWaiting, CROP_WAIT_MS);
    void detectCrop(pdfDoc, () => cancelled).then(
      (box) => {
        if (cancelled) return;
        if (!box) return stopWaiting();
        setBookCrop(box);
        saveCrop(bookId, box);
      },
      // A book that cannot be scanned is shown as it always was.
      () => {
        if (!cancelled) stopWaiting();
      },
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [cropMargins, pdfDoc, bookCrop, bookId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      // The width inside the padding; the whole visible height, as the bottom padding is not shown until the end.
      setContainer({ width: entry.contentRect.width, height: el.clientHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The top bar's chapter; undefined while the bookmarks are still being read.
  const current = contents && currentPdfItem(contents, page);
  const chapter = contents ? (current?.label ?? null) : undefined;

  useEffect(() => {
    if (numPages > 0) save({ page }, page / numPages, chapter);
  }, [page, numPages, chapter, save]);

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

  /** Makes the page the one that takes up the most of the view. */
  function followView() {
    const el = scrollRef.current;
    const visible = el && mostVisiblePage(el);
    if (visible) setPage(visible);
  }
  const motion = usePdfMotion({ scrollRef, fit, zoom, onGlideLost: followView });

  const scrollToPage = useCallback((target: number) => {
    scrollRef.current?.querySelector(`[data-slot="${target}"]`)?.scrollIntoView({ block: 'start' });
  }, []);

  // Before the PDF has loaded its length is unknown: a page typed then is kept, and capped once it loads.
  const clampPage = (n: number) => (numPages > 0 ? Math.min(Math.max(n, 1), numPages) : Math.max(n, 1));

  /**
   * Goes to the page; with `y` (0 to 1 down the page), scrolls that point a third of the way down
   * the view. Whole page shows the page from its top instead, as it has the room for all of it.
   */
  function goTo(target: number, y?: number) {
    const next = clampPage(target);
    pageRef.current = next;
    setPage(next);
    const scroller = scrollRef.current;
    const slot = scroller?.querySelector<HTMLElement>(`[data-slot="${next}"]`);
    if (y === undefined || isWholePage(fit, zoom) || !scroller || !slot) {
      scrollToPage(next);
      return;
    }
    // `y` is a share of the whole page; with a crop the slot shows only a part of the page.
    const place = crop && placeInSlot(pageWidth, pageWidth * aspect, crop, wholePages.get(next) ?? null);
    const down = place ? place.top + y * place.height : y * slot.offsetHeight;
    scroller.scrollTop = slot.offsetTop + down - scroller.clientHeight / 3;
  }
  /** Turns one page, gliding there. The page number goes first, so a press during the glide starts from the new page. */
  function turn(dir: PageTurn) {
    const next = clampPage(pageRef.current + dir);
    if (next === pageRef.current) return;
    pageRef.current = next;
    setPage(next);
    motion.glideTo(next);
  }
  const goToRef = useRef(goTo);
  const turnRef = useRef(turn);
  useEffect(() => {
    goToRef.current = goTo;
    turnRef.current = turn;
  });

  useEffect(() => listenForPageKeys(window, (dir) => turnRef.current(dir)), []);

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

  /**
   * With a crop: marks a drawn page to be shown whole when the book's box would cut it, as its
   * content passes the box (a cover, a stamp in the margin) or it is shaped unlike the first page
   * (another size, or turned), which the box and the slot were not measured for.
   */
  const checkCrop = useCallback((canvas: HTMLCanvasElement, pageNumber: number, box: CropBox) => {
    if (canvas.width === 0 || canvas.height === 0) return;
    const ownAspect = canvas.height / canvas.width;
    const cut = Math.abs(ownAspect / aspectRef.current - 1) > ODD_SHAPE || sticksOut(inkBoxOfCanvas(canvas) ?? box, box);
    if (cut) setWholePages((pages) => (pages.has(pageNumber) ? pages : new Map(pages).set(pageNumber, ownAspect)));
  }, []);

  // The pages drawn before the crop came on were not checked against it.
  useEffect(() => {
    if (!crop) return;
    for (const canvas of scrollRef.current?.querySelectorAll<HTMLCanvasElement>('[data-slot] canvas') ?? []) {
      checkCrop(canvas, Number(canvas.closest<HTMLElement>('[data-slot]')?.dataset.slot), crop);
    }
  }, [crop, checkCrop]);

  /**
   * Shows a drawn page's canvas at exactly its pixel size. react-pdf rounds the canvas's pixels and
   * its size on screen separately, so they can differ by up to a pixel; the browser then stretches
   * the picture to fit, which blurs the text.
   */
  const showAtPixelSize = useCallback((pageNumber: number) => {
    const canvas = scrollRef.current?.querySelector<HTMLCanvasElement>(`[data-slot="${pageNumber}"] canvas`);
    if (!canvas) return;
    canvas.style.width = `${canvas.width / window.devicePixelRatio}px`;
    canvas.style.height = `${canvas.height / window.devicePixelRatio}px`;
    if (cropRef.current) checkCrop(canvas, pageNumber, cropRef.current);
  }, [checkCrop]);
  const byPage = useMemo(() => highlightsByPage(highlights), [highlights]);

  function onScroll() {
    // A glide has named its page already; the view only passes through the pages on the way.
    if (motion.scrolled() !== 'glide') followView();
  }

  function chooseFit(next: PdfFit) {
    setFit(next);
    setZoom(null);
  }

  // Keep the current page in view when the layout first appears, whenever page sizes change, and
  // whenever the PDF is loaded again. Cache Components keeps the reader mounted but hidden while the
  // library shows, and the Document drops its PDF then; on the way back the pages are drawn anew
  // (twice when the book's link has changed meanwhile), while the reader is still `ready`.
  useLayoutEffect(() => {
    if (ready) scrollToPage(pageRef.current);
  }, [ready, pageWidth, crop, pdfDoc, scrollToPage]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !ready) return;
    const seen = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const { target, isIntersecting } of entries) {
          const n = Number((target as HTMLElement).dataset.slot);
          if (isIntersecting) seen.add(n);
          else seen.delete(n);
        }
        setNear(new Set(seen));
      },
      // A screen's height of margin above and below the view.
      { root: scroller, rootMargin: '100% 0px' },
    );
    for (const slot of scroller.querySelectorAll('[data-slot]')) observer.observe(slot);
    return () => observer.disconnect();
  }, [ready, numPages]);

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
        chapter={chapter ?? null}
        contents={<ContentsOutline {...outline} placement="bar" />}
        highlightsOpen={highlightsOpen}
        onHighlights={onHighlights}
      >
        <ReadingSettings>
          <PdfOptions
            fit={fit}
            onFit={chooseFit}
            keepColours={keepColours}
            onKeepColours={setKeepColours}
            cropMargins={cropMargins}
            onCropMargins={setCropMargins}
          />
          {languageOptions}
        </ReadingSettings>
      </ReaderTopBar>
      {status}
      {/* The pages start at the top of their column: line the ☰ icon (13px into its box) up with them. */}
      <ContentsRail {...outline} top={-13} className="sm:gap-6" balanced={false}>
        <div className="relative min-h-0 min-w-0 flex-1">
          <div
            ref={scrollRef}
            onScroll={onScroll}
            onClick={onClick}
            // Room at the bottom so the last page can scroll up clear of the page bar.
            className="scrollbar-slim h-full overflow-auto pb-24 [scrollbar-gutter:stable] sm:pr-3"
          >
            {error && (
              <p role="alert" className="p-4 text-sm text-red-600">
                Could not open this PDF.
              </p>
            )}
            <Document
              file={fileUrl}
              // Without this a page that is loading suspends the whole reader, and React hides it.
              suspense={false}
              loading={<p className="p-4 text-sm opacity-70">Loading…</p>}
              error=""
              onLoadSuccess={(doc) => {
                setPdfDoc(doc);
                void pdfContents(doc).then((items) => {
                setContents(items);
                onContents(items);
              });
                return doc.getPage(1).then((first) => {
                  const { width, height } = first.getViewport({ scale: 1 });
                  setAspect(height / width);
                  setRealWidth(width * CSS_PX_PER_POINT);
                  setNumPages(doc.numPages);
                  pageRef.current = Math.min(pageRef.current, doc.numPages);
                  setPage((p) => Math.min(p, doc.numPages));
                }, () => setError(true));
              }}
              onLoadError={() => setError(true)}
            >
              {!ready && !error && <p className="p-4 text-sm opacity-70">Loading…</p>}
              {ready && (
                <div className="mx-auto flex w-fit flex-col gap-2">
                  {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
                    <PdfPageSlot
                      key={n}
                      n={n}
                      current={n === page}
                      drawn={near.has(n) || Math.abs(n - page) <= RENDER_AROUND}
                      width={pageWidth}
                      height={pageWidth * aspect}
                      crop={crop}
                      ownAspect={crop ? (wholePages.get(n) ?? null) : null}
                      highlights={byPage.get(n) ?? NO_HIGHLIGHTS}
                      onDrawn={showAtPixelSize}
                    />
                  ))}
                </div>
              )}
            </Document>
          </div>
          <PdfPageBar
            page={page}
            numPages={numPages}
            onPage={goTo}
            onTurn={turn}
            scale={scale}
            fit={zoom === null ? fit : null}
            onZoomIn={zoomIn === null ? undefined : () => setZoom(zoomIn)}
            onZoomOut={zoomOut === null ? undefined : () => setZoom(zoomOut)}
            onFit={chooseFit}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 sm:bottom-5"
          />
        </div>
      </ContentsRail>
      <ProgressFooter fraction={numPages > 0 ? page / numPages : null} />
    </div>
  );
}

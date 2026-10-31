'use client';

import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import type { HighlightView, ReaderSelection } from '@/lib/types';
import { ReaderToolbar } from './ReaderToolbar';
import { usePositionSaver } from './usePositionSaver';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type Props = {
  bookId: string;
  fileUrl: string;
  initialPage: number;
  onSelection: (selection: ReaderSelection | null) => void;
  highlights: HighlightView[];
};

const MAX_FIT_WIDTH = 800;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

const clampZoom = (z: number) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);

export default function PdfReader({ bookId, fileUrl, initialPage }: Props) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [zoom, setZoom] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [error, setError] = useState(false);
  const { save, status } = usePositionSaver(bookId);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  function goTo(target: number) {
    setPage(Math.min(Math.max(target, 1), Math.max(numPages, 1)));
    scrollRef.current?.scrollTo({ top: 0 });
  }

  const fitWidth = Math.min(containerWidth, MAX_FIT_WIDTH);

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
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
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
            setNumPages(doc.numPages);
            setPage((p) => Math.min(p, doc.numPages));
          }}
          onLoadError={() => setError(true)}
        >
          {numPages > 0 && fitWidth > 0 && (
            <div className="mx-auto w-fit">
              <Page pageNumber={page} width={fitWidth * zoom} renderAnnotationLayer={false} />
            </div>
          )}
        </Document>
      </div>
    </div>
  );
}

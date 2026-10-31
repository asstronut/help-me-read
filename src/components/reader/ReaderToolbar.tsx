'use client';

import { useState } from 'react';

type Props = {
  page: number;
  numPages: number;
  onPage: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitWidth: () => void;
};

const button = 'rounded px-2 py-1 text-sm hover:bg-gray-500/10 disabled:opacity-40';

export function ReaderToolbar({ page, numPages, onPage, onZoomIn, onZoomOut, onFitWidth }: Props) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    const typed = Number.parseInt(draft ?? '', 10);
    setDraft(null);
    if (Number.isFinite(typed)) onPage(typed);
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-300/50 px-2 py-1">
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className={button}
      >
        ‹
      </button>
      <input
        aria-label="Page number"
        inputMode="numeric"
        value={draft ?? String(page)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="w-12 rounded border border-gray-300/60 bg-transparent px-1 py-0.5 text-center text-sm"
      />
      <span className="text-sm opacity-70">/ {numPages}</span>
      <button
        type="button"
        aria-label="Next page"
        disabled={page >= numPages}
        onClick={() => onPage(page + 1)}
        className={button}
      >
        ›
      </button>
      <span className="mx-1 h-4 w-px bg-gray-300/60" />
      <button type="button" aria-label="Zoom out" onClick={onZoomOut} className={button}>
        −
      </button>
      <button type="button" aria-label="Zoom in" onClick={onZoomIn} className={button}>
        +
      </button>
      <button type="button" aria-label="Fit to width" onClick={onFitWidth} className={button}>
        Fit
      </button>
    </div>
  );
}

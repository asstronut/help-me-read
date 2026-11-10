'use client';

import { useState, type ComponentProps } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, MinusIcon, PlusIcon } from '@/components/ui/icons';
import { cn } from '@/components/ui/cn';
import type { PdfFit } from '@/lib/reader/reading-prefs';

type Props = {
  page: number;
  numPages: number;
  onPage: (page: number) => void;
  /** The page's size as a share of its real size: 1 is 100%. */
  scale: number;
  /** How the page is fitted; null once − or + has set a zoom of its own. */
  fit: PdfFit | null;
  /** Missing when there is no further step that way. */
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onFit: (fit: PdfFit) => void;
  className?: string;
};

/** A 44px square button in the bar; `aria-label` names it, as it shows only an icon. */
function BarButton({ className, ...props }: ComponentProps<'button'> & { 'aria-label': string }) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] transition-colors hover:bg-chip',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

const Divider = () => <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-rule sm:mx-1" />;

/** The PDF's page and zoom controls, floating over the bottom of the pages. */
export function PdfPageBar({
  page,
  numPages,
  onPage,
  scale,
  fit,
  onZoomIn,
  onZoomOut,
  onFit,
  className,
}: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  // One button for both fits, as in a browser's PDF viewer: it offers the one the page is not in.
  const nextFit: PdfFit = fit === 'width' ? 'page' : 'width';
  const fitLabel = nextFit === 'page' ? 'Fit to page' : 'Fit to width';

  function commit() {
    const typed = Number.parseInt(draft ?? '', 10);
    setDraft(null);
    if (Number.isFinite(typed)) onPage(typed);
  }

  return (
    <nav
      aria-label="Page controls"
      className={cn(
        'flex items-center rounded-xl border border-rule bg-surface px-1 text-[13px] whitespace-nowrap text-ink shadow-[0_8px_24px_var(--shadow)]',
        className,
      )}
    >
      <BarButton aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        <ChevronLeftIcon size={16} />
      </BarButton>
      <span className="flex items-center gap-1.5 tabular-nums">
        <input
          aria-label="Page number"
          inputMode="numeric"
          value={draft ?? String(page)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className="h-8 w-11 rounded-lg border border-rule bg-transparent text-center text-ink focus-visible:outline-2 focus-visible:outline-accent"
        />
        <span className="text-muted">of {numPages}</span>
      </span>
      <BarButton aria-label="Next page" disabled={page >= numPages} onClick={() => onPage(page + 1)}>
        <ChevronRightIcon size={16} />
      </BarButton>
      <Divider />
      <BarButton aria-label="Zoom out" disabled={!onZoomOut} onClick={onZoomOut}>
        <MinusIcon size={16} />
      </BarButton>
      {/* Hidden on a phone to keep the bar on screen. */}
      <span className="hidden w-11 text-center tabular-nums sm:inline">{Math.round(scale * 100)}%</span>
      <BarButton aria-label="Zoom in" disabled={!onZoomIn} onClick={onZoomIn}>
        <PlusIcon size={16} />
      </BarButton>
      <Divider />
      <button
        type="button"
        aria-label={fitLabel}
        onClick={() => onFit(nextFit)}
        className={cn(
          'my-1.5 inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg px-3 transition-colors',
          // The visible part of the button is 32px, but the area it answers to is the bar's full 44px.
          'relative after:absolute after:inset-x-0 after:-inset-y-1.5',
          'hover:bg-chip focus-visible:outline-2 focus-visible:outline-accent',
        )}
      >
        <span className="sm:hidden">Fit</span>
        <span className="hidden sm:inline">{fitLabel}</span>
      </button>
    </nav>
  );
}

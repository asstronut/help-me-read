import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/components/ui/cn';
import { BookmarkIcon, ChevronLeftIcon } from '@/components/ui/icons';

type Props = {
  /** The book's title. */
  title: string;
  /** The chapter the reader is in, from the book's contents; null when unknown. */
  chapter?: string | null;
  /** The ☰ contents button, shown here on a phone (on wider screens it sits beside the book). */
  contents?: ReactNode;
  /** Whether the highlights and threads panel is open, and the bookmark button that opens and closes it. */
  highlightsOpen: boolean;
  onHighlights: () => void;
  /** The reader's controls on the right, such as Aa (before the bookmark button). */
  children?: ReactNode;
};

/** The bar above the book: back to the Library, the book's title, and the reader's own controls. */
export function ReaderTopBar({ title, chapter, contents, highlightsOpen, onHighlights, children }: Props) {
  return (
    <header className="flex items-center gap-2 px-2 py-1 text-[13px] text-muted sm:gap-4 sm:px-7 sm:py-4">
      {/* The two sides share the space equally, so the title stays centred on the page. */}
      <div className="flex flex-1 basis-0">
        <Link
          href="/library"
          className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-[10px] transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent sm:-ml-2 sm:px-2"
        >
          <ChevronLeftIcon />
          {/* Just the chevron on a phone, to leave room for the title; the name stays "Library". */}
          <span className="max-sm:sr-only">Library</span>
        </Link>
        {contents && <div className="sm:hidden">{contents}</div>}
      </div>
      <div className="min-w-0 truncate text-center text-[11px] tracking-[0.08em] uppercase">
        {/* On a phone the chapter alone, when there is one (the title is still read out). */}
        <h1 className={cn('inline', chapter && 'max-sm:sr-only')}>{title}</h1>
        {chapter && (
          <>
            <span aria-hidden="true" className="max-sm:hidden">
              {' · '}
            </span>
            <span className="sr-only">, </span>
            <span>{chapter}</span>
          </>
        )}
      </div>
      <div className="flex flex-1 basis-0 justify-end gap-1">
        {children}
        <IconButton aria-label="Highlights and threads" aria-pressed={highlightsOpen} onClick={onHighlights}>
          <BookmarkIcon />
        </IconButton>
      </div>
    </header>
  );
}

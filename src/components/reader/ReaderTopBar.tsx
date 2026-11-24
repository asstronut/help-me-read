import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/components/ui/cn';
import { insetHover } from '@/components/ui/hover';
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
  className?: string;
};

/**
 * Where the book starts, under the bar: 44px controls and `py-1` around them. A tap catcher for a
 * sheet over the book starts here, so the bar's buttons keep working while the sheet is open.
 */
export const BELOW_TOP_BAR = 'top-13';

/** The bar above the book: back to the Library, the book's title, and the reader's own controls. */
export function ReaderTopBar({
  title,
  chapter,
  contents,
  highlightsOpen,
  onHighlights,
  children,
  className,
}: Props) {
  return (
    <header
      className={cn('flex items-center gap-2 px-2 py-1 text-[14px] text-muted sm:gap-4 sm:px-7', className)}
    >
      {/* The two sides share the space equally, so the title stays centred on the page. */}
      <div className="flex flex-1 basis-0">
        <Link
          href="/library"
          className={cn(
            'inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-[10px] transition-colors hover:text-ink sm:-ml-2 sm:px-2',
            // The same 32px grey as the icon buttons on the right of the bar.
            insetHover('row'),
            'focus-visible:outline-2 focus-visible:outline-accent',
          )}
        >
          <ChevronLeftIcon />
          {/* Just the chevron on a phone, to leave room for the title; the name stays "Library". */}
          <span className="max-sm:sr-only">Library</span>
        </Link>
        {contents && <div className="sm:hidden">{contents}</div>}
      </div>
      <div className="min-w-0 truncate text-center">
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

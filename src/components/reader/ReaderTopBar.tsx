import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { BookmarkIcon, ChevronLeftIcon } from '@/components/ui/icons';

type Props = {
  /** The book's title. (The current chapter joins it once the reader knows the contents.) */
  title: string;
  /** The reader's controls on the right, such as Aa (before the bookmark button). */
  children?: ReactNode;
};

/** The bar above the book: back to the Library, the book's title, and the reader's own controls. */
export function ReaderTopBar({ title, children }: Props) {
  return (
    <header className="flex items-center gap-2 px-2 py-1 text-[13px] text-muted sm:gap-4 sm:px-7 sm:py-4">
      {/* The two sides share the space equally, so the title stays centred on the page. */}
      <div className="flex flex-1 basis-0">
        <Link
          href="/library"
          className="inline-flex h-11 items-center gap-2 rounded-[10px] px-2 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent sm:-ml-2"
        >
          <ChevronLeftIcon />
          <span>Library</span>
        </Link>
      </div>
      <h1 className="min-w-0 truncate text-center text-[11px] tracking-[0.08em] uppercase">{title}</h1>
      <div className="flex flex-1 basis-0 justify-end gap-1">
        {children}
        {/*
          A placeholder: this will open the highlights and threads panel (phase 4, step 16).
          aria-disabled rather than disabled, so it can still be focused and a screen reader
          says it is unavailable.
        */}
        <IconButton
          aria-label="Highlights and threads"
          aria-disabled="true"
          title="Highlights and threads: coming soon"
          className="aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted"
        >
          <BookmarkIcon />
        </IconButton>
      </div>
    </header>
  );
}

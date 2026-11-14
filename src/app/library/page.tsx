'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { SiteNav } from '@/components/SiteNav';
import { Button, buttonClasses } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { IconButton } from '@/components/ui/IconButton';
import { MoreIcon, RefreshIcon } from '@/components/ui/icons';
import { InlineAlert } from '@/components/ui/InlineAlert';
import type { BookItem } from '@/lib/books/book-item';
import { extractAndSave } from '@/lib/books/extract-and-save';
import { BookCover, progressLabel } from './book-cover';
import { UploadDropzone } from './upload-dropzone';

export default function LibraryPage() {
  const [books, setBooks] = useState<BookItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const attempted = useRef(new Set<string>());
  // A list request sent before a delete can answer after it; deleted books stay out of the list.
  const deleted = useRef(new Set<string>());
  const showBooks = useCallback((list: BookItem[]) => {
    setBooks(list.filter((b) => !deleted.current.has(b.id)));
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/books');
      if (!res.ok) throw new Error(String(res.status));
      showBooks(((await res.json()) as { books: BookItem[] }).books);
      setError(null);
    } catch {
      setError('Could not load your library. Please refresh to try again.');
    }
  }, [showBooks]);

  // Refreshes the list after an upload or extraction without touching an error already shown.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/books');
      if (res.ok) showBooks(((await res.json()) as { books: BookItem[] }).books);
    } catch {
      // the next refresh will try again
    }
  }, [showBooks]);

  const prepare = useCallback(
    async (book: BookItem) => {
      attempted.current.add(book.id);
      try {
        const meta = await fetch(`/api/books/${book.id}`);
        if (!meta.ok) throw new Error(String(meta.status));
        const { fileUrl } = (await meta.json()) as { fileUrl: string };
        const blob = await (await fetch(fileUrl)).blob();
        const file = new File([blob], `${book.id}.${book.format}`);
        await extractAndSave(book.id, file, book.format);
      } catch {
        setFailed((current) => new Set(current).add(book.id));
      }
      await refresh();
    },
    [refresh],
  );

  // Books whose text is not ready (a new upload, or an earlier attempt that was cut short)
  // are prepared here, once per page visit.
  useEffect(() => {
    for (const book of books ?? []) {
      if (!book.extracted && !attempted.current.has(book.id)) void prepare(book);
    }
  }, [books, prepare]);

  function retry(book: BookItem) {
    attempted.current.delete(book.id);
    setFailed((current) => {
      const next = new Set(current);
      next.delete(book.id);
      return next;
    });
    void prepare(book);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial fetch on mount
    void load();
  }, [load]);

  async function remove(id: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/books/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      deleted.current.add(id);
      setBooks((current) => current?.filter((b) => b.id !== id) ?? null);
      setError(null);
    } catch {
      setError('Could not delete this book. Please try again.');
    }
    setDeleting(false);
    setConfirming(null);
  }

  // The list comes newest-opened first, so the first opened book is the one read last.
  const continuing = books?.find((b) => b.lastOpenedAt !== null) ?? null;

  return (
    <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-10 px-4 pt-5 pb-16 sm:gap-12 sm:px-6 sm:pt-7">
      <SiteNav current="Library" />
      {error && <InlineAlert>{error}</InlineAlert>}
      {continuing && <ContinueReading book={continuing} />}

      <section aria-labelledby="shelf" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-rule pb-3">
          <h2 id="shelf" className="font-serif text-[22px]">
            Your books
          </h2>
          <UploadDropzone onUploaded={refresh} />
        </div>
        {books?.length === 0 && (
          <div className="flex flex-col gap-1 rounded-xl border border-dashed border-rule p-5">
            <p className="font-serif text-[17px]">No books yet</p>
            <p className="text-sm text-muted">Add your first one with “Add a book”.</p>
          </div>
        )}
        {books && books.length > 0 && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-4 gap-y-8 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-6">
            {books.map((book) => (
              <ShelfBook
                key={book.id}
                book={book}
                failed={failed.has(book.id)}
                onRetry={() => retry(book)}
                confirming={confirming === book.id}
                deleting={deleting}
                onAskDelete={() => setConfirming(book.id)}
                onDelete={() => void remove(book.id)}
                onCancelDelete={() => setConfirming(null)}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

type ShelfBookProps = {
  book: BookItem;
  /** Preparing its text failed on this visit. */
  failed: boolean;
  onRetry: () => void;
  confirming: boolean;
  deleting: boolean;
  onAskDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
};

/** One book on the shelf: its cover (which opens it), its title, author and progress, and ⋯. */
function ShelfBook({
  book,
  failed,
  onRetry,
  confirming,
  deleting,
  onAskDelete,
  onDelete,
  onCancelDelete,
}: ShelfBookProps) {
  const broken = !book.extracted && failed;
  const preparing = !book.extracted && !failed;
  return (
    <li className="flex min-w-0 flex-col gap-2.5">
      <div className="relative">
        <Link
          href={`/read/${book.id}`}
          className={cn(
            'block rounded-[3px_6px_6px_3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            !book.extracted && 'opacity-55',
          )}
        >
          <BookCover book={book} className="shadow-[0_8px_20px_var(--shadow)]" />
        </Link>
        {/* Outside the link, so trying again does not open the book. */}
        {broken && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Button
              variant="primary"
              onClick={onRetry}
              className="pointer-events-auto shadow-[0_6px_16px_var(--shadow)]"
            >
              <RefreshIcon size={14} />
              Retry
            </Button>
          </div>
        )}
      </div>
      <div className="flex items-start gap-1">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{book.title}</span>
          {book.author && <span className="truncate text-xs text-muted">{book.author}</span>}
          {broken ? (
            <span className="text-xs text-danger">Couldn&apos;t prepare text</span>
          ) : preparing ? (
            <span className="text-xs text-muted">Preparing text…</span>
          ) : (
            <span className="text-xs text-muted tabular-nums">
              {`${book.format.toUpperCase()} · ${progressLabel(book.progress)}`}
            </span>
          )}
        </div>
        <BookMenu title={book.title} disabled={confirming} onDelete={onAskDelete} />
      </div>
      {confirming && (
        <div className="flex flex-col gap-2 rounded-xl bg-danger-tint p-3 text-sm">
          <span>Delete this book with its highlights, threads and notes?</span>
          <div className="flex flex-wrap gap-1">
            <Button variant="danger" onClick={onDelete} disabled={deleting}>
              Yes, delete
            </Button>
            <Button variant="quiet" onClick={onCancelDelete} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** The book read last: its cover, where the reader is in it, and a way back in. */
function ContinueReading({ book }: { book: BookItem }) {
  const where = [book.author, book.chapter].filter(Boolean).join(' · ');
  const percent = book.progress === null ? null : Math.round(Math.min(Math.max(book.progress, 0), 1) * 100);
  return (
    <section aria-labelledby="continue" className="flex flex-wrap items-center gap-5 sm:gap-8">
      <BookCover book={book} withAuthor className="w-24 shadow-[0_14px_30px_var(--shadow)] sm:w-[150px]" />
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-3">
        <h2 id="continue" className="text-xs font-medium tracking-[0.1em] text-muted uppercase">
          Continue reading
        </h2>
        <p className="font-serif text-[28px] leading-tight break-words sm:text-4xl">{book.title}</p>
        {where && <p className="text-[15px] break-words text-muted">{where}</p>}
        {percent !== null && (
          <div className="flex max-w-[360px] items-center gap-3">
            <div
              role="progressbar"
              aria-label="Reading progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-[3px] flex-1 overflow-hidden rounded-sm bg-rule"
            >
              <div className="h-full bg-ink" style={{ width: `${percent}%` }} />
            </div>
            {/* The progress bar gives screen readers the number. */}
            <span aria-hidden="true" className="text-xs text-muted tabular-nums">
              {`${percent}%`}
            </span>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2.5">
          <Link href={`/read/${book.id}`} className={buttonClasses('primary')}>
            Continue
          </Link>
        </div>
      </div>
    </section>
  );
}

/** The ⋯ button beside a book and the actions it opens; for now only Delete. */
function BookMenu({ title, disabled, onDelete }: { title: string; disabled: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={root} className="relative -mt-1.5 -mr-2.5">
      <IconButton
        ref={trigger}
        aria-label={`Options for ${title}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreIcon size={16} />
      </IconButton>
      {open && (
        <div
          id={menuId}
          className="absolute top-full right-0 z-10 rounded-xl border border-rule bg-surface p-1 shadow-[0_8px_24px_var(--shadow)]"
        >
          <Button
            ref={first}
            variant="danger"
            aria-label={`Delete ${title}`}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}

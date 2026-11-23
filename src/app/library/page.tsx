'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { SiteNav } from '@/components/SiteNav';
import { Button, buttonClasses } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { IconButton } from '@/components/ui/IconButton';
import { MoreVerticalIcon, RefreshIcon } from '@/components/ui/icons';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { FIELD } from '@/components/ui/field';
import type { BookItem } from '@/lib/books/book-item';
import { extractAndSave } from '@/lib/books/extract-and-save';
import { MAX_TITLE_CHARS } from '@/lib/types';
import { BookCover, progressLabel } from './book-cover';
import { UploadDropzone } from './upload-dropzone';

export default function LibraryPage() {
  const [books, setBooks] = useState<BookItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // The book read last shows on the card and on the shelf: these hold a shelf book's id, or CARD.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
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

  /** Saves a new title; resolves to an error message, or null once it is saved. */
  async function rename(id: string, title: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/books/${id}/title`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const saved = ((await res.json()) as { title: string }).title;
      setBooks((current) => current?.map((b) => (b.id === id ? { ...b, title: saved } : b)) ?? null);
      setRenaming(null);
      return null;
    } catch {
      return 'Could not rename this book. Please try again.';
    }
  }

  // The list comes newest-opened first, so the first opened book is the one read last.
  const continuing = books?.find((b) => b.lastOpenedAt !== null) ?? null;

  return (
    <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-10 px-4 pt-5 pb-16 sm:gap-12 sm:px-6 sm:pt-7">
      <SiteNav current="Library" />
      {error && <InlineAlert>{error}</InlineAlert>}
      {continuing && (
        <ContinueReading
          book={continuing}
          confirming={confirming === CARD}
          deleting={deleting}
          onAskDelete={() => {
            setRenaming(null);
            setConfirming(CARD);
          }}
          onDelete={() => void remove(continuing.id)}
          onCancelDelete={() => setConfirming(null)}
          renaming={renaming === CARD}
          onAskRename={() => {
            setConfirming(null);
            setRenaming(CARD);
          }}
          onRename={(title) => rename(continuing.id, title)}
          onCancelRename={() => setRenaming(null)}
        />
      )}

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
                onAskDelete={() => {
                  setRenaming(null);
                  setConfirming(book.id);
                }}
                onDelete={() => void remove(book.id)}
                onCancelDelete={() => setConfirming(null)}
                renaming={renaming === book.id}
                onAskRename={() => {
                  setConfirming(null);
                  setRenaming(book.id);
                }}
                onRename={(title) => rename(book.id, title)}
                onCancelRename={() => setRenaming(null)}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

/** The key `confirming` and `renaming` use for the Continue reading card. */
const CARD = 'continue';

/** Rename and Delete for one book, on the card or the shelf. */
type BookActionProps = {
  confirming: boolean;
  deleting: boolean;
  onAskDelete: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  renaming: boolean;
  onAskRename: () => void;
  /** Resolves to an error message, or null once the new title is saved. */
  onRename: (title: string) => Promise<string | null>;
  onCancelRename: () => void;
};

type ShelfBookProps = BookActionProps & {
  book: BookItem;
  /** Preparing its text failed on this visit. */
  failed: boolean;
  onRetry: () => void;
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
  renaming,
  onAskRename,
  onRename,
  onCancelRename,
}: ShelfBookProps) {
  const broken = !book.extracted && failed;
  const preparing = !book.extracted && !failed;
  return (
    <li className="group/book flex min-w-0 flex-col gap-2.5">
      <div className="relative">
        <Link
          href={`/read/${book.id}`}
          className={cn(
            'block rounded-[3px_6px_6px_3px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
            !book.extracted && 'opacity-55',
          )}
        >
          <BookCover book={book} className="shadow-[0_1px_2px_var(--shadow),0_4px_12px_var(--shadow)]" />
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
        <BookMenu
          title={book.title}
          disabled={confirming || renaming}
          onRename={onAskRename}
          onDelete={onAskDelete}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">{book.title}</span>
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
      {renaming && <RenameForm title={book.title} onSave={onRename} onCancel={onCancelRename} />}
      {confirming && <DeleteConfirm deleting={deleting} onDelete={onDelete} onCancel={onCancelDelete} />}
    </li>
  );
}

/** Asks before a book goes, with its highlights, threads and notes. */
function DeleteConfirm({
  deleting,
  onDelete,
  onCancel,
}: {
  deleting: boolean;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-danger-tint p-3 text-sm">
      <span>Delete this book with its highlights, threads and notes?</span>
      <div className="flex flex-wrap gap-1">
        <Button variant="danger" onClick={onDelete} disabled={deleting}>
          Yes, delete
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={deleting}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The book read last: its cover, where the reader is in it, a way back in, and ⋯. */
function ContinueReading({
  book,
  confirming,
  deleting,
  onAskDelete,
  onDelete,
  onCancelDelete,
  renaming,
  onAskRename,
  onRename,
  onCancelRename,
}: BookActionProps & { book: BookItem }) {
  const percent = book.progress === null ? null : Math.round(Math.min(Math.max(book.progress, 0), 1) * 100);
  return (
    <section aria-labelledby="continue" className="group/book flex flex-wrap items-center gap-5 sm:gap-8">
      <div className="relative w-32 shrink-0 sm:w-[200px] lg:w-[220px]">
        <BookCover book={book} className="shadow-[0_1px_3px_var(--shadow),0_8px_20px_var(--shadow)]" />
        <BookMenu
          title={book.title}
          disabled={confirming || renaming}
          onRename={onAskRename}
          onDelete={onAskDelete}
        />
      </div>
      <div className="flex min-w-0 flex-[1_1_200px] flex-col gap-3">
        {/* The title and the Continue button say what this is; the heading names it for screen readers. */}
        <h2 id="continue" className="sr-only">
          Continue reading
        </h2>
        <p className="font-serif text-[28px] leading-tight break-words sm:text-4xl">{book.title}</p>
        {/* The cover shows the author, so this line is only where the reader is. */}
        {book.chapter && <p className="text-[15px] break-words text-muted">{book.chapter}</p>}
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
        {(renaming || confirming) && (
          <div className="max-w-[360px]">
            {renaming && <RenameForm title={book.title} onSave={onRename} onCancel={onCancelRename} />}
            {confirming && <DeleteConfirm deleting={deleting} onDelete={onDelete} onCancel={onCancelDelete} />}
          </div>
        )}
      </div>
    </section>
  );
}

/** A new title for a book, under its cover: Save keeps it, Cancel or Escape leaves the old one. */
function RenameForm({
  title,
  onSave,
  onCancel,
}: {
  title: string;
  onSave: (title: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  // The form opens from the ⋯ menu, so the field is where the reader expects to type.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const trimmed = value.trim();
  const tooLong = [...trimmed].length > MAX_TITLE_CHARS;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (trimmed === '' || tooLong) return;
    if (trimmed === title) return onCancel();
    setSaving(true);
    const failure = await onSave(trimmed);
    // On success the form is gone; only a failure needs the form back.
    if (failure) {
      setError(failure);
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !saving) onCancel();
      }}
      className="flex flex-col gap-2 rounded-xl bg-chip p-3 text-sm"
    >
      <label htmlFor={inputId} className="font-medium">
        Book title
      </label>
      <input
        id={inputId}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        ref={input}
        disabled={saving}
        aria-invalid={tooLong || undefined}
        className={cn(FIELD, 'w-full min-w-0 px-3')}
      />
      {tooLong && <span className="text-xs text-danger">{`At most ${MAX_TITLE_CHARS} characters.`}</span>}
      {error && <InlineAlert>{error}</InlineAlert>}
      <div className="flex flex-wrap gap-1">
        <Button type="submit" variant="primary" disabled={saving || trimmed === '' || tooLong}>
          Save
        </Button>
        <Button variant="quiet" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * The ⋮ button in a book cover's top-right corner and the actions it opens: Rename and Delete.
 * It sits inside a `group/book`. With a mouse it shows while that book is hovered or has focus,
 * or while its menu is open; a touch screen has no hover, so there it always shows.
 */
function BookMenu({
  title,
  disabled,
  onRename,
  onDelete,
}: {
  title: string;
  disabled: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
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
    <div
      ref={root}
      className={cn(
        'absolute top-0 right-0 z-10 transition-opacity duration-150',
        !open &&
          '[@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-focus-within/book:opacity-100 group-hover/book:opacity-100',
      )}
    >
      <IconButton
        ref={trigger}
        look="floating"
        aria-label={`Options for ${title}`}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreVerticalIcon size={16} />
      </IconButton>
      {open && (
        <div
          id={menuId}
          className="absolute top-full right-1 flex flex-col items-stretch rounded-xl border border-rule bg-surface p-1 shadow-[0_8px_24px_var(--shadow)]"
        >
          <Button
            ref={first}
            variant="quiet"
            aria-label={`Rename ${title}`}
            className="justify-start text-ink"
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            Rename
          </Button>
          <Button
            variant="danger"
            className="justify-start"
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

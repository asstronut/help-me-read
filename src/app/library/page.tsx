'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { SiteNav } from '@/components/SiteNav';
import { Button, buttonClasses } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { IconButton } from '@/components/ui/IconButton';
import { MoreVerticalIcon, RefreshIcon } from '@/components/ui/icons';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { MenuItem } from '@/components/ui/MenuItem';
import { FIELD } from '@/components/ui/field';
import { Popover } from '@/components/ui/Popover';
import type { BookItem } from '@/lib/books/book-item';
import { extractAndSave } from '@/lib/books/extract-and-save';
import { limit } from '@/lib/books/limit';
import { MAX_TITLE_CHARS } from '@/lib/types';
import { BookCover, progressLabel } from './book-cover';
import { AddBookButton, DropOverlay, EmptyShelf, useBookUpload, usePageDrop } from './upload-dropzone';

/**
 * How many books have their text prepared at once. Each one downloads the whole file and parses
 * it in this tab, so a shelf of new books done all together would freeze the page.
 */
const PREPARE_AT_ONCE = 2;

export default function LibraryPage() {
  const [books, setBooks] = useState<BookItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  // The book read last shows on the card and on the shelf: these hold a shelf book's id, or CARD.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const attempted = useRef(new Set<string>());
  const [queue] = useState(() => limit(PREPARE_AT_ONCE));
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
  // are prepared here, once per page visit, PREPARE_AT_ONCE at a time in shelf order.
  useEffect(() => {
    for (const book of books ?? []) {
      if (book.extracted || attempted.current.has(book.id)) continue;
      attempted.current.add(book.id);
      void queue(() => prepare(book));
    }
  }, [books, prepare, queue]);

  function retry(book: BookItem) {
    setFailed((current) => {
      const next = new Set(current);
      next.delete(book.id);
      return next;
    });
    void queue(() => prepare(book));
  }

  const upload = useBookUpload(refresh);
  const dragging = usePageDrop(upload.add);

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
          {/* An empty shelf is itself the place to add a book, so the pill waits for the first one. */}
          {books && books.length > 0 && <AddBookButton upload={upload} />}
        </div>
        {upload.error && <InlineAlert>{upload.error}</InlineAlert>}
        {books?.length === 0 && <EmptyShelf upload={upload} />}
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
      {dragging && <DropOverlay busy={upload.busy} />}
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
function ShelfBook({ book, failed, onRetry, ...actions }: ShelfBookProps) {
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
        <BookMenu title={book.title} {...actions} />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="line-clamp-2 text-sm font-medium break-words">{book.title}</span>
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
    </li>
  );
}

/** The book read last: its cover, where the reader is in it, a way back in, and ⋯. */
function ContinueReading({ book, ...actions }: BookActionProps & { book: BookItem }) {
  const percent = book.progress === null ? null : Math.round(Math.min(Math.max(book.progress, 0), 1) * 100);
  return (
    <section aria-labelledby="continue" className="group/book flex flex-wrap items-center gap-5 sm:gap-8">
      <div className="relative w-32 shrink-0 sm:w-[200px] lg:w-[220px]">
        <BookCover book={book} className="shadow-[0_1px_3px_var(--shadow),0_8px_20px_var(--shadow)]" />
        <BookMenu title={book.title} {...actions} />
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
      </div>
    </section>
  );
}

/** Rename and Delete open as cards this wide, hanging from the ⋮ button. */
const CARD_WIDTH = 'w-60 max-w-[calc(100vw-2rem)]';

/**
 * The ⋮ button in a book cover's top-right corner, and what it opens, each hanging from it over
 * the shelf so no row moves: the menu (Rename, Delete), then the rename form or the delete check.
 * It sits inside a `group/book`. With a mouse it shows while that book is hovered or has focus,
 * or while something it opened is showing; a touch screen has no hover, so there it always shows.
 */
function BookMenu({
  title,
  confirming,
  deleting,
  onAskDelete,
  onDelete,
  onCancelDelete,
  renaming,
  onAskRename,
  onRename,
  onCancelRename,
}: BookActionProps & { title: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const showing = open || confirming || renaming;

  useEffect(() => {
    if (open) first.current?.focus();
  }, [open]);

  /** Closes whatever is open. Focus goes back to ⋮ unless the reader clicked somewhere else. */
  function close(refocus: boolean) {
    setOpen(false);
    if (renaming) onCancelRename();
    if (confirming && !deleting) onCancelDelete();
    if (refocus) trigger.current?.focus();
  }

  return (
    <div
      className={cn(
        'absolute top-0 right-0 transition-opacity duration-150',
        // Above the covers after it in the grid, which come later and would otherwise paint over.
        showing ? 'z-30' : 'z-10',
        !showing &&
          '[@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-focus-within/book:opacity-100 group-hover/book:opacity-100',
      )}
    >
      <IconButton
        ref={trigger}
        look="floating"
        aria-label={`Options for ${title}`}
        aria-expanded={showing}
        aria-controls={showing ? popoverId : undefined}
        onClick={() => (showing ? close(false) : setOpen(true))}
      >
        <MoreVerticalIcon size={16} />
      </IconButton>
      {open && (
        <Popover
          id={popoverId}
          onClose={(reason) => close(reason === 'escape')}
          // As wide as its longest action, but never a sliver: 128px at least.
          className="flex w-max min-w-32 flex-col p-1.5"
        >
          <MenuItem
            ref={first}
            aria-label={`Rename ${title}`}
            onClick={() => {
              setOpen(false);
              onAskRename();
            }}
          >
            Rename
          </MenuItem>
          <MenuItem
            tone="danger"
            aria-label={`Delete ${title}`}
            onClick={() => {
              setOpen(false);
              onAskDelete();
            }}
          >
            Delete
          </MenuItem>
        </Popover>
      )}
      {renaming && (
        <RenameForm
          id={popoverId}
          title={title}
          onSave={async (next) => {
            const failure = await onRename(next);
            if (!failure) trigger.current?.focus();
            return failure;
          }}
          onClose={close}
        />
      )}
      {confirming && (
        <DeleteConfirm id={popoverId} title={title} deleting={deleting} onDelete={onDelete} onClose={close} />
      )}
    </div>
  );
}

/** Asks before a book goes, naming it, since its highlights, threads and notes go with it. */
function DeleteConfirm({
  id,
  title,
  deleting,
  onDelete,
  onClose,
}: {
  id: string;
  title: string;
  deleting: boolean;
  onDelete: () => void;
  /** `refocus`: put focus back on ⋮. */
  onClose: (refocus: boolean) => void;
}) {
  const headingId = useId();
  const bodyId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  // The safe choice has focus, so a stray Enter keeps the book.
  useEffect(() => cancel.current?.focus(), []);
  return (
    <Popover
      id={id}
      role="alertdialog"
      fit
      aria-labelledby={headingId}
      aria-describedby={bodyId}
      onClose={(reason) => !deleting && onClose(reason === 'escape')}
      className={cn(CARD_WIDTH, 'flex flex-col gap-1 px-4 pt-3.5 pb-2.5')}
    >
      <p id={headingId} data-fit className="line-clamp-3 font-serif text-base leading-snug break-words">
        {`Delete “${title}”?`}
      </p>
      <p id={bodyId} data-fit className="text-[13px] leading-normal text-muted">
        Its highlights, threads and notes go too. This can&apos;t be undone.
      </p>
      <div className="mt-1.5 flex justify-end gap-2">
        <Button ref={cancel} size="compact" onClick={() => onClose(true)} disabled={deleting}>
          Cancel
        </Button>
        <Button size="compact" variant="danger" onClick={onDelete} disabled={deleting}>
          {deleting ? 'Deleting…' : 'Delete'}
        </Button>
      </div>
    </Popover>
  );
}

/** Below this many characters left, the rename field shows how many remain. */
const COUNT_FROM = 40;

/**
 * A new title for a book, in a card under its ⋮ button. The field grows to show a long title
 * whole, in the serif the covers use. Enter or Save keeps it; Cancel, Escape, or a click away
 * (before anything is typed) leaves the old one.
 */
function RenameForm({
  id,
  title,
  onSave,
  onClose,
}: {
  id: string;
  title: string;
  onSave: (title: string) => Promise<string | null>;
  /** `refocus`: put focus back on ⋮. */
  onClose: (refocus: boolean) => void;
}) {
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const countId = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  // The form opens from the ⋯ menu, so the field is where the reader expects to type.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const trimmed = value.trim();
  const length = [...trimmed].length;
  const tooLong = length > MAX_TITLE_CHARS;
  const left = MAX_TITLE_CHARS - length;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (trimmed === '' || tooLong || saving) return;
    if (trimmed === title) return onClose(true);
    setSaving(true);
    const failure = await onSave(trimmed);
    // On success the form is gone; only a failure needs the form back.
    if (failure) {
      setError(failure);
      setSaving(false);
    }
  }

  return (
    <Popover
      id={id}
      role="dialog"
      aria-label="Rename book"
      onClose={(reason) => {
        if (saving) return;
        // A click away keeps what was typed; only Escape or Cancel throws it out.
        if (reason === 'outside' && trimmed !== title) return;
        onClose(reason === 'escape');
      }}
      className={CARD_WIDTH}
    >
      <form ref={form} onSubmit={submit} className="flex flex-col gap-2 px-4 pt-3.5 pb-2.5">
        <label htmlFor={inputId} className="text-[13px] font-medium text-muted">
          Book title
        </label>
        <textarea
          id={inputId}
          ref={input}
          value={value}
          rows={2}
          // A title is one line of text; a pasted line break becomes a space.
          onChange={(e) => setValue(e.target.value.replace(/\s*[\r\n]+\s*/g, ' '))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              form.current?.requestSubmit();
            }
          }}
          disabled={saving}
          aria-invalid={tooLong || undefined}
          aria-describedby={left < COUNT_FROM ? countId : undefined}
          className={cn(
            FIELD,
            'h-auto max-h-44 min-h-11 w-full min-w-0 resize-none px-3 py-2.5 font-serif text-base leading-snug field-sizing-content',
            tooLong && 'border-danger',
          )}
        />
        {left < COUNT_FROM && (
          <span id={countId} className={cn('text-xs tabular-nums', tooLong ? 'text-danger' : 'text-muted')}>
            {tooLong ? `${-left} over the ${MAX_TITLE_CHARS}-character limit` : `${left} characters left`}
          </span>
        )}
        {error && <InlineAlert>{error}</InlineAlert>}
        <div className="mt-0.5 flex justify-end gap-2">
          <Button size="compact" onClick={() => onClose(true)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="compact" variant="primary" disabled={saving || trimmed === '' || tooLong}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Popover>
  );
}

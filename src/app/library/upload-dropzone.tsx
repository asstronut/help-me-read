'use client';

import { useEffect, useRef, useState } from 'react';
import { buttonClasses } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { PlusIcon } from '@/components/ui/icons';
import { readMetadata } from '@/lib/books/metadata';
import { UPLOAD_REASONS, sniffFormat, validateUpload } from '@/lib/books/validate-upload';

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
} as const;

/** Returns null once the book is added, or the reason it could not be. */
async function uploadBook(file: File): Promise<string | null> {
  const check = validateUpload(file);
  if (!check.ok) return check.reason;
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (sniffFormat(head) !== check.format) return UPLOAD_REASONS.notReal;

  const meta = await readMetadata(file, check.format);
  const created = await fetch('/api/books', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...meta,
      format: check.format,
      sizeBytes: file.size,
    }),
  });
  if (!created.ok) return 'Could not add this book. Please try again.';
  const { bookId, signedUploadUrl } = (await created.json()) as {
    bookId: string;
    signedUploadUrl: string;
  };

  let uploaded = false;
  try {
    const put = await fetch(signedUploadUrl, {
      method: 'PUT',
      headers: { 'content-type': CONTENT_TYPES[check.format] },
      body: file,
    });
    uploaded = put.ok;
  } catch {
    // a dropped connection is handled like any other failed upload
  }
  if (!uploaded) {
    await fetch(`/api/books/${bookId}`, { method: 'DELETE' }).catch(() => undefined);
    return 'The upload failed. Please try again.';
  }
  return null;
}

export type BookUpload = {
  /** A book is being uploaded. */
  busy: boolean;
  /** Why the last file could not be added, or null. */
  error: string | null;
  /** Adds one file to the library. Ignored while another upload is running. */
  add: (file: File | undefined) => void;
};

/** One upload at a time, whether the file came from the picker or was dropped on the page. */
export function useBookUpload(onUploaded: () => void): BookUpload {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);

  async function handle(file: File) {
    working.current = true;
    setError(null);
    setBusy(true);
    try {
      const problem = await uploadBook(file);
      if (problem) {
        setError(problem);
      } else {
        onUploaded(); // the library then prepares the book's text
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    add: (file) => {
      if (file && !working.current) void handle(file);
    },
  };
}

/** The hidden file input inside each Add control; the label around it opens it. */
function FileInput({ upload }: { upload: BookUpload }) {
  return (
    <input
      type="file"
      accept=".pdf,.epub,application/pdf,application/epub+zip"
      aria-label="Choose a book"
      disabled={upload.busy}
      className="sr-only"
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // so choosing the same file again still counts
        upload.add(file);
      }}
    />
  );
}

/** The "Add a book" pill beside the shelf heading, once the shelf has books. */
export function AddBookButton({ upload }: { upload: BookUpload }) {
  return (
    <label
      className={cn(
        'inline-flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 rounded-full border border-rule px-4 py-2 text-[13px] text-ink transition-colors hover:bg-chip',
        'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
      )}
    >
      <PlusIcon size={14} />
      <span className="font-medium">{upload.busy ? 'Uploading…' : 'Add a book'}</span>
      <span className="text-muted">PDF or EPUB, up to 50 MB</span>
      <FileInput upload={upload} />
    </label>
  );
}

/**
 * An empty place on the shelf, shaped like a book: a dashed 2:3 outline with a spine line, the
 * same shape and corners as a cover. The empty shelf and the drop overlay both show one, so
 * both say "a book goes here".
 */
function BookSlot({ active, className }: { active?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative flex aspect-[2/3] shrink-0 items-center justify-center rounded-[3px_6px_6px_3px] border-[1.5px] border-dashed transition-colors',
        'after:absolute after:inset-y-0 after:left-2 after:border-l-[1.5px] after:border-dashed after:border-inherit',
        active ? 'border-accent bg-accent-tint text-accent' : 'border-rule text-muted',
        className,
      )}
    >
      <PlusIcon size={22} />
    </span>
  );
}

/** The shelf with no books yet: the whole box opens the file picker. */
export function EmptyShelf({ upload }: { upload: BookUpload }) {
  return (
    <label
      className={cn(
        'group/empty flex cursor-pointer flex-col items-center gap-6 rounded-2xl border border-dashed border-rule px-5 py-8 text-center transition-colors hover:bg-chip/60',
        'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
        'sm:flex-row sm:gap-8 sm:px-8 sm:text-left',
      )}
    >
      <BookSlot className="w-24 group-hover/empty:border-muted group-hover/empty:text-ink sm:w-[120px]" />
      <span className="flex flex-col items-center gap-2 sm:items-start">
        <span className="font-serif text-[22px] leading-tight">No books yet</span>
        <span className="max-w-[46ch] text-sm leading-relaxed text-muted">
          Drop a PDF or EPUB anywhere on this page, or choose one from your device. Up to 50 MB.
        </span>
        {/* Looks like a button; the label around it is what opens the picker. */}
        <span className={buttonClasses('primary', 'mt-2')}>{upload.busy ? 'Uploading…' : 'Choose a book'}</span>
      </span>
      <FileInput upload={upload} />
    </label>
  );
}

/**
 * Lets a book be dropped anywhere on the page, and says whether a file is being dragged over the
 * window (for the overlay). Every file drag is caught, even during an upload, so a stray drop
 * never makes the browser leave the library to open the file itself.
 */
export function usePageDrop(onFile: (file: File | undefined) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const drop = useRef(onFile);
  useEffect(() => {
    drop.current = onFile;
  });

  useEffect(() => {
    // dragenter and dragleave fire for each element the pointer crosses; counting them tells
    // when the drag has left the window, not just one element.
    let depth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      drop.current(e.dataTransfer?.files[0]);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return dragging;
}

/** Covers the page while a file is dragged over it: the whole window is the place to drop. */
export function DropOverlay({ busy }: { busy: boolean }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 bg-bg/90 p-3 transition-opacity duration-150 starting:opacity-0 sm:p-5"
    >
      <div className="flex h-full flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed border-accent px-6 text-center">
        <BookSlot active className="w-24" />
        <p className="font-serif text-[26px] leading-tight sm:text-[32px]">
          {busy ? 'Another book is uploading' : 'Drop to add it to your books'}
        </p>
        <p className="text-sm text-muted">
          {busy ? 'Drop this one once that upload has finished.' : 'PDF or EPUB, up to 50 MB'}
        </p>
      </div>
    </div>
  );
}

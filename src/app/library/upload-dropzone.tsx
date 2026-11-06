'use client';

import { useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { PlusIcon } from '@/components/ui/icons';
import { InlineAlert } from '@/components/ui/InlineAlert';
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

export function UploadDropzone({ onUploaded }: { onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [dragging, setDragging] = useState(false);

  async function handle(file: File | undefined) {
    if (!file || working.current) return;
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
      if (input.current) input.current.value = '';
    }
  }

  return (
    // `contents`: the button and its error join the shelf heading's row, the error on a line of its own.
    <div className="contents">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handle(e.dataTransfer.files[0]);
        }}
        className={cn(
          'relative inline-flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 rounded-full border border-dashed px-4 py-2 text-[13px] text-ink transition-colors',
          'focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
          dragging ? 'border-accent bg-accent-tint' : 'border-rule hover:bg-chip',
        )}
      >
        <PlusIcon size={14} />
        <span className="font-medium">{busy ? 'Uploading…' : 'Add a book'}</span>
        <span className="text-muted">PDF or EPUB, up to 50 MB</span>
        <input
          ref={input}
          type="file"
          accept=".pdf,.epub,application/pdf,application/epub+zip"
          aria-label="Choose a book"
          disabled={busy}
          className="sr-only"
          onChange={(e) => void handle(e.target.files?.[0])}
        />
      </label>
      {error && <InlineAlert className="w-full">{error}</InlineAlert>}
    </div>
  );
}

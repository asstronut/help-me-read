'use client';

import { useRef, useState } from 'react';
import { readMetadata } from '@/lib/books/metadata';
import { UPLOAD_REASONS, sniffFormat, validateUpload } from '@/lib/books/validate-upload';

const CONTENT_TYPES = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
} as const;

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

  const put = await fetch(signedUploadUrl, {
    method: 'PUT',
    headers: { 'content-type': CONTENT_TYPES[check.format] },
    body: file,
  });
  if (!put.ok) {
    await fetch(`/api/books/${bookId}`, { method: 'DELETE' });
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
      if (problem) setError(problem);
      else onUploaded();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      working.current = false;
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div>
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
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed p-6 text-center ${
          dragging ? 'border-blue-500 bg-blue-500/10' : 'border-gray-400'
        }`}
      >
        <span className="font-medium">{busy ? 'Uploading…' : 'Add a book'}</span>
        <span className="text-sm opacity-70">Drop a PDF or EPUB here, or tap to choose one</span>
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
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookItem } from '@/lib/books/book-item';
import { extractAndSave } from '@/lib/books/extract-and-save';
import { UploadDropzone } from './upload-dropzone';

export default function LibraryPage() {
  const [books, setBooks] = useState<BookItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());
  const attempted = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/books');
      if (!res.ok) throw new Error(String(res.status));
      setBooks(((await res.json()) as { books: BookItem[] }).books);
      setError(null);
    } catch {
      setError('Could not load your library. Please refresh to try again.');
    }
  }, []);

  // Refreshes the list after an upload or extraction without touching an error already shown.
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/books');
      if (res.ok) setBooks(((await res.json()) as { books: BookItem[] }).books);
    } catch {
      // the next refresh will try again
    }
  }, []);

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
    try {
      const res = await fetch(`/api/books/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      setBooks((current) => current?.filter((b) => b.id !== id) ?? null);
      setError(null);
    } catch {
      setError('Could not delete this book. Please try again.');
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">Library</h1>
      <UploadDropzone onUploaded={refresh} />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {books?.length === 0 && <p className="opacity-70">No books yet. Add your first one above.</p>}
      {books && books.length > 0 && (
        <ul className="divide-y divide-gray-300/50">
          {books.map((book) => (
            <li key={book.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/read/${book.id}`} className="break-words font-medium hover:underline">{book.title}</Link>
                {book.author && <p className="break-words text-sm opacity-70">{book.author}</p>}
              </div>
              {!book.extracted &&
                (failed.has(book.id) ? (
                  <>
                    <span className="text-xs text-red-600">Couldn&apos;t prepare text</span>
                    <button
                      type="button"
                      onClick={() => retry(book)}
                      className="rounded px-2 py-1 text-sm hover:bg-gray-500/10"
                    >
                      Retry
                    </button>
                  </>
                ) : (
                  <span className="text-xs opacity-60">Preparing text…</span>
                ))}
              <span className="text-xs uppercase opacity-60">{book.format}</span>
              <button
                type="button"
                aria-label={`Delete ${book.title}`}
                onClick={() => void remove(book.id)}
                className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-500/10"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

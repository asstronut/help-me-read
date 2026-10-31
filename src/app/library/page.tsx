'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BookItem } from '@/lib/books/book-item';
import { UploadDropzone } from './upload-dropzone';

export default function LibraryPage() {
  const [books, setBooks] = useState<BookItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      <UploadDropzone onUploaded={load} />
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
                <p className="break-words font-medium">{book.title}</p>
                {book.author && <p className="break-words text-sm opacity-70">{book.author}</p>}
              </div>
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

'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { BookFormat, ReadingLocation } from '@/lib/types';

// pdf.js needs the browser, so the reader is never rendered on the server.
const PdfReader = dynamic(() => import('./PdfReader'), { ssr: false });
const EpubReader = dynamic(() => import('./EpubReader'), { ssr: false });

type Loaded = { format: BookFormat; fileUrl: string; location: ReadingLocation | null };

async function load(bookId: string): Promise<Loaded> {
  const [book, position] = await Promise.all([
    fetch(`/api/books/${bookId}`),
    fetch(`/api/books/${bookId}/position`),
  ]);
  if (!book.ok || !position.ok) throw new Error('load failed');
  const { format, fileUrl } = (await book.json()) as { format: BookFormat; fileUrl: string };
  const { location } = (await position.json()) as { location: ReadingLocation | null };
  return { format, fileUrl, location };
}

export function ReadView({ bookId }: { bookId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    load(bookId).then(setLoaded, () => setFailed(true));
  }, [bookId]);

  if (failed) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        Could not open this book.
      </p>
    );
  }
  if (!loaded) return <p className="p-4 text-sm opacity-70">Loading…</p>;

  if (loaded.format === 'epub') {
    return (
      <EpubReader
        bookId={bookId}
        fileUrl={loaded.fileUrl}
        initialCfi={loaded.location && 'cfi' in loaded.location ? loaded.location.cfi : null}
        onSelection={() => undefined}
        highlights={[]}
      />
    );
  }
  const initialPage = loaded.location && 'page' in loaded.location ? loaded.location.page : 1;
  return (
    <PdfReader
      bookId={bookId}
      fileUrl={loaded.fileUrl}
      initialPage={initialPage}
      onSelection={() => undefined}
      highlights={[]}
    />
  );
}

'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import type { BookFormat, ReaderSelection, ReadingLocation } from '@/lib/types';
import { SelectionMenu, type SelectionBox } from './SelectionMenu';

// pdf.js needs the browser, so the reader is never rendered on the server.
const PdfReader = dynamic(() => import('./PdfReader'), { ssr: false });
const EpubReader = dynamic(() => import('./EpubReader'), { ssr: false });

type Current = { selection: ReaderSelection; box: SelectionBox };

declare global {
  interface Window {
    __hmrSelection?: ReaderSelection | null;
  }
}

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
  const [current, setCurrent] = useState<Current | null>(null);

  useEffect(() => {
    load(bookId).then(setLoaded, () => setFailed(true));
  }, [bookId]);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E === '1') window.__hmrSelection = current?.selection ?? null;
  }, [current]);

  const onSelection = (selection: ReaderSelection | null, box?: SelectionBox) =>
    setCurrent(selection && box ? { selection, box } : null);

  if (failed) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        Could not open this book.
      </p>
    );
  }
  if (!loaded) return <p className="p-4 text-sm opacity-70">Loading…</p>;

  const menu = current && (
    <SelectionMenu
      selection={current.selection}
      box={current.box}
      onPick={() => setCurrent(null)}
      onColor={() => undefined}
    />
  );
  if (loaded.format === 'epub') {
    return (
      <>
        <EpubReader
          bookId={bookId}
          fileUrl={loaded.fileUrl}
          initialCfi={loaded.location && 'cfi' in loaded.location ? loaded.location.cfi : null}
          onSelection={onSelection}
          highlights={[]}
        />
        {menu}
      </>
    );
  }
  const initialPage = loaded.location && 'page' in loaded.location ? loaded.location.page : 1;
  return (
    <>
      <PdfReader
        bookId={bookId}
        fileUrl={loaded.fileUrl}
        initialPage={initialPage}
        onSelection={onSelection}
        highlights={[]}
      />
      {menu}
    </>
  );
}

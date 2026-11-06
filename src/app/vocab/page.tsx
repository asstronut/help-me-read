'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SiteNav } from '@/components/SiteNav';
import { Button, buttonClasses } from '@/components/ui/Button';
import { DownloadIcon, SearchIcon } from '@/components/ui/icons';
import { InlineAlert } from '@/components/ui/InlineAlert';
import type { VocabEntryView } from '@/lib/vocab/service.server';

const jumpHref = (entry: VocabEntryView) =>
  entry.bookId && entry.anchor
    ? `/read/${entry.bookId}?at=${encodeURIComponent(JSON.stringify(entry.anchor))}`
    : null;

export default function VocabPage() {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<VocabEntryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/vocab?q=${encodeURIComponent(query)}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        setEntries(((await res.json()) as { entries: VocabEntryView[] }).entries);
        setError(null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load your vocab. Please refresh.');
      });
    return () => controller.abort();
  }, [query]);

  async function remove(id: string) {
    try {
      const res = await fetch(`/api/vocab/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(String(res.status));
      setEntries((current) => current?.filter((e) => e.id !== id) ?? null);
      setError(null);
    } catch {
      setError('Could not delete this word. Please try again.');
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-10 px-4 pt-5 pb-16 sm:px-6 sm:pt-7">
      <SiteNav current="Vocab" />
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h1 className="font-serif text-[28px]">Vocab</h1>
          <div className="flex flex-wrap">
            <a href="/api/vocab/export?format=csv" download className={buttonClasses('quiet')}>
              <DownloadIcon size={16} />
              Export CSV
            </a>
            <a href="/api/vocab/export?format=anki" download className={buttonClasses('quiet')}>
              <DownloadIcon size={16} />
              Export Anki
            </a>
          </div>
        </div>
        <label className="flex h-11 items-center gap-2.5 rounded-xl bg-chip px-3.5 text-muted focus-within:outline-2 focus-within:outline-accent">
          <SearchIcon size={16} />
          <input
            type="search"
            aria-label="Search vocab"
            placeholder="Search words and meanings"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
          />
        </label>
        {error && <InlineAlert>{error}</InlineAlert>}
        {entries?.length === 0 &&
          (query ? (
            <p className="py-4 text-sm text-muted">No matching words.</p>
          ) : (
            <div className="flex flex-col gap-1 rounded-xl border border-dashed border-rule p-5">
              <p className="font-serif text-[17px]">No words yet</p>
              <p className="text-sm text-muted">Select a word while reading and choose Vocab.</p>
            </div>
          ))}
        {entries && entries.length > 0 && (
          <ul>
            {entries.map((entry) => (
              <VocabRow key={entry.id} entry={entry} onDelete={() => void remove(entry.id)} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

// A link in the accent colour, 44px tall like a button.
const OPEN_LINK =
  'inline-flex h-11 items-center rounded-[10px] px-3.5 text-sm text-accent hover:bg-chip focus-visible:outline-2 focus-visible:outline-accent';

/** One saved word: the word, its meaning, the sentence it came from and its book. */
function VocabRow({ entry, onDelete }: { entry: VocabEntryView; onDelete: () => void }) {
  const href = jumpHref(entry);
  return (
    <li className="flex flex-col gap-1.5 border-b border-rule py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <span className="min-w-0 font-serif text-[21px] break-words">{entry.term}</span>
        <div className="-mr-3.5 flex">
          {href ? (
            <Link href={href} className={OPEN_LINK}>
              Open in book
            </Link>
          ) : (
            <Button variant="quiet" disabled>
              Open in book
            </Button>
          )}
          <Button variant="danger" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
      <p className={entry.meaning ? 'text-sm leading-normal' : 'text-sm text-muted italic'}>
        {entry.meaning ?? 'No meaning yet'}
      </p>
      {entry.sentence && (
        <p className="font-serif text-sm leading-normal break-words text-muted italic">“{entry.sentence}”</p>
      )}
      <span className="text-[11px] tracking-[0.06em] text-muted uppercase">{entry.bookTitle ?? 'Book deleted'}</span>
    </li>
  );
}

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
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
    <main className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-xl font-semibold">Vocab</h1>
        <Link href="/library" className="text-sm hover:underline">
          Library
        </Link>
        <a href="/api/vocab/export?format=csv" download className="text-sm hover:underline">
          Export CSV
        </a>
        <a href="/api/vocab/export?format=anki" download className="text-sm hover:underline">
          Export Anki
        </a>
      </div>
      <input
        type="search"
        aria-label="Search vocab"
        placeholder="Search words and meanings"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded border border-gray-400/60 bg-transparent px-3 py-2"
      />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {entries?.length === 0 && (
        <p className="opacity-70">{query ? 'No matching words.' : 'No words yet. Use +Vocab while reading.'}</p>
      )}
      {entries && entries.length > 0 && (
        <ul className="divide-y divide-gray-300/50">
          {entries.map((entry) => {
            const href = jumpHref(entry);
            return (
              <li key={entry.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1 space-y-1 break-words">
                  <p className="font-medium">{entry.term}</p>
                  <p className={entry.meaning ? 'text-sm' : 'text-sm italic opacity-60'}>
                    {entry.meaning ?? 'No meaning yet'}
                  </p>
                  {entry.sentence && <p className="text-sm italic opacity-80">{entry.sentence}</p>}
                  <p className="text-xs opacity-60">{entry.bookTitle ?? 'Book deleted'}</p>
                </div>
                {href ? (
                  <Link href={href} className="rounded px-2 py-1 text-sm hover:bg-gray-500/10">
                    Jump
                  </Link>
                ) : (
                  <button type="button" disabled className="rounded px-2 py-1 text-sm opacity-40">
                    Jump
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void remove(entry.id)}
                  className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-500/10"
                >
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

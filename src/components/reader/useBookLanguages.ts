'use client';

import { useRef, useState } from 'react';
import { bookLanguages, type BookLanguages, type LanguageOverrides, type Languages } from '@/lib/languages';

const OVERRIDE_KEYS = {
  translation: 'translationLanguageOverride',
  answer: 'answerLanguageOverride',
} as const;

async function saveOverride(bookId: string, field: keyof Languages, language: string | null): Promise<void> {
  const res = await fetch(`/api/books/${bookId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ [OVERRIDE_KEYS[field]]: language }),
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  throw new Error(body.message ?? 'Could not save the language. Please try again.');
}

const withOverride = (current: BookLanguages | null, field: keyof Languages, language: string | null) =>
  current && bookLanguages(current.defaults, { ...current.overrides, [field]: language });

/**
 * The book's languages, with the reader's changes to its overrides. A change shows at once and is
 * saved to the book; if the save fails the field goes back to its last saved language and says
 * why. Saves run one after another, so a quick second choice can't be overtaken by the first.
 * `initial` is null when the languages could not be read.
 */
export function useBookLanguages(bookId: string, initial: BookLanguages | null) {
  const [languages, setLanguages] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const queue = useRef(Promise.resolve());
  const saved = useRef<LanguageOverrides | null>(initial?.overrides ?? null);
  const latest = useRef({ translation: 0, answer: 0 });

  function choose(field: keyof Languages, language: string | null) {
    setLanguages((current) => withOverride(current, field, language));
    setError(null);
    const n = ++latest.current[field];
    queue.current = queue.current
      .then(() => saveOverride(bookId, field, language))
      .then(
        () => {
          if (saved.current) saved.current = { ...saved.current, [field]: language };
        },
        (e: Error) => {
          if (n !== latest.current[field]) return;
          setLanguages((current) => withOverride(current, field, saved.current?.[field] ?? null));
          setError(e.message);
        },
      );
  }

  return { languages, choose, error };
}

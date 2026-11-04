'use client';

import { useState, type FormEvent } from 'react';
import { HIGHLIGHT_COLORS, type HighlightColor, type HighlightView } from '@/lib/types';
import { HIGHLIGHT_FILLS } from './highlight-colors';

type Props = {
  highlight: HighlightView;
  onSaved: (highlight: HighlightView) => void;
  onDeleted: (id: string) => void;
  onClose: () => void;
};

const NAMES: Record<HighlightColor, string> = {
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  pink: 'Pink',
};

/** A note highlight's colour and typed note, saved on Save; Delete removes the highlight. */
export function NoteEditor({ highlight, onSaved, onDeleted, onClose }: Props) {
  const [color, setColor] = useState(highlight.color);
  const [note, setNote] = useState(highlight.note ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function request(init: RequestInit): Promise<Response | null> {
    setBusy(true);
    setProblem(null);
    try {
      const res = await fetch(`/api/highlights/${highlight.id}`, init);
      if (res.ok) return res;
    } catch {}
    setProblem('Could not save. Try again.');
    setBusy(false);
    return null;
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const res = await request({
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ color, note }),
    });
    if (res) onSaved((await res.json()) as HighlightView);
  }

  async function remove() {
    if (await request({ method: 'DELETE' })) onDeleted(highlight.id);
  }

  return (
    <form
      role="dialog"
      aria-label="Note"
      onSubmit={save}
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 border-t border-foreground/10 bg-background p-3 text-sm text-foreground shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-80 sm:rounded-lg sm:border"
    >
      <div role="group" aria-label="Colour" className="flex gap-2">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={NAMES[c]}
            aria-pressed={c === color}
            onClick={() => setColor(c)}
            style={{ backgroundColor: HIGHLIGHT_FILLS[c] }}
            className="size-6 rounded-full border border-foreground/20 aria-pressed:ring-2 aria-pressed:ring-foreground"
          />
        ))}
      </div>
      <textarea
        aria-label="Note text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        className="rounded border border-foreground/20 p-2"
      />
      {problem && (
        <p role="alert" className="text-red-600">
          {problem}
        </p>
      )}
      <div className="flex justify-between gap-2">
        <button type="button" onClick={remove} disabled={busy} className="rounded px-2 py-1 text-red-600 hover:bg-foreground/5">
          Delete
        </button>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="rounded px-2 py-1 hover:bg-foreground/5">
            Close
          </button>
          <button type="submit" disabled={busy} className="rounded bg-foreground px-3 py-1 text-background">
            Save
          </button>
        </div>
      </div>
    </form>
  );
}

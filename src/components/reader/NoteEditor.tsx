'use client';

import { useState, type FormEvent } from 'react';
import { HIGHLIGHT_COLORS, type HighlightColor, type HighlightView } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { cn } from '@/components/ui/cn';
import { HIGHLIGHT_HEX } from './highlight-colors';

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
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col gap-3 rounded-t-2xl border-t border-rule bg-surface px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] font-sans text-sm text-ink shadow-[0_-8px_24px_var(--shadow)] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-80 sm:rounded-2xl sm:border sm:pb-3 sm:shadow-[0_8px_24px_var(--shadow)]"
    >
      <div className="flex items-center justify-between">
        <span aria-hidden="true" className="text-[11px] tracking-[0.1em] text-muted uppercase">
          Note
        </span>
        <div role="group" aria-label="Colour" className="-mr-2 flex">
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={NAMES[c]}
              aria-pressed={c === color}
              onClick={() => setColor(c)}
              className="group flex size-11 cursor-pointer items-center justify-center rounded-lg hover:bg-chip focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
            >
              <span
                aria-hidden="true"
                style={{ backgroundColor: HIGHLIGHT_HEX[c] }}
                className={cn(
                  'size-5 rounded-full',
                  // The chosen colour gets a ring in the ink colour, with a gap of the card's colour.
                  'group-aria-pressed:ring-2 group-aria-pressed:ring-ink group-aria-pressed:ring-offset-2 group-aria-pressed:ring-offset-surface',
                )}
              />
            </button>
          ))}
        </div>
      </div>
      <textarea
        aria-label="Note text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        placeholder="Add a note"
        className="resize-y rounded-xl border border-rule bg-bg px-3 py-2.5 text-sm leading-normal text-ink placeholder:text-muted focus-visible:outline-2 focus-visible:outline-accent"
      />
      {problem && <InlineAlert>{problem}</InlineAlert>}
      <div className="flex items-center justify-between gap-2">
        <Button variant="danger" onClick={remove} disabled={busy} className="-ml-3.5">
          Delete
        </Button>
        <div className="flex items-center gap-1">
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

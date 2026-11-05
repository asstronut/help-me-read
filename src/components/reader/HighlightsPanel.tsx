'use client';

import { compare as compareCfi } from 'foliate-js/epubcfi.js';
import { useId, useState, type MouseEvent } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { Tabs, tabId, tabPanelId } from '@/components/ui/Tabs';
import { CloseIcon } from '@/components/ui/icons';
import type { Action, HighlightView } from '@/lib/types';
import { HIGHLIGHT_HEX, HIGHLIGHT_INKS } from './highlight-colors';

type Filter = 'all' | 'notes' | 'threads';
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'notes', label: 'Notes' },
  { value: 'threads', label: 'Threads' },
] as const;
const EMPTY: Record<Filter, string> = {
  all: 'Nothing here yet. Select some text to highlight it or ask about it.',
  notes: 'No notes yet.',
  threads: 'No threads yet.',
};
const ACTION_NAMES: Record<Action, string> = {
  translate: 'Translate',
  define: 'Define',
  explain: 'Explain',
  simplify: 'Simplify',
  ask: 'Ask',
};

type Props = {
  highlights: HighlightView[];
  /** The chapter a highlight is in, when the reader knows better than its segment label (a PDF's bookmarks). */
  chapterOf: (highlight: HighlightView) => string | null;
  /** The link to a highlight (`?at=`, plus `?thread=` for a thread), for opening it in a new tab. */
  hrefOf: (highlight: HighlightView) => string;
  /** Goes to the highlight (and opens its thread). */
  onJump: (highlight: HighlightView) => void;
  onClose: () => void;
};

/** Book order: by page and then top to bottom on a PDF; by CFI in an EPUB. */
function byPlace(a: HighlightView, b: HighlightView): number {
  if (a.anchor.format === 'pdf' && b.anchor.format === 'pdf') {
    const ra = a.anchor.rects[0];
    const rb = b.anchor.rects[0];
    return a.anchor.page - b.anchor.page || (ra?.y ?? 0) - (rb?.y ?? 0) || (ra?.x ?? 0) - (rb?.x ?? 0);
  }
  if (a.anchor.format === 'epub' && b.anchor.format === 'epub') {
    try {
      return compareCfi(a.anchor.cfi, b.anchor.cfi);
    } catch {
      return 0;
    }
  }
  return 0;
}

/** The highlights in book order, grouped by chapter (in the order the chapters come). */
function groupByChapter(highlights: HighlightView[], chapterOf: Props['chapterOf']) {
  const groups = new Map<string, HighlightView[]>();
  for (const h of [...highlights].sort(byPlace)) {
    const chapter = chapterOf(h) ?? h.segmentLabel ?? 'Other';
    const group = groups.get(chapter);
    if (group) group.push(h);
    else groups.set(chapter, [h]);
  }
  return [...groups];
}

function meta(h: HighlightView): string {
  if (h.kind === 'thread') return h.threadAction ? `Thread · ${ACTION_NAMES[h.threadAction]}` : 'Thread';
  return h.note ? `Note · ${h.note}` : 'Highlight';
}

/** "In this book": the book's highlights, notes and threads; a click goes to one. */
export function HighlightsPanel({ highlights, chapterOf, hrefOf, onJump, onClose }: Props) {
  const [filter, setFilter] = useState<Filter>('all');
  const id = useId();
  const headingId = `${id}-heading`;
  const shown = highlights.filter(
    (h) => filter === 'all' || (filter === 'notes' ? h.kind === 'note' : h.kind === 'thread'),
  );
  const groups = groupByChapter(shown, chapterOf);

  function onClick(e: MouseEvent, h: HighlightView) {
    // A click with a modifier (a new tab or window) keeps its usual meaning.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onJump(h);
  }

  return (
    <aside
      aria-labelledby={headingId}
      className="fixed inset-x-0 bottom-0 z-40 flex h-[70dvh] flex-col rounded-t-2xl border-t border-rule bg-panel font-sans text-ink shadow-[0_-8px_24px_var(--shadow)] md:inset-x-auto md:top-0 md:right-0 md:h-dvh md:w-[420px] md:rounded-none md:border-t-0 md:border-l md:shadow-none"
    >
      <header className="flex flex-col gap-3 pt-2 pr-2 pb-3 pl-5 md:pt-4 md:pr-4">
        <div className="flex items-center justify-between">
          <h2 id={headingId} className="font-serif text-xl font-normal">
            In this book
          </h2>
          <IconButton aria-label="Close panel" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        <Tabs
          label="Filter"
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          idPrefix={id}
          className="mr-2 md:mr-0"
        />
      </header>
      <div
        id={tabPanelId(id)}
        role="tabpanel"
        aria-labelledby={tabId(id, filter)}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-1 pb-5"
      >
        <p className="pt-2 text-xs text-muted">
          {shown.length} {shown.length === 1 ? 'item' : 'items'}
        </p>
        {shown.length === 0 && <p className="pt-4 text-sm text-muted">{EMPTY[filter]}</p>}
        {groups.map(([chapter, items]) => (
          <div key={chapter} className="flex flex-col">
            <h3 className="mt-4 mb-1 text-[11px] font-medium tracking-[0.1em] text-muted uppercase">
              {chapter}
            </h3>
            <ul>
              {items.map((h) => (
                <li key={h.id} className="border-b border-rule">
                  <a
                    href={hrefOf(h)}
                    onClick={(e) => onClick(e, h)}
                    className="flex gap-3 rounded-lg py-3 transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-[7px] size-2.5 shrink-0 rounded-full"
                      style={{
                        background: h.kind === 'thread' ? HIGHLIGHT_INKS[h.color] : HIGHLIGHT_HEX[h.color],
                      }}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="line-clamp-3 font-serif text-[15px] leading-normal break-words text-ink">
                        “{h.quote}”
                      </span>
                      <span className="line-clamp-2 text-[13px] leading-snug break-words text-muted">
                        {meta(h)}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </aside>
  );
}

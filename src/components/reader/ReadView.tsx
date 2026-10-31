'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ThreadPanel } from '@/components/thread/ThreadPanel';
import type {
  Action,
  Anchor,
  BookFormat,
  HighlightColor,
  HighlightView,
  MenuItem,
  ReaderSelection,
  ReadingLocation,
} from '@/lib/types';
import { NoteEditor } from './NoteEditor';
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

/** The thread in the panel: an existing one, or a new one on the picked selection. Each opening gets its own key. */
type OpenThread = { key: number } & (
  | { threadId: string }
  | { threadId: null; action: Action; selection: ReaderSelection }
);

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

/** The book's highlights, or null when they cannot be loaded. Never rejects. */
async function loadHighlights(bookId: string): Promise<HighlightView[] | null> {
  try {
    const res = await fetch(`/api/highlights?bookId=${bookId}`);
    if (!res.ok) return null;
    return ((await res.json()) as { highlights: HighlightView[] }).highlights;
  } catch {
    return null;
  }
}

/** Saves a note highlight on the selection; null when it could not be saved. Never rejects. */
async function addNoteHighlight(
  selection: ReaderSelection,
  color: HighlightColor,
): Promise<HighlightView | null> {
  try {
    const res = await fetch('/api/highlights', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookId: selection.bookId, selection, color }),
    });
    return res.ok ? ((await res.json()) as HighlightView) : null;
  } catch {
    return null;
  }
}

/** Saves the selection to vocab; false when it could not be saved. Never rejects. */
async function saveToVocab(selection: ReaderSelection): Promise<boolean> {
  try {
    const res = await fetch('/api/vocab', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookId: selection.bookId, selection }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const NOTICE_MS = 2500;

type Props = {
  bookId: string;
  threadId: string | null;
  /** Opens the book here instead of at the saved position. */
  at: Anchor | null;
};

export function ReadView({ bookId, threadId, at }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState<Current | null>(null);
  const [open, setOpen] = useState<OpenThread | null>(threadId ? { key: 0, threadId } : null);
  const [highlights, setHighlights] = useState<HighlightView[]>([]);
  const [editing, setEditing] = useState<HighlightView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Tapping the same overlapping highlights again moves on to the next one.
  const lastTap = useRef<{ ids: string; index: number } | null>(null);

  const refreshHighlights = useCallback(() => {
    void loadHighlights(bookId).then((list) => {
      if (list) setHighlights(list);
      else setProblem('Could not load highlights.');
    });
  }, [bookId]);

  useEffect(() => {
    load(bookId).then(setLoaded, () => setFailed(true));
    refreshHighlights();
  }, [bookId, refreshHighlights]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_E2E === '1') window.__hmrSelection = current?.selection ?? null;
  }, [current]);

  const onSelection = (selection: ReaderSelection | null, box?: SelectionBox) => {
    setCurrent(selection && box ? { selection, box } : null);
    // A new selection (say, a double-click on a highlighted word) takes over from the note editor.
    if (selection) setEditing(null);
  };

  if (failed) {
    return (
      <p role="alert" className="p-4 text-sm text-red-600">
        Could not open this book.
      </p>
    );
  }
  if (!loaded) return <p className="p-4 text-sm opacity-70">Loading…</p>;

  const onPick = (item: MenuItem) => {
    setCurrent(null);
    if (!current) return;
    const { selection } = current;
    if (item === 'vocab') {
      setProblem(null);
      void saveToVocab(selection).then((saved) => {
        if (saved) setNotice('Saved to vocab');
        else setProblem('Could not save to vocab.');
      });
      return;
    }
    setOpen((prev) => ({ key: (prev?.key ?? 0) + 1, threadId: null, action: item, selection }));
  };

  const onColor = (color: HighlightColor) => {
    if (!current) return;
    const { selection } = current;
    setCurrent(null);
    setProblem(null);
    void addNoteHighlight(selection, color).then((created) => {
      if (created) setHighlights((prev) => [...prev, created]);
      else setProblem('Could not save the highlight.');
    });
  };

  const openThread = (id: string) => setOpen((prev) => ({ key: (prev?.key ?? 0) + 1, threadId: id }));

  /** Opens the most recent of the tapped highlights, or the next one when the same ones are tapped again. */
  const onHighlightTap = (tapped: HighlightView[]) => {
    const ids = tapped.map((h) => h.id).join();
    const index = lastTap.current?.ids === ids ? (lastTap.current.index + 1) % tapped.length : 0;
    lastTap.current = { ids, index };
    const highlight = tapped[index];
    if (highlight.threadId) {
      setEditing(null);
      openThread(highlight.threadId);
    } else {
      setEditing(highlight);
    }
  };

  const panel = open && (
    <ThreadPanel
      key={open.key}
      onCreated={refreshHighlights}
      onDeleted={(highlightId) => {
        setHighlights((prev) => prev.filter((h) => h.id !== highlightId));
        setOpen(null);
      }}
      {...(open.threadId === null
        ? { threadId: null, action: open.action, selection: open.selection }
        : { threadId: open.threadId })}
      onClose={() => setOpen(null)}
    />
  );

  const menu = (
    <>
      {current && (
        <SelectionMenu
          selection={current.selection}
          box={current.box}
          onPick={onPick}
          onColor={onColor}
        />
      )}
      {editing && (
        <NoteEditor
          key={editing.id}
          highlight={editing}
          onSaved={(saved) => {
            setHighlights((prev) => prev.map((h) => (h.id === saved.id ? saved : h)));
            setEditing(null);
          }}
          onDeleted={(id) => {
            setHighlights((prev) => prev.filter((h) => h.id !== id));
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {problem && (
        <p role="alert" className="fixed top-12 left-1/2 z-50 -translate-x-1/2 rounded bg-red-600 px-3 py-1 text-sm text-white">
          {problem}
        </p>
      )}
      {notice && (
        <p role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded bg-gray-900 px-3 py-1 text-sm text-white">
          {notice}
        </p>
      )}
      {panel}
    </>
  );
  if (loaded.format === 'epub') {
    const savedCfi = loaded.location && 'cfi' in loaded.location ? loaded.location.cfi : null;
    const initialCfi = at?.format === 'epub' ? at.cfi : savedCfi;
    return (
      <>
        <EpubReader
          bookId={bookId}
          fileUrl={loaded.fileUrl}
          initialCfi={initialCfi}
          onSelection={onSelection}
          highlights={highlights}
          onHighlightTap={onHighlightTap}
        />
        {menu}
      </>
    );
  }
  const savedPage = loaded.location && 'page' in loaded.location ? loaded.location.page : 1;
  const initialPage = at?.format === 'pdf' ? at.page : savedPage;
  return (
    <>
      <PdfReader
        bookId={bookId}
        fileUrl={loaded.fileUrl}
        initialPage={initialPage}
        onSelection={onSelection}
        highlights={highlights}
        onHighlightTap={onHighlightTap}
      />
      {menu}
    </>
  );
}

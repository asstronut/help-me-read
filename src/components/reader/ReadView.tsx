'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ThreadPanel } from '@/components/thread/ThreadPanel';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { Toast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { CheckIcon } from '@/components/ui/icons';
import { currentPdfItem, type ContentsItem } from '@/lib/reader/contents';
import { e2eHooksEnabled } from '@/lib/test-mode';
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
import { HighlightsPanel } from './HighlightsPanel';
import { NoteEditor } from './NoteEditor';
import type { ReaderControls } from './reader-controls';
import { BESIDE, useMediaQuery } from './useMediaQuery';
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

type Loaded = { title: string; format: BookFormat; fileUrl: string; location: ReadingLocation | null };

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
  const { title, format, fileUrl } = (await book.json()) as {
    title: string;
    format: BookFormat;
    fileUrl: string;
  };
  const { location } = (await position.json()) as { location: ReadingLocation | null };
  return { title, format, fileUrl, location };
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
  /** The language Translate goes into, shown on its button; null when unknown. */
  language: string | null;
};

export function ReadView({ bookId, threadId, at, language }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [current, setCurrent] = useState<Current | null>(null);
  const [open, setOpen] = useState<OpenThread | null>(threadId ? { key: 0, threadId } : null);
  const [highlights, setHighlights] = useState<HighlightView[]>([]);
  const [editing, setEditing] = useState<HighlightView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The highlights and threads panel. It shares the right side with the thread panel: one at a time.
  const [listOpen, setListOpen] = useState(false);
  const [pdfContents, setPdfContents] = useState<ContentsItem[]>([]);
  const controls = useRef<ReaderControls | null>(null);
  const panelsBeside = useMediaQuery(BESIDE);
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
    if (e2eHooksEnabled()) window.__hmrSelection = current?.selection ?? null;
  }, [current]);

  const onSelection = (selection: ReaderSelection | null, box?: SelectionBox) => {
    setCurrent(selection && box ? { selection, box } : null);
    // A new selection (say, a double-click on a highlighted word) takes over from the note editor.
    if (selection) setEditing(null);
  };

  if (failed) {
    return (
      <InlineAlert className="m-4">Could not open this book.</InlineAlert>
    );
  }
  if (!loaded) return <p className="p-4 text-sm text-muted">Loading…</p>;

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
    setListOpen(false);
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

  const openThread = (id: string) => {
    setListOpen(false);
    setOpen((prev) => ({ key: (prev?.key ?? 0) + 1, threadId: id }));
  };

  const toggleList = () => {
    setOpen(null);
    setListOpen((o) => !o);
  };

  /** Goes to the highlight; a thread opens in place of the list. On a phone the list (a sheet over the book) closes. */
  const jumpTo = (highlight: HighlightView) => {
    controls.current?.goTo(highlight.anchor);
    if (highlight.threadId) openThread(highlight.threadId);
    else if (!panelsBeside) setListOpen(false);
  };

  /** A link to the highlight, for opening it in a new tab: `?at=`, and `?thread=` for a thread. */
  const hrefOf = (highlight: HighlightView) => {
    const params = new URLSearchParams({ at: JSON.stringify(highlight.anchor) });
    if (highlight.threadId) params.set('thread', highlight.threadId);
    return `/read/${bookId}?${params}`;
  };

  /** A PDF's highlights are grouped by its bookmarks when it has them; otherwise by segment label. */
  const chapterOf = (highlight: HighlightView) =>
    highlight.anchor.format === 'pdf' ? (currentPdfItem(pdfContents, highlight.anchor.page)?.label ?? null) : null;

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
  const sidePanel = Boolean(open) || listOpen;

  const menu = (
    <>
      {current && (
        <SelectionMenu
          selection={current.selection}
          box={current.box}
          language={language}
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
      {(problem || notice) && (
        // Centred over the book (beside the thread panel on desktop), just above the progress
        // footer; on a PDF, above the floating page bar too.
        <div
          className={cn(
            'pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4',
            loaded.format === 'pdf' ? 'bottom-[116px] sm:bottom-[144px]' : 'bottom-14 sm:bottom-[76px]',
            sidePanel && 'md:pr-[420px]',
          )}
        >
          {problem && (
            <div className="pointer-events-auto max-w-md rounded-xl bg-surface font-sans shadow-[0_4px_16px_var(--shadow)]">
              <InlineAlert>{problem}</InlineAlert>
            </div>
          )}
          {notice && (
            <Toast icon={<CheckIcon size={14} />} className="pointer-events-auto font-sans">
              {notice}
            </Toast>
          )}
        </div>
      )}
      {panel}
      {listOpen && (
        <HighlightsPanel
          highlights={highlights}
          chapterOf={chapterOf}
          hrefOf={hrefOf}
          onJump={jumpTo}
          onClose={() => setListOpen(false)}
        />
      )}
    </>
  );
  // On desktop an open side panel (420 px) sits beside the book, so the book reflows into the rest.
  const bookClass = sidePanel ? 'md:pr-[420px]' : undefined;
  const shared = {
    bookId,
    title: loaded.title,
    fileUrl: loaded.fileUrl,
    onSelection,
    highlights,
    onHighlightTap,
    roomBeside: !sidePanel,
    highlightsOpen: listOpen,
    onHighlights: toggleList,
    controlsRef: controls,
  };
  if (loaded.format === 'epub') {
    const savedCfi = loaded.location && 'cfi' in loaded.location ? loaded.location.cfi : null;
    const initialCfi = at?.format === 'epub' ? at.cfi : savedCfi;
    return (
      <>
        <div className={bookClass}>
          <EpubReader {...shared} initialCfi={initialCfi} />
        </div>
        {menu}
      </>
    );
  }
  const savedPage = loaded.location && 'page' in loaded.location ? loaded.location.page : 1;
  const initialPage = at?.format === 'pdf' ? at.page : savedPage;
  return (
    <>
      <div className={bookClass}>
        <PdfReader {...shared} initialPage={initialPage} onContents={setPdfContents} />
      </div>
      {menu}
    </>
  );
}

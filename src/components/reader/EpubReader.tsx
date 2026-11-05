'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DrawAnnotationDetail,
  RelocateDetail,
  SectionLoadDetail,
  ShowAnnotationDetail,
  View,
} from 'foliate-js/view.js';
import { epubContents, findItem, type ContentsItem, type EpubContents } from '@/lib/reader/contents';
import { listenForPageKeys, type PageTurn } from '@/lib/reader/page-keys';
import { captureEpubSelection } from '@/lib/selection/capture-epub';
import { watchTaps } from '@/lib/selection/tap';
import { watchSelection } from '@/lib/selection/watch';
import type { HighlightView, ReaderSelection } from '@/lib/types';
import { ContentsOutline, ContentsRail } from './ContentsOutline';
import { HIGHLIGHT_HEX, HIGHLIGHT_INKS } from './highlight-colors';
import { PageTurnEdge } from './PageTurnEdge';
import { ProgressFooter } from './ProgressFooter';
import { ReaderTopBar } from './ReaderTopBar';
import { FONT_SIZES, ReadingSettings } from './ReadingSettings';
import type { SelectionBox } from './SelectionMenu';
import { usePositionSaver } from './usePositionSaver';

type Props = {
  bookId: string;
  title: string;
  fileUrl: string;
  initialCfi: string | null;
  onSelection: (selection: ReaderSelection | null, box?: SelectionBox) => void;
  highlights: HighlightView[];
  /** The highlights under a tap, most recent first. */
  onHighlightTap: (highlights: HighlightView[]) => void;
  /** False while a side panel takes the room beside the book. */
  roomBeside: boolean;
};

/** foliate puts the text this far below the top of its box (the paginator's `--_margin`). */
const TEXT_TOP = 48;

const FONT_SIZE_KEY = 'hmr.fontSize';
const DEFAULT_FONT_SIZE = 18;

function readFontSize(): number {
  try {
    const stored = Number(localStorage.getItem(FONT_SIZE_KEY));
    return (FONT_SIZES as readonly number[]).includes(stored) ? stored : DEFAULT_FONT_SIZE;
  } catch {
    return DEFAULT_FONT_SIZE;
  }
}

/** The longest line of text, in ems of the chosen font size: about 70 characters. */
const LINE_WIDTH_EM = 34;
const LINE_HEIGHT = 1.7;

/** The family names in a CSS font-family list, without quotes. */
const familyNames = (list: string) => list.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''));

/**
 * The page's @font-face rules for `families`, with their font URLs made absolute. next/font
 * writes these rules into the page's stylesheets with URLs relative to the stylesheet, and the
 * chapter's iframe sees neither, so the reading font has to be declared again inside it.
 */
function fontFaces(families: string[]): string {
  const rules: string[] = [];
  for (const sheet of document.styleSheets) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue; // a stylesheet from another origin cannot be read
    }
    const base = sheet.href ?? document.baseURI;
    for (const rule of list) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = familyNames(rule.style.getPropertyValue('font-family'))[0];
      if (!families.includes(family)) continue;
      const absolute = (_: string, quote: string, url: string) => `url(${quote}${new URL(url, base)}${quote})`;
      rules.push(rule.cssText.replace(/url\((["']?)([^"')]+)\1\)/g, absolute));
    }
  }
  return rules.join('\n');
}

let readingFontFaces: string | null = null;

/**
 * The chapter's styles: font size, the reading font and line height, and the page's theme
 * colours. The chapter is drawn in an iframe, which inherits none of the page's fonts or CSS
 * variables, so they are copied in here.
 */
function readerCss(size: number): string {
  const theme = getComputedStyle(document.documentElement);
  const bg = theme.getPropertyValue('--bg');
  const ink = theme.getPropertyValue('--ink');
  // Literata, loaded by next/font in the root layout: `"Literata", "Literata Fallback"`.
  const font = theme.getPropertyValue('--font-literata').trim();
  readingFontFaces ??= font ? fontFaces(familyNames(font)) : '';
  const family = font ? `${font}, Georgia, serif` : 'Georgia, serif';
  return `${readingFontFaces}
html, body, p { font-size: ${size}px !important; }
html, body { background: ${bg} !important; color: ${ink} !important; }
html, body { font-family: ${family} !important; line-height: ${LINE_HEIGHT} !important; }
p, li, blockquote, dd, dt { font-family: inherit !important; line-height: inherit !important; }`;
}

/** Applies the reading styles, and a line width that follows the font size, to the view. */
function styleReader(view: View, size: number) {
  // foliate-js lays the chapter out in columns no wider than `max-inline-size` (in px only), and
  // puts two side by side when they fit; one column keeps the line length readable on a desktop.
  view.renderer.setAttribute('max-column-count', '1');
  view.renderer.setAttribute('max-inline-size', `${Math.round(LINE_WIDTH_EM * size)}px`);
  view.renderer.setStyles(readerCss(size));
}

/** The range's box in the reader's viewport (the section is drawn in an iframe). */
function boxInViewport(range: Range): SelectionBox {
  const r = range.getBoundingClientRect();
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement?.getBoundingClientRect();
  const dx = frame?.left ?? 0;
  const dy = frame?.top ?? 0;
  return { top: r.top + dy, bottom: r.bottom + dy, left: r.left + dx, right: r.right + dx };
}

/**
 * The book's EPUB highlights grouped by CFI, the key foliate draws an annotation under: highlights
 * on the same words share one annotation, which draws them all.
 */
function byCfi(highlights: HighlightView[]): Map<string, HighlightView[]> {
  const map = new Map<string, HighlightView[]>();
  for (const h of highlights) {
    if (h.anchor.format !== 'epub') continue;
    const group = map.get(h.anchor.cfi);
    if (group) group.push(h);
    else map.set(h.anchor.cfi, [h]);
  }
  return map;
}

const looks = (group: HighlightView[]) => group.map((h) => `${h.id}:${h.kind}:${h.color}`).join();

const SVG_NS = 'http://www.w3.org/2000/svg';

export default function EpubReader({
  bookId,
  title,
  fileUrl,
  initialCfi,
  onSelection,
  highlights,
  onHighlightTap,
  roomBeside,
}: Props) {
  const [fontSize, setFontSize] = useState(readFontSize);
  const [error, setError] = useState(false);
  const [fraction, setFraction] = useState<number | null>(null);
  const [contents, setContents] = useState<EpubContents | null>(null);
  // foliate's id of the contents entry the page is in.
  const [tocId, setTocId] = useState<number | null>(null);
  const { save, status } = usePositionSaver(bookId);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const fontSizeRef = useRef(fontSize);
  const onSelectionRef = useRef(onSelection);
  const onHighlightTapRef = useRef(onHighlightTap);
  const highlightsRef = useRef(highlights);
  // What the view has been asked to draw, by CFI, oldest first.
  const drawnRef = useRef(new Map<string, HighlightView[]>());
  useEffect(() => {
    fontSizeRef.current = fontSize;
    onSelectionRef.current = onSelection;
    onHighlightTapRef.current = onHighlightTap;
    highlightsRef.current = highlights;
  });

  // Stable (refs only), so the key listeners never need replacing.
  const turnPage = useCallback((dir: PageTurn) => {
    void (dir === 1 ? viewRef.current?.next() : viewRef.current?.prev());
  }, []);

  /** Brings the view's annotations in line with the current highlights. */
  const syncAnnotations = useCallback((view: View) => {
    const next = byCfi(highlightsRef.current);
    const drawn = drawnRef.current;
    drawnRef.current = next;
    for (const value of drawn.keys()) {
      if (!next.has(value)) view.deleteAnnotation({ value }).catch(() => undefined);
    }
    for (const [value, group] of next) {
      const old = drawn.get(value);
      if (!old || looks(old) !== looks(group)) view.addAnnotation({ value }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (viewRef.current) syncAnnotations(viewRef.current);
  }, [highlights, syncAnnotations]);

  // The keys work on the page around the book; the chapter's own document gets them on load.
  useEffect(() => listenForPageKeys(window, turnPage), [turnPage]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let view: View | null = null;
    let unwatch: (() => void) | undefined;
    // Whether the last press in the section ended where it started; the end of a drag is not a tap.
    let lastReleaseWasTap = false;
    (async () => {
      const [, { Overlayer }] = await Promise.all([
        import('foliate-js/view.js'),
        import('foliate-js/overlayer.js'),
      ]);
      if (cancelled) return;
      view = document.createElement('foliate-view') as View;
      view.style.cssText = 'display:block;width:100%;height:100%';
      view.addEventListener('relocate', (e) => {
        const { cfi, fraction, tocItem } = (e as CustomEvent<RelocateDetail>).detail;
        save({ cfi });
        if (typeof fraction === 'number') setFraction(fraction);
        setTocId(tocItem?.id ?? null);
      });
      view.addEventListener('load', (e) => {
        const { doc, index } = (e as CustomEvent<SectionLoadDetail>).detail;
        const current = e.currentTarget as View;
        unwatch?.();
        onSelectionRef.current(null);
        const unwatchSelection = watchSelection(doc, (range) => {
          const selection = range && captureEpubSelection(range, bookId, index, current.getCFI(index, range));
          onSelectionRef.current(selection, range ? boxInViewport(range) : undefined);
        });
        const unwatchTaps = watchTaps(doc, (tap) => {
          lastReleaseWasTap = tap;
        });
        // A click in the text moves the focus into the chapter's iframe, so its keys come from there.
        const unwatchKeys = listenForPageKeys(doc, turnPage);
        unwatch = () => {
          unwatchSelection();
          unwatchTaps();
          unwatchKeys();
        };
      });
      // Each shown section gets a fresh overlay: draw its highlights again.
      view.addEventListener('create-overlay', (e) => {
        const current = e.currentTarget as View;
        for (const value of drawnRef.current.keys()) {
          current.addAnnotation({ value }).catch(() => undefined);
        }
      });
      view.addEventListener('draw-annotation', (e) => {
        const { draw, annotation } = (e as CustomEvent<DrawAnnotationDetail>).detail;
        const group = drawnRef.current.get(annotation.value);
        if (!group) return;
        // Fills first, so a thread underline on the same words stays on top.
        const ordered = [...group.filter((h) => h.kind === 'note'), ...group.filter((h) => h.kind === 'thread')];
        draw((rects) => {
          const g = document.createElementNS(SVG_NS, 'g');
          for (const h of ordered) {
            g.append(
              h.kind === 'thread'
                ? Overlayer.underline(rects, { color: HIGHLIGHT_INKS[h.color], width: 2 })
                : Overlayer.highlight(rects, { color: HIGHLIGHT_HEX[h.color] }),
            );
          }
          return g;
        });
      });
      view.addEventListener('show-annotation', (e) => {
        if (!lastReleaseWasTap) return;
        const group = drawnRef.current.get((e as CustomEvent<ShowAnnotationDetail>).detail.value);
        if (group) onHighlightTapRef.current([...group].reverse());
      });
      host.append(view);
      await view.open(fileUrl);
      if (cancelled) return;
      // Opening numbers the contents entries, which is how `relocate` names the current one.
      setContents(epubContents(view.book.toc));
      view.renderer.setAttribute('flow', 'paginated');
      styleReader(view, fontSizeRef.current);
      await view.init({ lastLocation: initialCfi, showTextStart: true });
      viewRef.current = view;
      syncAnnotations(view);
    })().catch(() => setError(true));
    return () => {
      cancelled = true;
      unwatch?.();
      viewRef.current = null;
      drawnRef.current = new Map();
      view?.close();
      view?.remove();
    };
  }, [bookId, fileUrl, initialCfi, save, syncAnnotations, turnPage]);

  function chooseFontSize(size: number) {
    setFontSize(size);
    try {
      localStorage.setItem(FONT_SIZE_KEY, String(size));
    } catch {
      // the choice just won't be remembered
    }
    if (viewRef.current) styleReader(viewRef.current, size);
  }

  const currentId = (tocId !== null && contents?.shownFor.get(tocId)) || null;
  const outline = {
    items: contents?.items ?? null,
    currentId,
    onGo: (item: ContentsItem) => {
      if (item.target && 'href' in item.target) void viewRef.current?.goTo(item.target.href);
    },
    emptyText: 'No contents in this book',
  };

  return (
    <div className="flex h-dvh flex-col">
      <ReaderTopBar
        title={title}
        chapter={contents ? (findItem(contents.items, currentId)?.item.label ?? null) : null}
        contents={<ContentsOutline {...outline} placement="bar" />}
      >
        <ReadingSettings fontSize={fontSize} onFontSize={chooseFontSize} />
      </ReaderTopBar>
      {status}
      {error && (
        <p role="alert" className="p-4 text-sm text-red-600">
          Could not open this EPUB.
        </p>
      )}
      {/* The ☰ button's 18px icon is 13px into its 44px box: line the icon up with the text. */}
      <ContentsRail {...outline} roomBeside={roomBeside} top={TEXT_TOP - 13} className="group">
        <PageTurnEdge direction="previous" onClick={() => turnPage(-1)} />
        {/* Note highlights are drawn by foliate at this opacity: the theme's tint strength. */}
        <div
          ref={hostRef}
          className="min-w-0 flex-1 [--overlayer-highlight-opacity:var(--highlight-alpha)]"
        />
        <PageTurnEdge direction="next" onClick={() => turnPage(1)} />
      </ContentsRail>
      <ProgressFooter fraction={fraction} />
    </div>
  );
}

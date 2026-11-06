'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DrawAnnotationDetail,
  RelocateDetail,
  SectionLoadDetail,
  ShowAnnotationDetail,
  View,
} from 'foliate-js/view.js';
import { epubContents, findItem, type ContentsItem, type EpubContents } from '@/lib/reader/contents';
import { listenForPageKeys, type PageTurn } from '@/lib/reader/page-keys';
import {
  PREFS,
  usePref,
  type FontSize,
  type LineSpacing,
  type LineWidth,
  type Typeface,
} from '@/lib/reader/reading-prefs';
import { captureEpubSelection } from '@/lib/selection/capture-epub';
import { watchPageTaps, watchTaps } from '@/lib/selection/tap';
import { watchSelection } from '@/lib/selection/watch';
import { useShownTheme } from '@/lib/settings/theme-client';
import type { HighlightView, ReaderSelection } from '@/lib/types';
import type { ReaderControls } from './reader-controls';
import { ContentsOutline, ContentsRail } from './ContentsOutline';
import { HIGHLIGHT_HEX, HIGHLIGHT_INKS } from './highlight-colors';
import { PageTurnEdge } from './PageTurnEdge';
import { ProgressFooter } from './ProgressFooter';
import { ReaderTopBar } from './ReaderTopBar';
import { ReadingSettings, TypographyOptions } from './ReadingSettings';
import type { SelectionBox } from './SelectionMenu';
import { SM, TOUCH, useMediaQuery } from './useMediaQuery';
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
  highlightsOpen: boolean;
  onHighlights: () => void;
  /** Filled in by the reader, so the page around it can move it to a highlight. */
  controlsRef: { current: ReaderControls | null };
};

/** foliate puts the text this far below the top of its box (the paginator's `--_margin`). */
const TEXT_TOP = 48;

/** How the chapter's text is set, from the reader's choices in Aa. */
type Look = {
  typeface: Typeface;
  fontSize: FontSize;
  lineSpacing: LineSpacing;
  lineWidth: LineWidth;
  /** On a phone the screen, not the line width, limits the text: the width choice sets the side margins. */
  phone: boolean;
  /** A touch screen: held sideways, it shows two columns side by side, like an open book. */
  spread: boolean;
};

/** Each typeface's CSS variable, set on <html> by next/font in the root layout, and its fallbacks. */
const TYPEFACE_FONTS: Record<Typeface, { variable: string; fallback: string }> = {
  literata: { variable: '--font-literata', fallback: 'Georgia, serif' },
  sans: { variable: '--font-geist-sans', fallback: 'system-ui, sans-serif' },
  hyperlegible: { variable: '--font-atkinson', fallback: 'system-ui, sans-serif' },
};

const LINE_HEIGHTS: Record<LineSpacing, number> = { tight: 1.5, normal: 1.7, airy: 1.9 };

/**
 * The longest line, in ems of the font size (medium is about 70 characters), and on a phone the
 * gap foliate leaves around the text, as a share of the screen's width (foliate's default is 7%).
 */
const LINE_WIDTHS: Record<LineWidth, { em: number; phoneGap: string }> = {
  narrow: { em: 28, phoneGap: '14%' },
  medium: { em: 34, phoneGap: '7%' },
  wide: { em: 42, phoneGap: '3%' },
};
const DESKTOP_GAP = '7%';

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
 * The chapter's styles: font size, typeface and line height, and the page's theme colours. The
 * chapter is drawn in an iframe, which inherits none of the page's fonts or CSS variables, so
 * they are copied in here.
 */
function readerCss(look: Look): string {
  const theme = getComputedStyle(document.documentElement);
  const bg = theme.getPropertyValue('--bg');
  const ink = theme.getPropertyValue('--ink');
  // Each variable holds a list such as `"Literata", "Literata Fallback"`. All three typefaces are
  // declared in the chapter, so a switch needs no new rules; only the chosen one is downloaded.
  const fonts = Object.values(TYPEFACE_FONTS).map((f) => theme.getPropertyValue(f.variable).trim());
  readingFontFaces ??= fontFaces(fonts.filter(Boolean).flatMap(familyNames));
  const { variable, fallback } = TYPEFACE_FONTS[look.typeface];
  const font = theme.getPropertyValue(variable).trim();
  const family = font ? `${font}, ${fallback}` : fallback;
  return `${readingFontFaces}
html, body, p { font-size: ${look.fontSize}px !important; }
html, body { background: ${bg} !important; color: ${ink} !important; }
html, body { font-family: ${family} !important; line-height: ${LINE_HEIGHTS[look.lineSpacing]} !important; }
p, li, blockquote, dd, dt { font-family: inherit !important; line-height: inherit !important; }`;
}

/** Applies the reading styles, and a line width that follows the font size, to the view. */
function styleReader(view: View, look: Look) {
  const width = LINE_WIDTHS[look.lineWidth];
  // foliate-js lays the chapter out in columns no wider than `max-inline-size` (in px only), and
  // puts up to `max-column-count` side by side when they fit, in landscape only (its own container
  // query falls back to one column in portrait). A desktop keeps one column, as designed.
  view.renderer.setAttribute('max-column-count', look.spread ? '2' : '1');
  view.renderer.setAttribute('max-inline-size', `${Math.round(width.em * look.fontSize)}px`);
  view.renderer.setAttribute('gap', look.phone ? width.phoneGap : DESKTOP_GAP);
  view.renderer.setStyles(readerCss(look));
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

/**
 * What a tap on the text does, by where it lands across the book: the left third turns back, the
 * right third forward (goLeft and goRight follow the book's direction), the middle shows or hides
 * the reader's controls.
 */
function zoneAction(x: number, book: DOMRect): 'left' | 'right' | 'controls' {
  const third = ((x - book.left) / book.width) * 3;
  if (third < 1) return 'left';
  return third < 2 ? 'controls' : 'right';
}

export default function EpubReader({
  bookId,
  title,
  fileUrl,
  initialCfi,
  onSelection,
  highlights,
  onHighlightTap,
  roomBeside,
  highlightsOpen,
  onHighlights,
  controlsRef,
}: Props) {
  const [fontSize, setFontSize] = usePref(PREFS.fontSize);
  const [typeface, setTypeface] = usePref(PREFS.typeface);
  const [lineSpacing, setLineSpacing] = usePref(PREFS.lineSpacing);
  const [lineWidth, setLineWidth] = usePref(PREFS.lineWidth);
  const phone = !useMediaQuery(SM);
  const spread = useMediaQuery(TOUCH);
  const look = useMemo<Look>(
    () => ({ typeface, fontSize, lineSpacing, lineWidth, phone, spread }),
    [typeface, fontSize, lineSpacing, lineWidth, phone, spread],
  );
  // The chapter copies the theme's colours in, so it is styled again when the theme changes.
  const theme = useShownTheme();
  const [error, setError] = useState(false);
  const [fraction, setFraction] = useState<number | null>(null);
  const [contents, setContents] = useState<EpubContents | null>(null);
  // foliate's id of the contents entry the page is in.
  const [tocId, setTocId] = useState<number | null>(null);
  // Hidden by a tap in the middle of the text, and shown by the next one. They keep their room
  // while hidden, so the text does not move.
  const [controlsShown, setControlsShown] = useState(true);
  const hideControls = controlsShown ? undefined : 'invisible';
  const { save, status } = usePositionSaver(bookId);
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  const lookRef = useRef(look);
  const onSelectionRef = useRef(onSelection);
  const onHighlightTapRef = useRef(onHighlightTap);
  const highlightsRef = useRef(highlights);
  // What the view has been asked to draw, by CFI, oldest first.
  const drawnRef = useRef(new Map<string, HighlightView[]>());
  useEffect(() => {
    lookRef.current = look;
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

  useEffect(() => {
    controlsRef.current = {
      goTo: (anchor) => {
        if (anchor.format === 'epub') void viewRef.current?.goTo(anchor.cfi);
      },
    };
    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef]);

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
    // Whether the last tap opened a highlight, which a tap zone then leaves alone.
    let tapOpenedHighlight = false;
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
        const known = typeof fraction === 'number' ? fraction : null;
        save({ cfi }, known);
        if (known !== null) setFraction(known);
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
          tapOpenedHighlight = false;
        });
        const unwatchPageTaps = watchPageTaps(doc, (e) => {
          const host = hostRef.current;
          const frame = doc.defaultView?.frameElement;
          if (tapOpenedHighlight || !host || !frame) return;
          // The tap's x is inside the chapter's iframe, which is as wide as all its pages.
          const x = frame.getBoundingClientRect().left + e.clientX;
          const action = zoneAction(x, host.getBoundingClientRect());
          if (action === 'controls') setControlsShown((shown) => !shown);
          else void (action === 'left' ? current.goLeft() : current.goRight());
        });
        // A click in the text moves the focus into the chapter's iframe, so its keys come from there.
        const unwatchKeys = listenForPageKeys(doc, turnPage);
        unwatch = () => {
          unwatchSelection();
          unwatchTaps();
          unwatchPageTaps();
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
        if (!group) return;
        tapOpenedHighlight = true;
        onHighlightTapRef.current([...group].reverse());
      });
      host.append(view);
      await view.open(fileUrl);
      if (cancelled) return;
      // Opening numbers the contents entries, which is how `relocate` names the current one.
      setContents(epubContents(view.book.toc));
      view.renderer.setAttribute('flow', 'paginated');
      styleReader(view, lookRef.current);
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

  useEffect(() => {
    if (viewRef.current) styleReader(viewRef.current, look);
  }, [look, theme]);

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
        highlightsOpen={highlightsOpen}
        onHighlights={onHighlights}
        className={hideControls}
      >
        <ReadingSettings>
          <TypographyOptions
            typeface={typeface}
            onTypeface={setTypeface}
            fontSize={fontSize}
            onFontSize={setFontSize}
            lineSpacing={lineSpacing}
            onLineSpacing={setLineSpacing}
            lineWidth={lineWidth}
            onLineWidth={setLineWidth}
          />
        </ReadingSettings>
      </ReaderTopBar>
      {status}
      {error && (
        <p role="alert" className="p-4 text-sm text-red-600">
          Could not open this EPUB.
        </p>
      )}
      {/* The ☰ button's 18px icon is 13px into its 44px box: line the icon up with the text. */}
      <ContentsRail
        {...outline}
        roomBeside={roomBeside}
        top={TEXT_TOP - 13}
        className="group"
        outlineClassName={hideControls}
      >
        <PageTurnEdge direction="previous" onClick={() => turnPage(-1)} className={hideControls} />
        {/* Note highlights are drawn by foliate at this opacity: the theme's tint strength. */}
        <div
          ref={hostRef}
          className="min-w-0 flex-1 [--overlayer-highlight-opacity:var(--highlight-alpha)]"
        />
        <PageTurnEdge direction="next" onClick={() => turnPage(1)} className={hideControls} />
      </ContentsRail>
      <ProgressFooter fraction={fraction} className={hideControls} />
    </div>
  );
}

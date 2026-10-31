import { PREFIX_CHARS, type ReaderSelection, type Rect } from '@/lib/types';
import { plainText } from './plain-text';

const PAGE = '.react-pdf__Page[data-page-number]';
const TEXT_LAYER = '.react-pdf__Page__textContent';

const elementOf = (node: Node): Element | null =>
  node instanceof Element ? node : node.parentElement;

// Each page's text layer is a block of its own; its lines are split by <br>.
const isTextLayer = (el: Element) => el.matches(TEXT_LAYER);

/**
 * Reads a selection made in a PDF text layer. It belongs to the page it starts on:
 * the rects cover only that page's part of it, normalised to the page.
 */
export function capturePdfSelection(range: Range, bookId: string): ReaderSelection | null {
  const text = plainText(range, isTextLayer).trim();
  const pageEl = elementOf(range.startContainer)?.closest(PAGE);
  const layer = pageEl?.querySelector(TEXT_LAYER);
  if (!text || !pageEl || !layer) return null;
  const page = Number(pageEl.getAttribute('data-page-number'));

  const before = document.createRange();
  before.setStart(layer, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const prefix = plainText(before, isTextLayer).trimStart().slice(-PREFIX_CHARS);

  return {
    bookId,
    segmentSeq: page - 1,
    text,
    prefix,
    anchor: { format: 'pdf', page, rects: rectsOnPage(range, layer, pageEl.getBoundingClientRect()) },
  };
}

/** One rect per line box of each text node the range covers on this page's text layer. */
function rectsOnPage(range: Range, layer: Element, page: DOMRect): Rect[] {
  const rects: Rect[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!range.intersectsNode(node)) continue;
    const part = document.createRange();
    part.selectNodeContents(node);
    if (node === range.startContainer) part.setStart(node, range.startOffset);
    if (node === range.endContainer) part.setEnd(node, range.endOffset);
    for (const r of part.getClientRects()) {
      if (r.width === 0 || r.height === 0) continue;
      rects.push({
        x: (r.left - page.left) / page.width,
        y: (r.top - page.top) / page.height,
        w: r.width / page.width,
        h: r.height / page.height,
      });
    }
  }
  return rects;
}

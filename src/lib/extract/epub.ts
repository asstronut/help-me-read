import type { TocItem } from 'foliate-js/view.js';
import type { Segment } from '@/lib/types';
import { cleanParagraphs } from './paragraphs';

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'ul',
]);
const HEADING = /^h[1-6]$/;
const SKIPPED_TAGS = new Set(['script', 'style']);

type Paragraph = { text: string; tag: string | null };

const isElement = (node: Node): node is Element => node.nodeType === 1;
const tagOf = (el: Element) => el.localName.toLowerCase();
const isBlock = (el: Element) => BLOCK_TAGS.has(tagOf(el));
const hasBlockInside = (el: Element) => [...el.querySelectorAll('*')].some(isBlock);
const normalise = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Text of a node with each <br> read as a space. */
function textOf(node: Node): string {
  if (!isElement(node)) return node.nodeType === 3 ? (node.textContent ?? '') : '';
  const tag = tagOf(node);
  if (SKIPPED_TAGS.has(tag)) return '';
  if (tag === 'br') return ' ';
  return [...node.childNodes].map(textOf).join('');
}

/**
 * One paragraph per block element without block children. An element that does have block
 * children contributes the text runs beside them as paragraphs of their own, in order.
 */
function collect(el: Element, out: Paragraph[]): void {
  if (!hasBlockInside(el)) {
    out.push({ text: textOf(el), tag: tagOf(el) });
    return;
  }
  let run = '';
  const flush = () => {
    out.push({ text: run, tag: null });
    run = '';
  };
  for (const child of el.childNodes) {
    if (isElement(child) && (isBlock(child) || hasBlockInside(child))) {
      flush();
      collect(child, out);
    } else {
      run += textOf(child);
    }
  }
  flush();
}

/** Maps each spine item's id to the first table-of-contents label that points at it. */
function sectionLabels(toc: TocItem[] | null | undefined): Map<string, string> {
  const labels = new Map<string, string>();
  const walk = (items: TocItem[]) => {
    for (const { label, href, subitems } of items) {
      const id = href?.split('#')[0];
      if (id && label && normalise(label) && !labels.has(id)) labels.set(id, normalise(label));
      if (subitems) walk(subitems);
    }
  };
  walk(toc ?? []);
  return labels;
}

/**
 * A section's paragraphs. A leading heading whose text is just the section's label is dropped,
 * since the label already carries it; every other heading stays.
 */
function documentParagraphs(doc: Document, label: string): string[] {
  const body = doc.body ?? doc.documentElement;
  const found: Paragraph[] = [];
  collect(body, found);
  const nonEmpty = found.filter((p) => normalise(p.text) !== '');
  const [first, ...rest] = nonEmpty;
  const dropFirst =
    first !== undefined &&
    first.tag !== null &&
    HEADING.test(first.tag) &&
    normalise(first.text) === normalise(label);
  return cleanParagraphs((dropFirst ? rest : nonEmpty).map((p) => p.text));
}

/** One segment per spine item. Runs in the browser. */
export async function extractEpubSegments(file: File): Promise<Segment[]> {
  const { makeBook } = await import('foliate-js/view.js');
  const book = await makeBook(file);
  const labels = sectionLabels(book.toc);
  const segments: Segment[] = [];
  for (const [seq, section] of book.sections.entries()) {
    const label = labels.get(section.id) ?? `Section ${seq + 1}`;
    segments.push({
      seq,
      label,
      paragraphs: documentParagraphs(await section.createDocument(), label),
    });
  }
  return segments;
}

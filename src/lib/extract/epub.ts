import type { TocItem } from 'foliate-js/view.js';
import type { Segment } from '@/lib/types';
import { cleanParagraphs } from './paragraphs';

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, dt, dd, figcaption, td, th';

/** Maps each spine item's id to the first table-of-contents label that points at it. */
function sectionLabels(toc: TocItem[] | null | undefined): Map<string, string> {
  const labels = new Map<string, string>();
  const walk = (items: TocItem[]) => {
    for (const { label, href, subitems } of items) {
      const id = href?.split('#')[0];
      if (id && label?.trim() && !labels.has(id)) labels.set(id, label.trim());
      if (subitems) walk(subitems);
    }
  };
  walk(toc ?? []);
  return labels;
}

/**
 * One paragraph per block element that has no block children. A leading heading that only
 * repeats the section's label is dropped, since the label already carries it.
 */
function documentParagraphs(doc: Document, label: string): string[] {
  const leaves = [...doc.querySelectorAll(BLOCKS)].filter((el) => !el.querySelector(BLOCKS));
  const paragraphs = cleanParagraphs(leaves.map((el) => el.textContent ?? ''));
  return paragraphs[0] === label ? paragraphs.slice(1) : paragraphs;
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

import { BLOCK_TAGS } from '@/lib/html-tags';
import { PREFIX_CHARS, type ReaderSelection } from '@/lib/types';
import { plainText } from './plain-text';

const isBlock = (el: Element) => BLOCK_TAGS.has(el.localName.toLowerCase());

/** Reads a selection made in an EPUB section; it belongs to the section it starts in. */
export function captureEpubSelection(
  range: Range,
  bookId: string,
  sectionIndex: number,
  cfi: string,
): ReaderSelection | null {
  const text = plainText(range, isBlock).trim();
  const body = range.startContainer.ownerDocument?.body;
  if (!text || !body) return null;

  const before = body.ownerDocument.createRange();
  before.setStart(body, 0);
  before.setEnd(range.startContainer, range.startOffset);

  return {
    bookId,
    segmentSeq: sectionIndex,
    text,
    prefix: plainText(before, isBlock).trimStart().slice(-PREFIX_CHARS),
    anchor: { format: 'epub', cfi },
  };
}

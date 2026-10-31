import { PREFIX_CHARS, type ReaderSelection } from '@/lib/types';

/** Reads a selection made in an EPUB section; it belongs to the section it starts in. */
export function captureEpubSelection(
  range: Range,
  bookId: string,
  sectionIndex: number,
  cfi: string,
): ReaderSelection | null {
  const text = range.toString().replace(/\s+/g, ' ').trim();
  const body = range.startContainer.ownerDocument?.body;
  if (!text || !body) return null;

  const before = body.ownerDocument.createRange();
  before.setStart(body, 0);
  before.setEnd(range.startContainer, range.startOffset);

  return {
    bookId,
    segmentSeq: sectionIndex,
    text,
    prefix: before.toString().slice(-PREFIX_CHARS),
    anchor: { format: 'epub', cfi },
  };
}

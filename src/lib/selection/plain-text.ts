import { SKIPPED_TAGS } from '@/lib/extract/epub';

/**
 * The range's text the way extraction reads it: script and style skipped, `<br>` and the
 * edges of block elements read as spaces, and whitespace collapsed to single spaces.
 */
export function plainText(range: Range, isBlock: (el: Element) => boolean): string {
  const fragment = range.cloneContents();
  for (const el of fragment.querySelectorAll('*')) {
    const tag = el.localName.toLowerCase();
    if (SKIPPED_TAGS.has(tag)) el.remove();
    else if (tag === 'br') el.replaceWith(' ');
    else if (isBlock(el)) {
      el.before(' ');
      el.after(' ');
    }
  }
  return (fragment.textContent ?? '').replace(/\s+/g, ' ');
}

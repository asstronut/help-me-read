import { SKIPPED_TAGS } from '@/lib/html-tags';

/**
 * The range's text the way extraction reads it: script and style skipped, `<br>` and the
 * edges of block elements read as spaces, and whitespace collapsed to single spaces.
 * The blocks the range ends inside are cut off there, so they get no closing space: a range
 * that ends mid-word ends with that word's first characters.
 */
export function plainText(range: Range, isBlock: (el: Element) => boolean): string {
  const fragment = range.cloneContents();
  const cutAtEnd = new Set<Node>();
  for (let node = fragment.lastChild; node; node = node.lastChild) cutAtEnd.add(node);
  for (const el of fragment.querySelectorAll('*')) {
    const tag = el.localName.toLowerCase();
    if (SKIPPED_TAGS.has(tag)) el.remove();
    else if (tag === 'br') el.replaceWith(' ');
    else if (isBlock(el)) {
      el.before(' ');
      if (!cutAtEnd.has(el)) el.after(' ');
    }
  }
  return (fragment.textContent ?? '').replace(/\s+/g, ' ');
}

import { SKIPPED_TAGS } from '@/lib/html-tags';

// Stands in for a <br> until line-end hyphens are joined; a private-use character, so not in book text.
const LINE_BREAK = '';

/**
 * The range's text the way extraction reads it: script and style skipped, `<br>` and the
 * edges of block elements read as spaces, and whitespace collapsed to single spaces.
 * The blocks the range ends inside are cut off there, so they get no closing space: a range
 * that ends mid-word ends with that word's first characters.
 * With `joinHyphenatedLines` (PDF), a `-` that ends a line joins it to the next with no hyphen
 * and no space, as PDF extraction does: `ephem-<br>eral` reads as `ephemeral`.
 */
export function plainText(
  range: Range,
  isBlock: (el: Element) => boolean,
  { joinHyphenatedLines = false } = {},
): string {
  const fragment = range.cloneContents();
  const cutAtEnd = new Set<Node>();
  for (let node = fragment.lastChild; node; node = node.lastChild) cutAtEnd.add(node);
  for (const el of fragment.querySelectorAll('*')) {
    const tag = el.localName.toLowerCase();
    if (SKIPPED_TAGS.has(tag)) el.remove();
    else if (tag === 'br') el.replaceWith(LINE_BREAK);
    else if (isBlock(el)) {
      el.before(' ');
      if (!cutAtEnd.has(el)) el.after(' ');
    }
  }
  let text = fragment.textContent ?? '';
  if (joinHyphenatedLines) text = text.replace(/-\s*\s*/g, '');
  return text.replaceAll(LINE_BREAK, ' ').replace(/\s+/g, ' ');
}

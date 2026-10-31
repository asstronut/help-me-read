import { cleanParagraphs, locate } from '@/lib/context/build';

/**
 * The sentence holding the occurrence of `text` that the prefix points at (the one a thread's
 * context would mark), or '' when the text is not in the paragraphs. Sentences end at `.`, `!` or
 * `?` followed by whitespace; the terminator is kept. The sentence stays in the paragraph it starts in.
 */
export function sentenceAround(segmentParagraphs: string[], text: string, prefix: string): string {
  const paragraphs = cleanParagraphs(segmentParagraphs);
  const located = locate(paragraphs, text, prefix);
  if (!located) return '';

  const paragraph = paragraphs[located.start.paragraph];
  const start = located.start.offset;
  const end =
    located.end.paragraph === located.start.paragraph ? located.end.offset : paragraph.length;

  let from = 0;
  for (const m of paragraph.slice(0, start).matchAll(/[.!?]\s+/g)) from = m.index + m[0].length;
  const terminator = /[.!?](?=\s|$)/g;
  terminator.lastIndex = Math.max(start, end - 1);
  const to = terminator.exec(paragraph);
  return paragraph.slice(from, to ? to.index + 1 : paragraph.length).trim();
}

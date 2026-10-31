import { EPUB_CONTEXT_WORDS, type BookFormat, type ContextScope, type Segment } from '@/lib/types';

const OPEN_MARK = '⟦';
const CLOSE_MARK = '⟧';

export type BuildContextInput = {
  format: BookFormat;
  scope: ContextScope;
  segments: Segment[];
  segmentSeq: number;
  text: string;
  prefix: string;
};

const collapse = (s: string) => s.replace(/\s+/g, ' ');
const normalise = (s: string) => collapse(s).trim();
const wordCount = (p: string) => (p === '' ? 0 : p.split(' ').length);

type Position = { paragraph: number; offset: number };
type Located = { start: Position; end: Position };

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/**
 * Finds the selected text in the paragraphs (joined by single spaces, as the selection is captured).
 * With several occurrences, the one whose preceding text shares the longest suffix with the prefix wins; ties go to the first.
 */
function locate(paragraphs: string[], text: string, prefix: string): Located | null {
  const needle = normalise(text);
  if (needle === '') return null;
  const joined = paragraphs.join(' ');
  const wantedPrefix = collapse(prefix);

  let best = -1;
  let bestScore = -1;
  for (let at = joined.indexOf(needle); at !== -1; at = joined.indexOf(needle, at + 1)) {
    const score = commonSuffixLength(joined.slice(0, at), wantedPrefix);
    if (score > bestScore) {
      best = at;
      bestScore = score;
    }
  }
  if (best === -1) return null;

  const starts: number[] = [];
  let offset = 0;
  for (const p of paragraphs) {
    starts.push(offset);
    offset += p.length + 1;
  }
  const at = (index: number, isEnd: boolean): Position => {
    const paragraph = starts.findLastIndex((s) => (isEnd ? s < index : s <= index));
    return { paragraph, offset: index - starts[paragraph] };
  };
  return { start: at(best, false), end: at(best + needle.length, true) };
}

function markParagraphs(paragraphs: string[], located: Located | null): string[] {
  if (!located) return paragraphs;
  const marked = [...paragraphs];
  const insert = ({ paragraph, offset }: Position, mark: string) => {
    const p = marked[paragraph];
    marked[paragraph] = p.slice(0, offset) + mark + p.slice(offset);
  };
  insert(located.end, CLOSE_MARK); // end first, so the start offset stays valid in a shared paragraph
  insert(located.start, OPEN_MARK);
  return marked;
}

/** Grows from the centre paragraph: next, previous, next… until the word budget is reached or both edges are hit. */
function epubWindow(paragraphs: string[], centre: number): [number, number] {
  let first = centre;
  let last = centre;
  let words = wordCount(paragraphs[centre]);
  let takeNext = true;
  while (words < EPUB_CONTEXT_WORDS && (first > 0 || last < paragraphs.length - 1)) {
    const canNext = last < paragraphs.length - 1;
    const canPrev = first > 0;
    if ((takeNext && canNext) || !canPrev) words += wordCount(paragraphs[++last]);
    else words += wordCount(paragraphs[--first]);
    takeNext = !takeNext;
  }
  return [first, last];
}

function pageContext(
  format: BookFormat,
  paragraphs: string[],
  located: Located | null,
): string {
  const marked = markParagraphs(paragraphs, located);
  if (format === 'pdf' || marked.length === 0) return marked.join('\n\n');
  const [first, last] = epubWindow(marked, located ? located.start.paragraph : 0);
  return marked.slice(first, last + 1).join('\n\n');
}

/** The context sent with a thread's first message (spec §4.6), with the selected occurrence marked ⟦…⟧. */
export function buildContext({
  format,
  scope,
  segments,
  segmentSeq,
  text,
  prefix,
}: BuildContextInput): string {
  const cleaned = (s: Segment) => s.paragraphs.map(normalise).filter((p) => p !== '');
  const segment = segments.find((s) => s.seq === segmentSeq);
  const paragraphs = segment ? cleaned(segment) : [];
  const located = locate(paragraphs, text, prefix);

  if (scope === 'page') return pageContext(format, paragraphs, located);

  return [...segments]
    .sort((a, b) => a.seq - b.seq)
    .map((s) => {
      const body = s.seq === segmentSeq ? markParagraphs(paragraphs, located) : cleaned(s);
      return [`## ${s.label}`, ...body].join('\n\n');
    })
    .join('\n\n');
}

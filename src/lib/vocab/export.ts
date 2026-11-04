import type { VocabEntryView } from './service.server';

type Exported = Pick<VocabEntryView, 'term' | 'meaning' | 'sentence' | 'bookTitle' | 'createdAt'>;

/** RFC 4180: a field with a comma, quote or line break is quoted, its quotes doubled. */
function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** CSV with a header row and CRLF line ends (RFC 4180). */
export function toCsv(entries: Exported[]): string {
  const rows = [
    ['term', 'meaning', 'sentence', 'book', 'created_at'],
    ...entries.map((e) => [e.term, e.meaning ?? '', e.sentence, e.bookTitle ?? '', e.createdAt]),
  ];
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

/** One line of text for Anki's HTML fields: tabs and line breaks become spaces, markup is escaped. */
function ankiField(value: string): string {
  return value
    .replace(/[\t\r\n]+/g, ' ')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Anki import text, no header: front is the term; back is the meaning, the sentence and the book. */
export function toAnki(entries: Exported[]): string {
  return entries
    .map((e) => {
      const back = [ankiField(e.meaning ?? ''), `<i>${ankiField(e.sentence)}</i>`];
      if (e.bookTitle) back.push(`— ${ankiField(e.bookTitle)}`);
      return `${ankiField(e.term)}\t${back.join('<br>')}\n`;
    })
    .join('');
}

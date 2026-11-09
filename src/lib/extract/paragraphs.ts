// NUL counts as whitespace here: PDFs can carry it, and Postgres text cannot store it.
export const collapseWhitespace = (text: string): string =>
  text.replace(/[\s\u0000]+/g, ' ').trim();

/** Collapses whitespace in each paragraph and drops the ones left empty. */
export const cleanParagraphs = (paragraphs: string[]): string[] =>
  paragraphs.map(collapseWhitespace).filter((p) => p !== '');

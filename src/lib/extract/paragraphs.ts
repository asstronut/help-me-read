export const collapseWhitespace = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Collapses whitespace in each paragraph and drops the ones left empty. */
export const cleanParagraphs = (paragraphs: string[]): string[] =>
  paragraphs.map(collapseWhitespace).filter((p) => p !== '');

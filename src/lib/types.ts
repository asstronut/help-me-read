export type BookFormat = 'pdf' | 'epub';
export type Rect = { x: number; y: number; w: number; h: number }; // 0..1 of page
export type Anchor =
  | { format: 'pdf'; page: number; rects: Rect[] }
  | { format: 'epub'; cfi: string };
export type ReadingLocation = { page: number } | { cfi: string };
export type Segment = { seq: number; label: string; paragraphs: string[] };
export type ReaderSelection = {
  bookId: string;
  segmentSeq: number;
  text: string;
  prefix: string;
  anchor: Anchor;
};
export type Action = 'translate' | 'define' | 'explain' | 'simplify' | 'ask';
export type MenuItem = Action | 'vocab';
export type ContextScope = 'page' | 'book';
export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink';
export type Theme = 'light' | 'dark' | 'sepia';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['.pdf', '.epub'] as const;
export const MAX_SELECTION_WORDS = 2000;
export const EPUB_CONTEXT_WORDS = 400;
export const PREFIX_CHARS = 200;
export const MAX_SEGMENT_BATCH = 50;
export const DEFAULT_MONTHLY_CAP_USD = 10;
export const HIGHLIGHT_COLORS: readonly HighlightColor[] = ['yellow', 'green', 'blue', 'pink'];
export const THEMES: readonly Theme[] = ['light', 'dark', 'sepia'];

export const estimateTokens = (chars: number): number => Math.ceil(chars / 4);

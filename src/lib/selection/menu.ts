import type { MenuItem } from '@/lib/types';

const PHRASE_ORDER: MenuItem[] = ['explain', 'translate', 'define', 'simplify', 'ask', 'vocab'];
const WORD_ORDER: MenuItem[] = ['define', 'translate', 'explain', 'simplify', 'ask', 'vocab'];

export const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** A single word puts Define first; anything longer puts Explain first. */
export const orderMenu = (text: string): MenuItem[] =>
  /\s/.test(text.trim()) ? PHRASE_ORDER : WORD_ORDER;

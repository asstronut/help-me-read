import type { HighlightColor } from '@/lib/types';

/**
 * The highlight palette, the one place these colours live. The menu dots use them as they are;
 * note highlights draw them over the text at the theme's `--highlight-alpha`, so the dot and the
 * tint are the same colour.
 */
export const HIGHLIGHT_HEX: Record<HighlightColor, string> = {
  yellow: '#F2CC4D',
  green: '#8CC79A',
  blue: '#8DB8DE',
  pink: '#E7A3BF',
};
/** Darker shades, for thread underlines. */
export const HIGHLIGHT_INKS: Record<HighlightColor, string> = {
  yellow: '#ca8a04',
  green: '#16a34a',
  blue: '#0284c7',
  pink: '#db2777',
};

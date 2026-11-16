'use client';

import { useState } from 'react';

/**
 * A reading preference kept in this browser's localStorage (per device, like the font size has
 * always been): its key, the values it may take, and the one used when nothing valid is stored.
 */
export type Pref<T extends string | number | boolean> = {
  key: string;
  values: readonly T[];
  fallback: T;
};

export const FONT_SIZES = [14, 16, 18, 20, 22, 24] as const;
export const TYPEFACES = ['literata', 'sans', 'hyperlegible'] as const;
export const LINE_SPACINGS = ['tight', 'normal', 'airy'] as const;
export const LINE_WIDTHS = ['narrow', 'medium', 'wide'] as const;
export const PDF_FITS = ['width', 'page'] as const;

export type FontSize = (typeof FONT_SIZES)[number];
export type Typeface = (typeof TYPEFACES)[number];
export type LineSpacing = (typeof LINE_SPACINGS)[number];
export type LineWidth = (typeof LINE_WIDTHS)[number];
export type PdfFit = (typeof PDF_FITS)[number];

export const PREFS = {
  // The key the font size has been stored under since before the other options existed.
  fontSize: { key: 'hmr.fontSize', values: FONT_SIZES, fallback: 18 } as Pref<FontSize>,
  typeface: { key: 'hmr.typeface', values: TYPEFACES, fallback: 'literata' } as Pref<Typeface>,
  lineSpacing: { key: 'hmr.lineSpacing', values: LINE_SPACINGS, fallback: 'normal' } as Pref<LineSpacing>,
  lineWidth: { key: 'hmr.lineWidth', values: LINE_WIDTHS, fallback: 'medium' } as Pref<LineWidth>,
  pdfFit: { key: 'hmr.pdfFit', values: PDF_FITS, fallback: 'width' } as Pref<PdfFit>,
  contentsOpen: { key: 'hmr.contentsOpen', values: [true, false], fallback: true } as Pref<boolean>,
  keepPdfColours: { key: 'hmr.keepPdfColours', values: [false, true], fallback: false } as Pref<boolean>,
};

export function readPref<T extends string | number | boolean>(pref: Pref<T>): T {
  try {
    const stored = localStorage.getItem(pref.key);
    return pref.values.find((v) => String(v) === stored) ?? pref.fallback;
  } catch {
    return pref.fallback;
  }
}

export function writePref<T extends string | number | boolean>(pref: Pref<T>, value: T): void {
  try {
    localStorage.setItem(pref.key, String(value));
  } catch {
    // the choice just won't be remembered
  }
}

/** The preference's value, read once on mount, and a setter that also stores it. */
export function usePref<T extends string | number | boolean>(pref: Pref<T>): [T, (value: T) => void] {
  const [value, setValue] = useState(() => readPref(pref));
  return [
    value,
    (next: T) => {
      setValue(next);
      writePref(pref, next);
    },
  ];
}

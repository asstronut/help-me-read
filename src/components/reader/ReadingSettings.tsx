'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { IconButton } from '@/components/ui/IconButton';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import { cn } from '@/components/ui/cn';
import {
  FONT_SIZES,
  type FontSize,
  type LineSpacing,
  type LineWidth,
  type PdfFit,
  type Typeface,
} from '@/lib/reader/reading-prefs';
import { applyTheme, saveTheme, shownTheme, useShownTheme } from '@/lib/settings/theme-client';
import type { Theme } from '@/lib/types';

// Each swatch wears its own theme's class, so the tokens inside it are that theme's colours.
const THEME_OPTIONS: SegmentOption<Theme>[] = [
  { value: 'light', label: 'Light', className: 'light bg-bg text-ink' },
  { value: 'sepia', label: 'Sepia', className: 'sepia bg-bg text-ink' },
  { value: 'dark', label: 'Dark', className: 'dark bg-bg text-ink' },
];

const sample = (font: string, name: string) => (
  <>
    <span className={cn(font, 'text-lg leading-tight text-ink')}>Ag</span>
    <span className="text-[11px] text-muted">{name}</span>
  </>
);

const TYPEFACE_OPTIONS: SegmentOption<Typeface>[] = [
  { value: 'literata', label: 'Literata', content: sample('font-serif', 'Literata') },
  { value: 'sans', label: 'Sans', content: sample('font-sans', 'Sans') },
  { value: 'hyperlegible', label: 'Atkinson Hyperlegible', content: sample('font-hyperlegible', 'Hyperlegible') },
];

const SPACING_OPTIONS: SegmentOption<LineSpacing>[] = [
  { value: 'tight', label: 'Tight' },
  { value: 'normal', label: 'Normal' },
  { value: 'airy', label: 'Airy' },
];

const WIDTH_OPTIONS: SegmentOption<LineWidth>[] = [
  { value: 'narrow', label: 'Narrow' },
  { value: 'medium', label: 'Medium' },
  { value: 'wide', label: 'Wide' },
];

const FIT_OPTIONS: SegmentOption<PdfFit>[] = [
  { value: 'width', label: 'Fit width' },
  { value: 'page', label: 'Whole page' },
];

/** A caption above its control. The control carries its own name, so the caption is not read out twice. */
function Field({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span aria-hidden="true" className="text-xs text-muted">
        {caption}
      </span>
      {children}
    </div>
  );
}

/** A caption beside its control, as `Field`. */
function Row({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="w-16 shrink-0 text-xs text-muted">
        {caption}
      </span>
      {children}
    </div>
  );
}

/**
 * The theme, saved into the user's settings so the Settings page shows the same. The page changes
 * at once; if the save fails it goes back to the last saved theme and says why. Saves run one
 * after another, so a quick second choice can't be overtaken by the first.
 */
function useThemeChoice() {
  const theme = useShownTheme();
  const [error, setError] = useState<string | null>(null);
  const queue = useRef(Promise.resolve());
  const saved = useRef<Theme | null>(null);
  const latest = useRef(0);

  function choose(next: Theme) {
    saved.current ??= shownTheme();
    applyTheme(next);
    setError(null);
    const n = ++latest.current;
    queue.current = queue.current
      .then(() => saveTheme(next))
      .then(
        () => {
          saved.current = next;
        },
        (e: Error) => {
          if (n !== latest.current) return;
          applyTheme(saved.current ?? next);
          setError(e.message);
        },
      );
  }
  return { theme, choose, error };
}

/**
 * The Aa button and the reading settings it opens: the theme for every book, then the options
 * of the book's format (`children`). A popover under the button on a desktop, a sheet from the
 * bottom on a phone.
 */
export function ReadingSettings({ children }: { children?: ReactNode }) {
  const id = useId();
  const { theme, choose, error } = useThemeChoice();
  return (
    <>
      <IconButton aria-label="Reading settings" popoverTarget={id} className="font-serif text-[17px]">
        Aa
      </IconButton>
      {/* A native popover: it closes on Escape and on a click outside it, and sits above the book. */}
      <div
        id={id}
        popover="auto"
        role="dialog"
        aria-label="Reading settings"
        className={cn(
          'fixed inset-x-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto',
          'rounded-t-[20px] border-t border-rule bg-surface px-5 pt-2.5 pb-7 text-ink shadow-[0_-8px_30px_var(--shadow)]',
          'backdrop:bg-shadow sm:backdrop:bg-transparent',
          'sm:inset-auto sm:top-[72px] sm:right-[72px] sm:w-[340px] sm:rounded-2xl sm:border sm:p-5',
          'sm:shadow-[0_16px_40px_var(--shadow)]',
        )}
      >
        <div className="flex flex-col gap-5 sm:gap-[18px]">
          <div aria-hidden="true" className="mx-auto h-1 w-9 rounded-sm bg-rule sm:hidden" />
          <Field caption="Theme">
            <SegmentedControl label="Theme" variant="cards" options={THEME_OPTIONS} value={theme} onChange={choose} />
          </Field>
          {error && <InlineAlert>{error}</InlineAlert>}
          {children}
        </div>
      </div>
    </>
  );
}

type TypographyProps = {
  typeface: Typeface;
  onTypeface: (typeface: Typeface) => void;
  fontSize: FontSize;
  onFontSize: (size: FontSize) => void;
  lineSpacing: LineSpacing;
  onLineSpacing: (spacing: LineSpacing) => void;
  lineWidth: LineWidth;
  onLineWidth: (width: LineWidth) => void;
};

/** An EPUB's options: its text is set by the reader, so all of it can change. */
export function TypographyOptions(props: TypographyProps) {
  const sizeIndex = FONT_SIZES.indexOf(props.fontSize);
  const stepSize = (step: number) => props.onFontSize(FONT_SIZES[sizeIndex + step]);
  return (
    <>
      <Field caption="Typeface">
        <SegmentedControl
          label="Typeface"
          variant="cards"
          options={TYPEFACE_OPTIONS}
          value={props.typeface}
          onChange={props.onTypeface}
        />
      </Field>
      <Row caption="Size">
        <div role="group" aria-label="Font size" className="flex flex-1 items-center">
          <IconButton
            aria-label="Smaller text"
            disabled={sizeIndex <= 0}
            onClick={() => stepSize(-1)}
            className="font-serif text-sm"
          >
            A
          </IconButton>
          <output className="flex-1 text-center text-[13px] tabular-nums">{props.fontSize} px</output>
          <IconButton
            aria-label="Larger text"
            disabled={sizeIndex >= FONT_SIZES.length - 1}
            onClick={() => stepSize(1)}
            className="font-serif text-[22px]"
          >
            A
          </IconButton>
        </div>
      </Row>
      <Row caption="Spacing">
        <SegmentedControl
          label="Line spacing"
          options={SPACING_OPTIONS}
          value={props.lineSpacing}
          onChange={props.onLineSpacing}
          className="flex-1"
        />
      </Row>
      <Row caption="Width">
        <SegmentedControl
          label="Line width"
          options={WIDTH_OPTIONS}
          value={props.lineWidth}
          onChange={props.onLineWidth}
          className="flex-1"
        />
      </Row>
    </>
  );
}

type PdfProps = {
  fit: PdfFit;
  onFit: (fit: PdfFit) => void;
  keepColours: boolean;
  onKeepColours: (keep: boolean) => void;
};

/** A PDF's options: the page is drawn as it is, so only how it fits and its colours in Dark. */
export function PdfOptions({ fit, onFit, keepColours, onKeepColours }: PdfProps) {
  return (
    <>
      <Row caption="Fit">
        <SegmentedControl label="Page fit" options={FIT_OPTIONS} value={fit} onChange={onFit} className="flex-1" />
      </Row>
      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
        <span>Keep PDF colours in Dark</span>
        <input
          type="checkbox"
          checked={keepColours}
          onChange={(e) => onKeepColours(e.target.checked)}
          className="size-[18px] cursor-pointer accent-ink"
        />
      </label>
      <p className="text-xs leading-normal text-muted">
        A PDF keeps its own font and layout. For font and spacing options, read an EPUB.
      </p>
    </>
  );
}

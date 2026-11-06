import type { Anchor } from '@/lib/types';

/** What the page around a reader can ask of it. */
export type ReaderControls = {
  /** Shows the place an anchor points at (a highlight's). */
  goTo: (anchor: Anchor) => void;
};

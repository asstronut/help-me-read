import type { PdfFit } from './reading-prefs';

/** How long the view must sit still, with no pointer or finger down, for a scroll to count as over. */
export const REST_MS = 150;

/**
 * What the PDF's scrolling is doing. `user` is a hand scroll, and `from` is the scrollTop when it
 * began. `glide` is a button or key turn on its way to page `target`, and `settle` is the Whole
 * page animation onto a page top. Only a hand scroll can start a settle, so the settle's own
 * scrolling never counts as one.
 */
export type Motion =
  | { kind: 'idle' }
  | { kind: 'user'; from: number }
  | { kind: 'glide'; target: number }
  | { kind: 'settle' };

/** `top` is the scrollTop at the last scroll event; `held` is whether a pointer or finger is down. */
export type MotionState = Motion & { top: number; held: boolean };

export type MotionEvent =
  | { type: 'scroll'; top: number }
  /** No scroll event for REST_MS, or the browser said scrolling ended. */
  | { type: 'rest' }
  | { type: 'down' }
  | { type: 'up' }
  | { type: 'turn'; target: number }
  | { type: 'settle' };

export const startingMotion = (top: number): MotionState => ({ kind: 'idle', top, held: false });

/** The next state. A rest while a pointer or finger is down changes nothing; letting go asks again. */
export function nextMotion(state: MotionState, event: MotionEvent): MotionState {
  switch (event.type) {
    case 'scroll':
      return state.kind === 'idle'
        ? { kind: 'user', from: state.top, top: event.top, held: state.held }
        : { ...state, top: event.top };
    case 'rest':
      return state.held ? state : { kind: 'idle', top: state.top, held: false };
    case 'down':
      return { ...state, held: true };
    case 'up':
      return { ...state, held: false };
    case 'turn':
      return { kind: 'glide', target: event.target, top: state.top, held: state.held };
    case 'settle':
      return { kind: 'settle', top: state.top, held: state.held };
  }
}

const SETTLE_MAX_PX = 80;
const SETTLE_VIEW_SHARE = 0.12;

/** Whole page at its fitted size: the fit is Whole page and no − or + zoom is set. */
export const isWholePage = (fit: PdfFit, zoom: number | null) => fit === 'page' && zoom === null;

export type SettleInput = {
  fit: PdfFit;
  /** The zoom picked with − and +; null while the page is fitted. */
  zoom: number | null;
  reducedMotion: boolean;
  /** The scrollTop where the hand scroll began and where it came to rest. */
  from: number;
  end: number;
  viewHeight: number;
  /** The scrollTop that puts each page slot's top at the top of the view; measured only if the rule gets that far. */
  tops: () => readonly number[];
};

/**
 * The scrollTop a hand scroll should ease onto, or null to leave the view where it is. Only Whole
 * page at its fitted size settles, and not with reduced motion. A scroll that ends a little short
 * of or past a page top is drawn onto it, but only if it travelled further than that little
 * itself, so a small scroll from a page top is never pulled back: one long enough to qualify
 * would end too far from the top it started on.
 */
export function settleTarget({ fit, zoom, reducedMotion, from, end, viewHeight, tops }: SettleInput): number | null {
  if (!isWholePage(fit, zoom) || reducedMotion) return null;
  const reach = Math.min(SETTLE_MAX_PX, SETTLE_VIEW_SHARE * viewHeight);
  if (Math.abs(end - from) <= reach) return null;
  let top: number | null = null;
  for (const t of tops()) if (top === null || Math.abs(end - t) < Math.abs(end - top)) top = t;
  if (top === null) return null;
  const off = Math.abs(end - top);
  return off > 0 && off <= reach ? top : null;
}

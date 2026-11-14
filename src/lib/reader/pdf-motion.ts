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

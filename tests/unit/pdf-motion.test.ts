import { expect, test } from 'vitest';
import {
  nextMotion,
  settleTarget,
  startingMotion,
  type MotionEvent,
  type MotionState,
  type SettleInput,
} from '../../src/lib/reader/pdf-motion';

/** Plays the events one after another from a view resting at `top`. */
const play = (events: MotionEvent[], top = 0): MotionState =>
  events.reduce(nextMotion, startingMotion(top));

test('a scroll from rest is a hand scroll that remembers where it began', () => {
  const state = play([
    { type: 'scroll', top: 40 },
    { type: 'scroll', top: 90 },
    { type: 'scroll', top: 150 },
  ], 10);
  expect(state).toMatchObject({ kind: 'user', from: 10, top: 150 });
});

test('coming to rest ends a hand scroll, and the next one starts from where the view stopped', () => {
  const state = play([
    { type: 'scroll', top: 300 },
    { type: 'rest' },
    { type: 'scroll', top: 340 },
  ]);
  expect(state).toMatchObject({ kind: 'user', from: 300, top: 340 });
});

test('a turn glides to its page, and scroll events on the way do not end the glide', () => {
  const state = play([
    { type: 'turn', target: 3 },
    { type: 'scroll', top: 100 },
    { type: 'scroll', top: 200 },
  ]);
  expect(state).toMatchObject({ kind: 'glide', target: 3, top: 200 });
});

test('a second turn during a glide aims at its own page', () => {
  const state = play([
    { type: 'turn', target: 2 },
    { type: 'scroll', top: 100 },
    { type: 'turn', target: 3 },
  ]);
  expect(state).toMatchObject({ kind: 'glide', target: 3 });
});

test('a glide to where the view already is ends with no scroll event at all', () => {
  expect(play([{ type: 'turn', target: 2 }, { type: 'rest' }]).kind).toBe('idle');
});

test('a hand scroll that is cut into by a turn becomes the glide', () => {
  expect(play([{ type: 'scroll', top: 50 }, { type: 'turn', target: 4 }]).kind).toBe('glide');
});

test('the settle is not a hand scroll: its scrolling stays a settle until the view rests', () => {
  const settling = play([{ type: 'scroll', top: 500 }, { type: 'settle' }, { type: 'scroll', top: 600 }]);
  expect(settling).toMatchObject({ kind: 'settle', top: 600 });
  expect(nextMotion(settling, { type: 'rest' }).kind).toBe('idle');
});

test('the view does not come to rest while a pointer or finger is down', () => {
  const held = play([{ type: 'down' }, { type: 'scroll', top: 80 }]);
  expect(nextMotion(held, { type: 'rest' })).toBe(held);
  expect(nextMotion(held, { type: 'rest' }).kind).toBe('user');
});

test('letting go lets the view come to rest', () => {
  const state = play([{ type: 'down' }, { type: 'scroll', top: 80 }, { type: 'up' }, { type: 'rest' }]);
  expect(state).toMatchObject({ kind: 'idle', held: false });
});

test('a press that scrolls nothing leaves the view idle, and its release changes nothing else', () => {
  expect(play([{ type: 'down' }, { type: 'up' }, { type: 'rest' }])).toEqual(startingMotion(0));
});

test('a press during a glide keeps it from ending until the press is released', () => {
  const glide = play([{ type: 'turn', target: 2 }, { type: 'down' }, { type: 'rest' }]);
  expect(glide.kind).toBe('glide');
  expect(nextMotion(nextMotion(glide, { type: 'up' }), { type: 'rest' }).kind).toBe('idle');
});

// The pages of a Whole page view 700px tall: a page top every 708px.
const TOPS = [0, 708, 1416, 2124];
const settle = (change: Partial<SettleInput>) =>
  settleTarget({
    fit: 'page',
    zoom: null,
    reducedMotion: false,
    from: 0,
    end: 0,
    viewHeight: 700,
    tops: () => TOPS,
    ...change,
  });

test('a scroll that stops a little short of a page top settles onto it', () => {
  expect(settle({ from: 0, end: 700 })).toBe(708);
  expect(settle({ from: 0, end: 640 })).toBe(708);
});

test('a scroll that goes a little past a page top settles back onto it', () => {
  expect(settle({ from: 0, end: 716 })).toBe(708);
  expect(settle({ from: 0, end: 780 })).toBe(708);
});

test('a scroll up settles the same way', () => {
  expect(settle({ from: 1416, end: 720 })).toBe(708);
  expect(settle({ from: 1416, end: 690 })).toBe(708);
});

test('a scroll that is already on a page top stays', () => {
  expect(settle({ from: 0, end: 708 })).toBeNull();
});

test('a small scroll from a page top is never pulled back', () => {
  expect(settle({ from: 0, end: 40 })).toBeNull();
  expect(settle({ from: 0, end: 80 })).toBeNull();
  expect(settle({ from: 0, end: 100 })).toBeNull();
  expect(settle({ from: 708, end: 628 })).toBeNull();
  expect(settle({ from: 708, end: 608 })).toBeNull();
});

test('a small scroll that starts just off a page top does not settle either', () => {
  expect(settle({ from: 690, end: 740 })).toBeNull();
  expect(settle({ from: 650, end: 710 })).toBeNull();
});

test('a scroll that stops far from every page top stays where it is', () => {
  expect(settle({ from: 0, end: 400 })).toBeNull();
  expect(settle({ from: 0, end: 1100 })).toBeNull();
});

test('the distance is 80px, or 12% of a view shorter than that allows', () => {
  expect(settle({ from: 0, end: 628 })).toBe(708);
  expect(settle({ from: 0, end: 627 })).toBeNull();
  // 400px tall: 48px.
  expect(settle({ viewHeight: 400, from: 0, end: 660 })).toBe(708);
  expect(settle({ viewHeight: 400, from: 0, end: 659 })).toBeNull();
});

test('only Whole page at its fitted size settles, and not with reduced motion', () => {
  expect(settle({ from: 0, end: 700 })).toBe(708);
  expect(settle({ from: 0, end: 700, fit: 'width' })).toBeNull();
  expect(settle({ from: 0, end: 700, zoom: 1 })).toBeNull();
  expect(settle({ from: 0, end: 700, reducedMotion: true })).toBeNull();
});

test('a view with no pages has nothing to settle onto', () => {
  expect(settle({ from: 0, end: 700, tops: () => [] })).toBeNull();
});

/**
 * The grey that shows behind a quiet button on hover, drawn 6px inside the button so it stays
 * smaller than the 44px area the button answers to. `square` is for a 44px icon button (a 32px
 * square); `row` is for a text button (its full width, 32px tall). `aria-pressed` keeps it on.
 *
 * Hover only for a mouse, like the primary Button: some touch screens claim hover, and the grey
 * would stick after a tap. The button itself takes no background: the grey is a `::before` layer
 * under its content. Every class is written out in full so Tailwind finds it.
 */
const BASE = [
  'relative isolate',
  'before:pointer-events-none before:absolute before:-z-10 before:rounded-lg',
  'before:opacity-0 before:scale-[0.85] before:transition-[opacity,scale] before:duration-150 before:ease-(--ease-out)',
  'motion-reduce:before:transition-opacity',
  '[@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:before:opacity-100',
  '[@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:before:scale-100',
  'aria-pressed:before:opacity-100 aria-pressed:before:scale-100',
].join(' ');

const SHAPES = {
  square: 'before:inset-1.5',
  row: 'before:inset-x-0 before:inset-y-1.5',
} as const;

const TINTS = {
  chip: 'before:bg-chip',
  danger: 'before:bg-danger-tint',
} as const;

export function insetHover(shape: keyof typeof SHAPES, tint: keyof typeof TINTS = 'chip'): string {
  return `${BASE} ${SHAPES[shape]} ${TINTS[tint]}`;
}

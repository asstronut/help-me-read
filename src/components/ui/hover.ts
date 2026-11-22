/**
 * The grey that shows behind a quiet button on hover, drawn 6px inside the button so it stays
 * smaller than the 44px area the button answers to. `square` is for a 44px icon button (a 32px
 * square); `row` is for a text button (its full width, 32px tall). `aria-pressed` keeps it on.
 *
 * Hover only for a mouse, like the primary Button: some touch screens claim hover, and the grey
 * would stick after a tap. A press shows it too, so a tap on a touch screen gets the same grey
 * (in place of the browser's tap highlight). The button itself takes no background: the grey is
 * a `::before` layer under its content. Every class is written out in full so Tailwind finds it.
 */
const BASE = [
  'relative isolate [-webkit-tap-highlight-color:transparent]',
  'before:pointer-events-none before:absolute before:-z-10 before:rounded-lg',
  'before:opacity-0 before:scale-[0.85] before:transition-[opacity,scale] before:duration-150 before:ease-(--ease-out)',
  'motion-reduce:before:transition-opacity',
  '[@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:before:opacity-100',
  '[@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:before:scale-100',
  'not-disabled:active:before:opacity-100 not-disabled:active:before:scale-100',
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

/**
 * The grey that marks the chosen option in a group (a tab, a segment, the current page), drawn
 * inside it like the hover grey so it is never the largest shape around. `cell` is for an option
 * in an outlined bar: 4px in, with 6px corners that follow the bar's 10px ones. `pill` is for a
 * rounded-full link: its full width, 32px tall. Only the chosen option gets these classes.
 */
const CHOSEN_SHAPES = {
  cell: 'before:inset-1 before:rounded-md',
  pill: 'before:inset-x-0 before:inset-y-1.5 before:rounded-full',
} as const;

export function insetChosen(shape: keyof typeof CHOSEN_SHAPES): string {
  return `relative isolate before:pointer-events-none before:absolute before:-z-10 before:bg-chip ${CHOSEN_SHAPES[shape]}`;
}

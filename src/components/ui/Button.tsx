import type { ComponentProps } from 'react';
import { cn } from './cn';
import { insetHover } from './hover';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

/**
 * `regular` is for an action that stands on the page (Continue, Save changes, Choose a book).
 * `compact` is for the actions inside a small card, a popover or a dialog (Cancel / Save,
 * Cancel / Yes, delete): a filled 36px shape with 8px corners, so the two choices read as a pair
 * of the same weight and neither crowds the card. Both answer to the full 44px height.
 */
export type ButtonSize = 'regular' | 'compact';

const BASE = cn(
  'inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 text-sm whitespace-nowrap transition-button',
  'disabled:cursor-default disabled:opacity-50',
);

const REGULAR: Record<ButtonVariant, string> = {
  // Hover and press let a little of the page show through the ink, so it reads greyer in every
  // theme. A press also shrinks the button slightly (not under reduced motion), which is the
  // feedback a touch screen gets, since it has no hover; the tap highlight would fight it.
  primary: cn(
    'rounded-full bg-ink px-5 font-medium text-bg [-webkit-tap-highlight-color:transparent]',
    // Hover only for a mouse: some touch screens claim hover, and the grey would stick after a tap.
    '[@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:bg-ink/85',
    'not-disabled:active:bg-ink/85',
    'not-disabled:motion-safe:active:scale-[0.97]',
  ),
  secondary: 'rounded-full border border-rule px-[18px] text-ink hover:bg-chip',
  // The grey (or the danger tint) is 32px tall inside the 44px button: see `insetHover`.
  quiet: cn('rounded-[10px] px-3.5 text-muted hover:text-ink', insetHover('row')),
  danger: cn('rounded-[10px] px-3.5 text-danger', insetHover('row', 'danger')),
};

const REGULAR_FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

/**
 * The compact fill is a `::before` layer 4px inside the 44px button, like the hover grey of a
 * quiet button. The focus ring goes on that layer too, so it hugs the shape the reader sees.
 * Every class is written out in full so Tailwind finds it.
 */
const COMPACT_BASE = cn(
  'relative isolate px-3.5 font-medium [-webkit-tap-highlight-color:transparent]',
  'before:pointer-events-none before:absolute before:inset-x-0 before:inset-y-1 before:-z-10 before:rounded-lg',
  'before:transition-[background-color,box-shadow] before:duration-150',
  'focus-visible:outline-none focus-visible:before:outline-2 focus-visible:before:outline-offset-2 focus-visible:before:outline-accent',
  'not-disabled:motion-safe:active:scale-[0.97]',
);

const COMPACT: Record<ButtonVariant, string> = {
  primary: cn(
    'text-bg before:bg-ink',
    '[@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:before:bg-ink/85',
    'not-disabled:active:before:bg-ink/85',
  ),
  secondary: cn(
    'text-ink before:bg-chip',
    '[@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:before:bg-rule',
    'not-disabled:active:before:bg-rule',
  ),
  // No fill until hovered: for a lesser action beside a compact pair.
  quiet: cn(
    'text-muted',
    '[@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:text-ink [@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:before:bg-chip',
    'not-disabled:active:before:bg-chip',
  ),
  // The destructive choice in a confirmation: a danger tint with a danger outline.
  danger: cn(
    'text-danger before:bg-danger-tint before:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_40%,transparent)]',
    '[@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:before:shadow-[inset_0_0_0_1px_var(--danger)]',
    'not-disabled:active:before:shadow-[inset_0_0_0_1px_var(--danger)]',
  ),
};

/** Classes for a button-shaped control, for a link that should look like a button. */
export const buttonClasses = (
  variant: ButtonVariant = 'secondary',
  className?: string,
  size: ButtonSize = 'regular',
) =>
  cn(
    BASE,
    size === 'regular' ? cn(REGULAR_FOCUS, REGULAR[variant]) : cn(COMPACT_BASE, COMPACT[variant]),
    className,
  );

type Props = ComponentProps<'button'> & { variant?: ButtonVariant; size?: ButtonSize };

/** A 44px-tall text button. Primary is the one main action in a place; danger deletes. */
export function Button({ variant = 'secondary', size = 'regular', type = 'button', className, ...props }: Props) {
  return <button type={type} className={buttonClasses(variant, className, size)} {...props} />;
}

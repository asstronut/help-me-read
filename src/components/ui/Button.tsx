import type { ComponentProps } from 'react';
import { cn } from './cn';
import { insetHover } from './hover';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
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

/** Classes for a button-shaped control, for a link that should look like a button. */
export const buttonClasses = (variant: ButtonVariant = 'secondary', className?: string) =>
  cn(
    'inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 text-sm whitespace-nowrap transition-button',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:cursor-default disabled:opacity-50',
    VARIANTS[variant],
    className,
  );

type Props = ComponentProps<'button'> & { variant?: ButtonVariant };

/** A 44px-tall text button. Primary is the one main action in a place; danger deletes. */
export function Button({ variant = 'secondary', type = 'button', className, ...props }: Props) {
  return <button type={type} className={buttonClasses(variant, className)} {...props} />;
}

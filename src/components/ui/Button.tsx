import type { ComponentProps } from 'react';
import { cn } from './cn';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'rounded-full bg-ink px-5 font-medium text-bg',
  secondary: 'rounded-full border border-rule px-[18px] text-ink hover:bg-chip',
  quiet: 'rounded-[10px] px-3.5 text-muted hover:bg-chip hover:text-ink',
  danger: 'rounded-[10px] px-3.5 text-danger hover:bg-danger-tint',
};

/** Classes for a button-shaped control, for a link that should look like a button. */
export const buttonClasses = (variant: ButtonVariant = 'secondary', className?: string) =>
  cn(
    'inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 text-sm whitespace-nowrap transition-colors',
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

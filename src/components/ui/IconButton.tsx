import type { ComponentProps } from 'react';
import { cn } from './cn';

type Props = Omit<ComponentProps<'button'>, 'aria-label'> & {
  /** The button's name: an icon has no text, so this is what a screen reader and the tests see. */
  'aria-label': string;
};

/** A 44 × 44px button showing only an icon (pass one from `./icons` as the child). */
export function IconButton({ type = 'button', className, ...props }: Props) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-muted transition-colors',
        'hover:bg-chip hover:text-ink aria-pressed:bg-chip aria-pressed:text-ink',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-default disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

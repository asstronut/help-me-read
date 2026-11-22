import type { ComponentProps } from 'react';
import { cn } from './cn';
import { insetHover } from './hover';

type Props = Omit<ComponentProps<'button'>, 'aria-label'> & {
  /** The button's name: an icon has no text, so this is what a screen reader and the tests see. */
  'aria-label': string;
  /**
   * `quiet` (the default) sits on the page and greys on hover. `floating` sits on top of a picture,
   * such as a book cover, so its icon is drawn on a small disc that shows on any colour under it.
   */
  look?: 'quiet' | 'floating';
};

/** A 44 × 44px button showing only an icon (pass one from `./icons` as the child). */
export function IconButton({ type = 'button', look = 'quiet', className, children, ...props }: Props) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] transition-colors',
        look === 'quiet' &&
          // The grey is a 32px square inside the 44px button, so it never looks bigger than the icon needs.
          cn(insetHover('square'), 'text-muted hover:text-ink aria-pressed:text-ink'),
        look === 'floating' && 'group/icon text-ink [-webkit-tap-highlight-color:transparent]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-default disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {look === 'floating' ? (
        // 32px, like the quiet hover grey, inside the 44px the button answers to.
        <span className="flex size-8 items-center justify-center rounded-full border border-rule bg-surface shadow-[0_2px_8px_var(--shadow)] transition-colors group-active/icon:bg-chip group-aria-expanded/icon:bg-chip [@media(hover:hover)_and_(pointer:fine)]:group-hover/icon:bg-chip">
          {children}
        </span>
      ) : (
        children
      )}
    </button>
  );
}

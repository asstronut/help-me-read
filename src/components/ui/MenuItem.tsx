import type { ComponentProps } from 'react';
import { cn } from './cn';

type Props = ComponentProps<'button'> & {
  /** `danger` for an action that deletes: danger text, a danger tint on hover. */
  tone?: 'default' | 'danger';
};

/**
 * One action in a small menu (the ⋮ menu on a book). Rows are 36px with a mouse, like a desktop
 * menu, and 44px on a touch screen, where a finger needs the room. The hover grey fills the row
 * edge to edge with 8px corners, inside the menu's 6px padding.
 */
export function MenuItem({ tone = 'default', type = 'button', className, ...props }: Props) {
  return (
    <button
      type={type}
      className={cn(
        'flex h-11 w-full shrink-0 cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm whitespace-nowrap transition-colors',
        '[@media(hover:hover)_and_(pointer:fine)]:h-9',
        '[-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
        'disabled:cursor-default disabled:opacity-50',
        // Hover only for a mouse: on some touch screens the grey would stick after a tap.
        tone === 'danger'
          ? 'text-danger not-disabled:active:bg-danger-tint [@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:bg-danger-tint'
          : 'text-ink not-disabled:active:bg-chip [@media(hover:hover)_and_(pointer:fine)]:not-disabled:hover:bg-chip',
        className,
      )}
      {...props}
    />
  );
}

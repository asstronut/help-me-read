import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';
import { cn } from '@/components/ui/cn';

type Props = {
  direction: 'previous' | 'next';
  onClick: () => void;
};

/**
 * A page-turn button running the height of the book at its left or right edge. With a mouse it
 * stays out of sight until the pointer is over the book (the `group` around both edges), so it
 * does not compete with the text; on a touch screen there is no hover, so it always shows.
 */
export function PageTurnEdge({ direction, onClick }: Props) {
  const Icon = direction === 'previous' ? ChevronLeftIcon : ChevronRightIcon;
  return (
    <button
      type="button"
      aria-label={direction === 'previous' ? 'Previous page' : 'Next page'}
      onClick={onClick}
      className={cn(
        'flex w-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-muted transition-opacity',
        '[@media(hover:hover)]:opacity-0 group-hover:opacity-100 hover:text-ink',
        'focus-visible:opacity-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
      )}
    >
      <Icon size={22} />
    </button>
  );
}

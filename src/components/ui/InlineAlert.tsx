import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from './cn';

type Action = { label: string } & ({ onClick: () => void; href?: never } | { href: string; onClick?: never });

type Props = {
  /** What went wrong, in a plain sentence. */
  children: ReactNode;
  /** What the reader can do about it: try again, or go somewhere to fix it. */
  action?: Action;
  className?: string;
};

const ACTION_CLASSES =
  'inline-flex h-11 shrink-0 cursor-pointer items-center rounded-[10px] px-3.5 font-medium text-danger hover:bg-danger-tint focus-visible:outline-2 focus-visible:outline-accent';

/** A calm error in the flow of the page, with at most one action. */
export function InlineAlert({ children, action, className }: Props) {
  return (
    <div
      role="alert"
      className={cn(
        'flex items-center gap-3 rounded-xl bg-danger-tint py-1 pr-1 pl-4 text-sm text-ink',
        // Without an action the padding is even, so the text does not sit off-centre.
        !action && 'py-3 pr-4',
        className,
      )}
    >
      <div className="min-w-0 flex-1">{children}</div>
      {action?.href !== undefined ? (
        <Link href={action.href} className={ACTION_CLASSES}>
          {action.label}
        </Link>
      ) : action ? (
        <button type="button" onClick={action.onClick} className={ACTION_CLASSES}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

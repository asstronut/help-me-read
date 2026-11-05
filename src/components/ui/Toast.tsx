import type { ReactNode } from 'react';
import { cn } from './cn';

type Props = {
  /** The short message, e.g. "Saved to vocab". */
  children: ReactNode;
  /** An optional icon before the message, from `./icons`. */
  icon?: ReactNode;
  /** An optional action at the end, e.g. Undo. */
  action?: { label: string; onClick: () => void };
  className?: string;
};

/**
 * A status pill that reports what just happened. Screen readers announce it politely. Where it
 * floats, and when it goes away, is up to the caller (pass the position in `className`).
 */
export function Toast({ children, icon, action, className }: Props) {
  return (
    <div
      role="status"
      className={cn(
        'flex h-11 w-max max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-rule bg-surface pl-4 text-[13px] text-ink shadow-[0_4px_16px_var(--shadow)]',
        action ? 'pr-2' : 'pr-4',
        className,
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center px-2.5 text-accent hover:underline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

'use client';

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from './cn';

export type SegmentOption<T extends string> = {
  value: T;
  /** The option's name; shown, unless `content` is given. */
  label: string;
  /** Shown in place of the label (the label still names the option). */
  content?: ReactNode;
  className?: string;
};

type Props<T extends string> = {
  /** Names the group, e.g. "Theme" or "Answer using". */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Joined into one bar (the default), or separate cards with a ring around the chosen one. */
  variant?: 'joined' | 'cards';
  className?: string;
};

const NEXT_KEYS = ['ArrowRight', 'ArrowDown'];
const PREVIOUS_KEYS = ['ArrowLeft', 'ArrowUp'];

/**
 * Pick one of a few options, shown side by side. A radio group: Tab reaches the chosen option,
 * the arrow keys move the choice, as with native radio buttons.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  variant = 'joined',
  className,
}: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function onKeyDown(e: KeyboardEvent) {
    const step = NEXT_KEYS.includes(e.key) ? 1 : PREVIOUS_KEYS.includes(e.key) ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (current + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      onKeyDown={disabled ? undefined : onKeyDown}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      className={cn(
        'grid text-[13px]',
        variant === 'joined' ? 'overflow-hidden rounded-[10px] border border-rule' : 'gap-2',
        className,
      )}
    >
      {options.map((o, i) => {
        const checked = i === current;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.content ? o.label : undefined}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'min-w-0 cursor-pointer truncate px-3 text-center transition-colors',
              'focus-visible:outline-2 focus-visible:outline-accent',
              'disabled:cursor-default disabled:opacity-50',
              variant === 'joined' && 'h-11 focus-visible:-outline-offset-2',
              variant === 'joined' && (checked ? 'bg-chip text-ink' : 'text-muted hover:text-ink'),
              // A ring rather than a thicker border, so the chosen card's content doesn't move.
              variant === 'cards' &&
                'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[10px] border border-rule focus-visible:outline-offset-2',
              variant === 'cards' && checked && 'ring-2 ring-accent',
              o.className,
            )}
          >
            {o.content ?? o.label}
          </button>
        );
      })}
    </div>
  );
}

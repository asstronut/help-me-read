'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cn } from './cn';

export type SegmentOption<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  /** Names the group, e.g. "Theme" or "Answer using". */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
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
      className={cn('grid overflow-hidden rounded-[10px] border border-rule text-[13px]', className)}
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
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-11 min-w-0 cursor-pointer truncate px-3 text-center transition-colors',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
              'disabled:cursor-default disabled:opacity-50',
              checked ? 'bg-chip text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

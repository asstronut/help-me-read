'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cn } from './cn';

export type TabOption<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  /** Names the tab list, e.g. "Show". */
  label: string;
  options: readonly TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Ids are `${idPrefix}-tab-${value}`; the one panel the tabs switch is `${idPrefix}-panel`. */
  idPrefix: string;
  className?: string;
};

export const tabId = (idPrefix: string, value: string) => `${idPrefix}-tab-${value}`;
export const tabPanelId = (idPrefix: string) => `${idPrefix}-panel`;

const NEXT_KEYS = ['ArrowRight', 'ArrowDown'];
const PREVIOUS_KEYS = ['ArrowLeft', 'ArrowUp'];

/**
 * Tabs that switch what one panel below them shows (render that panel with `tabPanelId` as its
 * id, `role="tabpanel"` and `aria-labelledby` the chosen tab). Looks like a SegmentedControl,
 * but is a real tab list: Tab reaches the chosen tab, the arrow keys and Home/End move the
 * choice, and the panel follows at once.
 */
export function Tabs<T extends string>({ label, options, value, onChange, idPrefix, className }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function onKeyDown(e: KeyboardEvent) {
    let next: number;
    if (NEXT_KEYS.includes(e.key)) next = (current + 1) % options.length;
    else if (PREVIOUS_KEYS.includes(e.key)) next = (current - 1 + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    else return;
    e.preventDefault();
    onChange(options[next].value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      className={cn('grid overflow-hidden rounded-[10px] border border-rule text-[13px]', className)}
    >
      {options.map((o, i) => {
        const selected = i === current;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, o.value)}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-11 min-w-0 cursor-pointer truncate px-3 text-center transition-colors',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
              selected ? 'bg-chip text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

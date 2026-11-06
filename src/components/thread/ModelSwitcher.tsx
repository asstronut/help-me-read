'use client';

import type { ModelInfo } from '@/lib/ai/models';
import { ChevronDownIcon } from '@/components/ui/icons';

type Props = {
  /** The available models. */
  models: ModelInfo[];
  /** The model for the next message; '' leaves the choice to the server's default. */
  value: string;
  onChange: (modelId: string) => void;
  disabled: boolean;
};

/** Picks the model for the next message: the model's name in small grey text, opening a list. */
export function ModelSwitcher({ models, value, onChange, disabled }: Props) {
  return (
    <label className="relative flex h-11 min-w-0 items-center text-xs text-muted">
      <span className="sr-only">Model</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="field-sizing-content h-11 min-w-0 cursor-pointer appearance-none truncate rounded-lg bg-transparent pr-5 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-60 disabled:hover:text-muted [&_option]:bg-surface [&_option]:text-ink"
      >
        {value === '' && <option value="">Default model</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.tested ? m.label : `${m.label} (not tested)`}
          </option>
        ))}
      </select>
      <ChevronDownIcon size={12} strokeWidth={1.8} className="pointer-events-none absolute right-0.5" />
    </label>
  );
}

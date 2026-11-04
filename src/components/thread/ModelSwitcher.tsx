'use client';

import type { ModelInfo } from '@/lib/ai/models';

type Props = {
  /** The available models. */
  models: ModelInfo[];
  /** The model for the next message; '' leaves the choice to the server's default. */
  value: string;
  onChange: (modelId: string) => void;
  disabled: boolean;
};

/** Picks the model for the next message. */
export function ModelSwitcher({ models, value, onChange, disabled }: Props) {
  return (
    <label className="flex min-w-0 items-center gap-2 text-xs">
      <span className="shrink-0 opacity-70">Model</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="min-w-0 flex-1 rounded border border-foreground/20 bg-background px-1 py-0.5"
      >
        {value === '' && <option value="">Default</option>}
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.tested ? m.label : `${m.label} (not tested)`}
          </option>
        ))}
      </select>
    </label>
  );
}

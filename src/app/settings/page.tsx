'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import type { ModelInfo } from '@/lib/ai/models';
import type { Settings } from '@/lib/settings/settings.server';
import { ACTIONS, THEMES, type Action, type Theme } from '@/lib/types';

type ModelView = ModelInfo & { available: boolean };

const LANGUAGES = ['English', 'Indonesian', 'Spanish', 'French', 'German', 'Japanese', 'Chinese', 'Arabic'];
const THEME_LABELS: Record<Theme, string> = { light: 'Light', dark: 'Dark', sepia: 'Sepia' };
const ACTION_LABELS: Record<Action, string> = {
  translate: 'Translate',
  define: 'Define',
  explain: 'Explain',
  simplify: 'Simplify',
  ask: 'Ask',
};

const money = (usd: number) => `$${usd.toFixed(2)}`;

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [spend, setSpend] = useState(0);
  const [models, setModels] = useState<ModelView[]>([]);
  const [cap, setCap] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([fetch('/api/settings', { signal }), fetch('/api/models', { signal })])
      .then(async ([s, m]) => {
        if (!s.ok || !m.ok) throw new Error('load failed');
        const body = (await s.json()) as { settings: Settings; monthSpendUsd: number };
        const modelList = ((await m.json()) as { models: ModelView[] }).models;
        if (signal.aborted) return;
        const availableIds = new Set(modelList.filter((x) => x.available).map((x) => x.id));
        const actionModels = Object.fromEntries(
          Object.entries(body.settings.actionModels).filter(([, id]) => availableIds.has(id)),
        );
        setSettings({ ...body.settings, actionModels });
        setCap(String(body.settings.monthlyCapUsd));
        setSpend(body.monthSpendUsd);
        setModels(modelList.filter((x) => x.available));
      })
      .catch(() => {
        if (!signal.aborted) setError('Could not load your settings. Please refresh.');
      });
    return () => controller.abort();
  }, []);

  function change(patch: Partial<Settings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    setStatus('idle');
  }

  function chooseModel(action: Action, modelId: string) {
    if (!settings) return;
    const rest = { ...settings.actionModels };
    delete rest[action];
    change({ actionModels: modelId === '' ? rest : { ...rest, [action]: modelId } });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...settings, monthlyCapUsd: Number(cap) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setStatus('idle');
        setError(body.message ?? 'Could not save. Please try again.');
        return;
      }
      const saved = ((await res.json()) as { settings: Settings }).settings;
      setSettings(saved);
      setCap(String(saved.monthlyCapUsd));
      document.documentElement.classList.remove(...THEMES);
      document.documentElement.classList.add(saved.theme);
      setStatus('saved');
    } catch {
      setStatus('idle');
      setError('Could not save. Please try again.');
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <h1 className="flex-1 text-xl font-semibold">Settings</h1>
        <Link href="/library" className="text-sm hover:underline">
          Library
        </Link>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {settings && (
        <form onSubmit={save} className="space-y-6">
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Explanation language</span>
            <input
              list="languages"
              value={settings.explanationLanguage}
              maxLength={40}
              onChange={(e) => change({ explanationLanguage: e.target.value })}
              className="w-full rounded border border-gray-500/40 bg-transparent px-2 py-1"
            />
            <datalist id="languages">
              {LANGUAGES.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </label>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Model for each action</legend>
            {ACTIONS.map((action) => (
              <label key={action} className="flex items-center gap-3 text-sm">
                <span className="w-24 shrink-0">{ACTION_LABELS[action]}</span>
                <select
                  value={settings.actionModels[action] ?? ''}
                  onChange={(e) => chooseModel(action, e.target.value)}
                  className="min-w-0 flex-1 rounded border border-gray-500/40 bg-transparent px-2 py-1"
                >
                  <option value="">Default</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.tested ? m.label : `${m.label} (not tested)`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>

          <div className="space-y-1 text-sm">
            <label className="block space-y-1">
              <span className="font-medium">Monthly spend cap (USD)</span>
              <input
                type="number"
                min={0}
                max={1000}
                step="0.01"
                value={cap}
                onChange={(e) => {
                  setCap(e.target.value);
                  setStatus('idle');
                }}
                className="w-full rounded border border-gray-500/40 bg-transparent px-2 py-1"
              />
            </label>
            <p>{`${money(spend)} of ${money(Number(cap) || 0)} this month`}</p>
          </div>

          <fieldset className="space-y-1 text-sm">
            <legend className="font-medium">Theme</legend>
            <div className="flex gap-4">
              {THEMES.map((t) => (
                <label key={t} className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="theme"
                    value={t}
                    checked={settings.theme === t}
                    onChange={() => change({ theme: t })}
                  />
                  {THEME_LABELS[t]}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={status === 'saving'}
              className="rounded border border-gray-500/40 px-3 py-1 text-sm hover:bg-gray-500/10 disabled:opacity-50"
            >
              Save
            </button>
            {status === 'saved' && (
              <span role="status" className="text-sm">
                Saved
              </span>
            )}
          </div>
        </form>
      )}
    </main>
  );
}

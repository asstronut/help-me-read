'use client';

import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { SiteNav } from '@/components/SiteNav';
import { Button } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { CheckIcon, ChevronDownIcon } from '@/components/ui/icons';
import { InlineAlert } from '@/components/ui/InlineAlert';
import { SegmentedControl, type SegmentOption } from '@/components/ui/SegmentedControl';
import type { ModelInfo } from '@/lib/ai/models';
import type { Settings } from '@/lib/settings/settings.server';
import { applyTheme } from '@/lib/settings/theme-client';
import { ACTIONS, type Action, type Theme } from '@/lib/types';

type ModelView = ModelInfo & { available: boolean };

const LANGUAGES = ['English', 'Indonesian', 'Spanish', 'French', 'German', 'Japanese', 'Chinese', 'Arabic'];
// Each card wears its own theme's class, so the tokens inside it are that theme's colours.
const THEME_OPTIONS: SegmentOption<Theme>[] = [
  { value: 'light', label: 'Light', className: 'light bg-bg text-ink' },
  { value: 'sepia', label: 'Sepia', className: 'sepia bg-bg text-ink' },
  { value: 'dark', label: 'Dark', className: 'dark bg-bg text-ink' },
];
const ACTION_LABELS: Record<Action, string> = {
  translate: 'Translate',
  define: 'Define',
  explain: 'Explain',
  simplify: 'Simplify',
  ask: 'Ask',
};

const money = (usd: number) => `$${usd.toFixed(2)}`;

// A 44px text field or dropdown; each use adds its own side padding.
const FIELD =
  'h-11 rounded-[10px] border border-rule bg-surface text-sm text-ink focus-visible:outline-2 focus-visible:outline-accent';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [spend, setSpend] = useState(0);
  const [models, setModels] = useState<ModelView[]>([]);
  const [cap, setCap] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/me', { signal: controller.signal })
      .then(async (res) => {
        if (res.ok) setEmail(((await res.json()) as { email?: string }).email ?? null);
      })
      .catch(() => undefined); // the email is only shown, so the page works without it
    return () => controller.abort();
  }, []);

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

  async function signOut() {
    setSigningOut(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      // A full navigation, so the root layout renders again without the session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a soft push would keep the signed-in layout
      window.location.href = '/login';
    } catch {
      setSigningOut(false);
      setError('Could not sign out. Please try again.');
    }
  }

  const capUsd = Number(cap) || 0;
  const spentPercent = capUsd > 0 ? Math.min(spend / capUsd, 1) * 100 : spend > 0 ? 100 : 0;

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
      applyTheme(saved.theme);
      setStatus('saved');
    } catch {
      setStatus('idle');
      setError('Could not save. Please try again.');
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-[1040px] flex-col gap-10 px-4 pt-5 pb-16 sm:px-6 sm:pt-7">
      <SiteNav current="Settings" />
      <div className="mx-auto flex w-full max-w-[760px] flex-col">
        <h1 className="mb-2 font-serif text-[28px]">Settings</h1>
        {error && <InlineAlert className="my-2">{error}</InlineAlert>}
        {settings && (
          <form onSubmit={save} className="flex flex-col">
            <Section title="Reading" hint="Theme for every page. Font and spacing live in the Aa menu while reading.">
              <div className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium">Theme</span>
                <SegmentedControl
                  label="Theme"
                  variant="cards"
                  options={THEME_OPTIONS}
                  value={settings.theme}
                  onChange={(theme) => change({ theme })}
                />
              </div>
              <label className="flex flex-col gap-1.5 text-[13px]">
                <span className="font-medium">Explanation language</span>
                <input
                  list="languages"
                  value={settings.explanationLanguage}
                  maxLength={40}
                  onChange={(e) => change({ explanationLanguage: e.target.value })}
                  className={cn(FIELD, 'px-3.5')}
                />
                <datalist id="languages">
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l} />
                  ))}
                </datalist>
                <span className="text-muted">
                  Answers to Translate, Define, Explain and the rest come back in this language.
                </span>
              </label>
            </Section>

            <Section
              title="AI models"
              hint="Pick a model for each action. Models marked “not tested” may give weaker answers."
            >
              <div className="flex flex-col gap-2">
                {ACTIONS.map((action) => (
                  <label key={action} className="flex items-center gap-4 text-sm">
                    <span className="w-[88px] shrink-0">{ACTION_LABELS[action]}</span>
                    <span className="relative flex min-w-0 flex-1">
                      <select
                        value={settings.actionModels[action] ?? ''}
                        onChange={(e) => chooseModel(action, e.target.value)}
                        className={cn(FIELD, 'w-full appearance-none pr-9 pl-3.5')}
                      >
                        <option value="">Default</option>
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.tested ? m.label : `${m.label} (not tested)`}
                          </option>
                        ))}
                      </select>
                      <ChevronDownIcon
                        size={14}
                        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-muted"
                      />
                    </span>
                  </label>
                ))}
              </div>
            </Section>

            <Section title="Spending" hint="AI actions stop when this month reaches the limit.">
              <div className="flex flex-col gap-2">
                <p className="text-sm tabular-nums">{`${money(spend)} of ${money(capUsd)} this month`}</p>
                {/* The line above gives the numbers; the bar only shows them. */}
                <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-[3px] bg-rule">
                  <div
                    className={cn('h-full', spend >= capUsd ? 'bg-danger' : 'bg-ink')}
                    style={{ width: `${spentPercent}%` }}
                  />
                </div>
              </div>
              <label className="flex flex-col gap-1.5 text-[13px]">
                <span className="font-medium">Monthly limit (USD)</span>
                <span className="relative flex max-w-[200px]">
                  <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-sm text-muted">
                    $
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step="0.01"
                    inputMode="decimal"
                    value={cap}
                    onChange={(e) => {
                      setCap(e.target.value);
                      setStatus('idle');
                    }}
                    className={cn(FIELD, 'w-full pr-3.5 pl-7')}
                  />
                </span>
              </label>
            </Section>

            <Section title="Account" hint={email ?? ''} last>
              <div>
                <Button onClick={() => void signOut()} disabled={signingOut}>
                  Sign out
                </Button>
              </div>
            </Section>

            <div className="sticky bottom-0 flex items-center justify-end gap-4 border-t border-rule bg-bg py-4">
              {status === 'saved' && (
                <span role="status" className="flex items-center gap-1.5 text-[13px] text-muted">
                  <CheckIcon size={14} />
                  Saved
                </span>
              )}
              <Button type="submit" variant="primary" disabled={status === 'saving'}>
                Save changes
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}

/** One group of settings: its name and a line about it on the left, the controls on the right. */
function Section({
  title,
  hint,
  last = false,
  children,
}: {
  title: string;
  hint: string;
  last?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn('flex flex-wrap gap-x-12 gap-y-4 py-7', !last && 'border-b border-rule')}
    >
      <div className="flex flex-[1_1_200px] flex-col gap-1">
        <h2 id={id} className="text-[15px] font-medium">
          {title}
        </h2>
        <p className="text-[13px] leading-normal break-words text-muted">{hint}</p>
      </div>
      <div className="flex min-w-0 flex-[2_1_360px] flex-col gap-5">{children}</div>
    </section>
  );
}

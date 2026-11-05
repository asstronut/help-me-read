'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';

// A 44px text field, as on the Settings page.
const FIELD =
  'h-11 rounded-[10px] border border-rule bg-surface px-3.5 text-sm font-normal text-ink focus-visible:outline-2 focus-visible:outline-accent';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setMessage('');
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json: { message?: string } = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setMessage(json.message ?? 'Sign-in failed');
      return;
    }
    if (body.magicLink) setMessage(json.message ?? 'Check your email');
    // A full navigation, so the root layout re-renders with the signed-in user's theme.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a soft push would keep the layout rendered without a session
    else window.location.href = '/library';
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send({ email, password });
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-4 py-10">
      <span className="font-serif text-xl italic">help me read</span>
      <div className="flex flex-col gap-6">
        <h1 className="font-serif text-[28px]">Sign in</h1>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD}
            />
          </label>
          <div className="mt-2 flex flex-col gap-2">
            <Button type="submit" variant="primary" disabled={busy}>
              Sign in
            </Button>
            <Button disabled={busy || email === ''} onClick={() => void send({ email, magicLink: true })}>
              Email me a link
            </Button>
          </div>
          {message && (
            <p role="status" className="text-sm text-muted">
              {message}
            </p>
          )}
        </form>
      </div>
    </main>
  );
}

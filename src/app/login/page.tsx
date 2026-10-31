'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function LoginPage() {
  const router = useRouter();
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
    else router.push('/library');
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send({ email, password });
  }

  return (
    <main className="mx-auto w-full max-w-sm p-6">
      <h1 className="mb-4 text-xl font-semibold">Sign in</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded border px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded border px-3 py-2"
          />
        </label>
        <button type="submit" disabled={busy} className="rounded bg-black px-3 py-2 text-white">
          Sign in
        </button>
        <button
          type="button"
          disabled={busy || email === ''}
          onClick={() => void send({ email, magicLink: true })}
          className="rounded border px-3 py-2"
        >
          Email me a link
        </button>
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
      </form>
    </main>
  );
}

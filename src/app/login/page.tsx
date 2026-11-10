'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { InlineAlert } from '@/components/ui/InlineAlert';

// A 44px text field, as on the Settings page.
const FIELD =
  'h-11 rounded-[10px] border border-rule bg-surface px-3.5 text-sm font-normal text-ink transition-shadow hover:border-muted/60 focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--accent-tint)] focus-visible:outline-none';

const LABEL = 'flex flex-col gap-1.5 text-[13px] font-medium';

type Pending = 'password' | 'link' | null;
type Outcome = { kind: 'error' | 'sent'; text: string } | null;

function Wordmark({ className }: { className?: string }) {
  return <span className={`font-serif text-xl italic ${className ?? ''}`}>help me read</span>;
}

const PASSAGE_MARK = 'bg-accent-tint box-decoration-clone underline decoration-accent';

const ACTIONS = ['Translate', 'Define', 'Explain', 'Ask'];

/** The left half on a wide screen: a line being read the way the reader reads it. */
function ReadingSample() {
  return (
    <aside className="m-3 hidden flex-col justify-between rounded-3xl bg-panel p-12 lg:flex xl:p-16">
      <Wordmark />
      <figure className="flex max-w-[30rem] flex-col gap-8">
        <blockquote className="font-serif text-[34px] leading-[1.32] tracking-[-0.01em] text-balance">
          Books must be read as{' '}
          <mark className={`rounded-[3px] px-1 text-ink decoration-2 underline-offset-[7px] ${PASSAGE_MARK}`}>
            deliberately and reservedly
          </mark>{' '}
          as they were written.
        </blockquote>
        <figcaption className="-mt-3 flex items-center gap-3 font-serif text-[15px] text-muted italic">
          <span aria-hidden="true" className="h-px w-8 bg-accent" />
          <span>
            Henry David Thoreau, <cite>Walden</cite>
          </span>
        </figcaption>
        <div
          aria-hidden="true"
          className="flex flex-col gap-2.5 rounded-xl border border-l-2 border-rule border-l-accent bg-surface px-5 py-4 shadow-[0_8px_24px_var(--shadow)]"
        >
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-[11px] font-medium tracking-[0.08em] text-accent uppercase">Explain</span>
            <span className={`rounded-[3px] px-1 font-serif text-[15px] italic underline-offset-4 ${PASSAGE_MARK}`}>
              deliberately and reservedly
            </span>
          </div>
          <p className="text-sm leading-relaxed text-ink">
            At the writer&rsquo;s own pace: slowly, and holding judgement back until the sentence has finished speaking.
          </p>
        </div>
      </figure>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="font-serif text-[17px] text-ink">Select a passage, then pick one.</p>
        <ul aria-label="Actions" className="flex gap-1.5 text-[13px] font-medium text-ink">
          {ACTIONS.map((action) => (
            <li key={action} className="rounded-full border border-rule bg-surface px-3 py-1.5">
              {action}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [pending, setPending] = useState<Pending>(null);
  const busy = pending !== null;

  async function send(body: Record<string, unknown>) {
    setPending(body.magicLink ? 'link' : 'password');
    setOutcome(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json: { message?: string } = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPending(null);
      setOutcome({ kind: 'error', text: json.message ?? 'Sign-in failed' });
      return;
    }
    if (body.magicLink) {
      setPending(null);
      setOutcome({ kind: 'sent', text: json.message ?? 'Check your email' });
      return;
    }
    // A full navigation, so the root layout re-renders with the signed-in user's theme.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a soft push would keep the layout rendered without a session
    window.location.href = '/library';
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send({ email, password });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <label className={LABEL}>
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
      <label className={LABEL}>
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={FIELD}
        />
      </label>
      {outcome?.kind === 'error' && <InlineAlert>{outcome.text}</InlineAlert>}
      <Button type="submit" variant="primary" disabled={busy} className="mt-2">
        {pending === 'password' ? 'Signing in…' : 'Sign in'}
      </Button>
      <div aria-hidden="true" className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-rule" />
        or
        <span className="h-px flex-1 bg-rule" />
      </div>
      <Button disabled={busy || email === ''} onClick={() => void send({ email, magicLink: true })}>
        {pending === 'link' ? 'Sending…' : 'Email me a link'}
      </Button>
      {outcome?.kind === 'sent' ? (
        <p role="status" className="rounded-xl bg-accent-tint px-4 py-3 text-sm text-ink">
          {outcome.text}
        </p>
      ) : (
        <p className="text-center text-[13px] text-muted">No password needed. The link signs you in once.</p>
      )}
    </form>
  );
}

const Heading = () => (
  <header className="flex flex-col gap-2">
    <h1 className="font-serif text-[32px] leading-tight tracking-[-0.01em]">Sign in</h1>
    <p className="text-sm text-muted">Your library is where you left it.</p>
  </header>
);

export default function LoginPage() {
  return (
    <div className="grid flex-1 lg:grid-cols-2">
      <ReadingSample />
      <main className="flex flex-col px-5 py-8 sm:px-8 lg:py-12">
        <Wordmark className="lg:hidden" />
        <div className="mx-auto flex w-full max-w-[22rem] flex-1 flex-col justify-center gap-8 py-10">
          <Heading />
          <SignInForm />
        </div>
      </main>
    </div>
  );
}

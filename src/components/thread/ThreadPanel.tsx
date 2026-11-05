'use client';

import { Chat, useChat } from '@ai-sdk/react';
import { APICallError, DefaultChatTransport, type UIMessage } from 'ai';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ModelInfo } from '@/lib/ai/models';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ArrowUpIcon, CloseIcon, RefreshIcon } from '@/components/ui/icons';
import type { Action, ContextScope, ReaderSelection } from '@/lib/types';
import { MessageView } from './MessageView';
import { ModelSwitcher } from './ModelSwitcher';

type Props = {
  onClose: () => void;
  /** A new thread (and its highlight) has been saved. */
  onCreated?: () => void;
  /** The thread was deleted with its highlight. */
  onDeleted?: (highlightId: string) => void;
} & (
  | { threadId: string; action?: never; selection?: never }
  | { threadId: null; action: Action; selection: ReaderSelection }
);

type ThreadMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  modelId: string | null;
  status: 'complete' | 'failed';
};
type ModelOption = ModelInfo & { available: boolean };
/** Only the new turn goes to the server; it rebuilds the history itself. */
type ChatRequest = { text?: string; modelId?: string; reask?: true };
type ThreadUIMessage = UIMessage<{ modelId: string }>;
type Problem = { message: string; overCap: boolean };

const TITLES: Record<Action, string> = {
  translate: 'Translate',
  define: 'Define',
  explain: 'Explain',
  simplify: 'Simplify',
  ask: 'Ask',
};

const transport = new DefaultChatTransport<ThreadUIMessage>({
  prepareSendMessagesRequest: ({ body }) => {
    const { threadId, ...request } = body as ChatRequest & { threadId: string };
    return { api: `/api/threads/${threadId}/chat`, body: request };
  },
});

const textOf = (message: ThreadUIMessage) =>
  message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('');

async function messageOf(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}

type Created = { threadId: string; highlightId: string } | { problem: string };

/** Never rejects: any failure comes back as a problem to show. */
async function createThread(
  action: Action,
  selection: ReaderSelection,
  scope: ContextScope,
): Promise<Created> {
  const problem = 'Could not start this thread.';
  try {
    const res = await fetch('/api/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bookId: selection.bookId, action, selection, scope }),
    });
    if (!res.ok) return { problem: await messageOf(res, problem) };
    const body = (await res.json()) as { threadId?: unknown; highlightId?: unknown };
    return typeof body.threadId === 'string' && typeof body.highlightId === 'string'
      ? { threadId: body.threadId, highlightId: body.highlightId }
      : { problem };
  } catch {
    return { problem };
  }
}

type Stored = {
  action: Action;
  scope: ContextScope;
  highlightId: string;
  quote: string;
  messages: ThreadMessage[];
};

/** The thread as the server saved it, or null when it cannot be loaded. Never rejects. */
async function loadThread(threadId: string): Promise<Stored | null> {
  try {
    const res = await fetch(`/api/threads/${threadId}`);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      thread?: { action?: unknown; scope?: unknown; highlightId?: unknown; quote?: unknown };
      messages?: unknown;
    };
    const { action, scope, highlightId, quote } = body.thread ?? {};
    if (
      typeof action !== 'string' ||
      !(action in TITLES) ||
      typeof highlightId !== 'string' ||
      !Array.isArray(body.messages)
    ) {
      return null;
    }
    return {
      action: action as Action,
      scope: scope === 'book' ? 'book' : 'page',
      highlightId,
      quote: typeof quote === 'string' ? quote : '',
      messages: body.messages as ThreadMessage[],
    };
  } catch {
    return null;
  }
}

const LOAD_PROBLEM: Problem = { message: 'Could not load this thread.', overCap: false };
const DELETE_PROBLEM: Problem = { message: 'Could not delete this thread.', overCap: false };

/** Deletes the thread's highlight, which takes the thread and its messages with it. Never rejects. */
async function deleteHighlight(highlightId: string): Promise<boolean> {
  try {
    return (await fetch(`/api/highlights/${highlightId}`, { method: 'DELETE' })).ok;
  } catch {
    return false;
  }
}

/** A refused chat request, read from the server's `{ message }`. */
function describe(error: APICallError): Problem {
  let message = 'The answer could not be fetched.';
  try {
    const body = JSON.parse(error.responseBody ?? '') as { message?: unknown };
    if (typeof body.message === 'string') message = body.message;
  } catch {}
  return { message, overCap: error.statusCode === 402 };
}

/** A thread beside the reader (a bottom sheet on a phone): answers stream in, with follow-ups, re-ask and retry. */
export function ThreadPanel(props: Props) {
  const { onClose, onCreated, onDeleted } = props;
  const [threadId, setThreadId] = useState(props.threadId);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [action, setAction] = useState<Action | null>(props.action ?? null);
  /** The selected text the thread is about. */
  const [quote, setQuote] = useState(props.selection?.text ?? '');
  /** How much of the book the thread's answers were given: the page, or the whole book. */
  const [scope, setScope] = useState<ContextScope>('page');
  const [thread, setThread] = useState<ThreadMessage[]>([]);
  /** False until a reopened thread's messages have loaded. */
  const [loaded, setLoaded] = useState(props.threadId === null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  /** Set while a request is in flight: nothing else may be sent on the thread until it settles. */
  const [pending, setPending] = useState<{ question: string | null } | null>(() =>
    props.threadId === null && props.action !== 'ask' ? { question: null } : null,
  );
  const [problem, setProblem] = useState<Problem | null>(null);
  const [draft, setDraft] = useState('');
  const [wholeBook, setWholeBook] = useState(false);

  const [chat] = useState(() => new Chat<ThreadUIMessage>({ transport }));
  const { messages: live, setMessages } = useChat({ chat });

  const answers = thread.filter((m) => m.role === 'assistant');
  const latest = answers.at(-1);
  const available = models.filter((m) => m.available);
  const fallbackModel = available.some((m) => m.id === latest?.modelId) ? latest!.modelId! : '';
  const modelId = picked ?? fallbackModel;
  const busy = pending !== null || !loaded;

  /** Replaces the panel's messages with what the server saved. */
  async function reload(id: string) {
    const stored = await loadThread(id);
    if (!stored) {
      setProblem(LOAD_PROBLEM);
      return;
    }
    keep(stored);
  }

  /** Shows a thread as the server saved it. */
  function keep(stored: Stored) {
    setAction(stored.action);
    setScope(stored.scope);
    setQuote(stored.quote);
    setHighlightId(stored.highlightId);
    setThread(stored.messages);
    setLoaded(true);
  }

  /** Sends one turn and, once the stream settles, keeps what the server saved. */
  async function send(id: string, request: ChatRequest, question: string | null) {
    setProblem(null);
    setPending({ question });
    try {
      await settle(id, request, question);
    } catch {
      setProblem({ message: 'Something went wrong. Try again.', overCap: false });
    } finally {
      setMessages([]);
      setPending(null);
    }
  }

  async function settle(id: string, request: ChatRequest, question: string | null) {
    await chat.sendMessage({ text: question ?? '' }, { body: { threadId: id, ...request } });
    const answer = chat.lastMessage;
    const answerModel = answer?.role === 'assistant' ? answer.metadata?.modelId : undefined;
    if (chat.error && APICallError.isInstance(chat.error)) {
      // Refused before anything was saved (over the cap, unknown model, …): the question comes back.
      setProblem(describe(chat.error));
      if (question) setDraft(question);
    } else if (answer && answerModel) {
      const status = chat.status === 'error' ? 'failed' : 'complete';
      setThread((prev) => [
        ...prev,
        ...(question
          ? [
              {
                id: `${answer.id}-q`,
                role: 'user' as const,
                content: question,
                modelId: null,
                status: 'complete' as const,
              },
            ]
          : []),
        { id: answer.id, role: 'assistant', content: textOf(answer), modelId: answerModel, status },
      ]);
    } else {
      // The stream broke before the answer started; the server saved the turn as failed.
      await reload(id);
    }
  }

  /** Asks for a new thread's first answer, or shows why the thread could not be created. */
  async function begin(created: Created, question: string | null) {
    if ('problem' in created) {
      setProblem({ message: created.problem, overCap: false });
      if (question) setDraft(question);
      setPending(null);
      return;
    }
    setThreadId(created.threadId);
    setHighlightId(created.highlightId);
    onCreated?.();
    await send(created.threadId, question === null ? {} : { text: question }, question);
  }

  // Runs once per panel: Strict Mode's second effect pass must not create a second thread.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    fetch('/api/models')
      .then((res) => (res.ok ? (res.json() as Promise<{ models: ModelOption[] }>) : { models: [] }))
      .then((body) => setModels(body.models), () => undefined);
    if (props.threadId !== null) {
      void loadThread(props.threadId).then((stored) => {
        if (stored) keep(stored);
        else setProblem(LOAD_PROBLEM);
      });
    } else if (props.action !== 'ask') {
      void createThread(props.action, props.selection, 'page').then((c) => begin(c, null));
    }
  });

  const model = modelId || undefined;
  const label = (id: string | null) => models.find((m) => m.id === id)?.label ?? id;

  function onAsk(e: FormEvent) {
    e.preventDefault();
    const question = draft.trim();
    if (!question || busy || props.threadId !== null) return;
    setDraft('');
    setProblem(null);
    setPending({ question });
    const chosen: ContextScope = wholeBook ? 'book' : 'page';
    setScope(chosen);
    void createThread(props.action, props.selection, chosen).then((c) => begin(c, question));
  }

  function onFollowUp(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy || !threadId) return;
    setDraft('');
    void send(threadId, { text, modelId: model }, text);
  }

  async function confirmDelete() {
    if (!highlightId) return;
    setDeleting(true);
    setProblem(null);
    if (await deleteHighlight(highlightId)) {
      onDeleted?.(highlightId);
      return;
    }
    setProblem(DELETE_PROBLEM);
    setDeleting(false);
    setConfirmingDelete(false);
  }

  const reask = () => {
    if (threadId && !busy) void send(threadId, { reask: true, modelId: model }, null);
  };

  const streaming = live.findLast((m) => m.role === 'assistant');
  const composing = action === 'ask' && threadId === null;
  // A non-Ask thread whose first answer never arrived (refused, or reopened that way).
  const unanswered = loaded && threadId !== null && action !== 'ask' && answers.length === 0;

  return (
    <aside
      aria-label="Thread"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[70dvh] flex-col rounded-t-2xl border-t border-rule bg-panel font-sans text-ink shadow-[0_-8px_24px_var(--shadow)] md:inset-x-auto md:top-0 md:right-0 md:h-dvh md:w-[420px] md:rounded-none md:border-t-0 md:border-l md:shadow-none"
    >
      <header className="flex items-center justify-between gap-2 py-2 pr-2 pl-5 md:pt-4 md:pr-4">
        <h2 className="text-[11px] font-normal tracking-[0.1em] text-muted uppercase">
          {action ? TITLES[action] : 'Thread'}
        </h2>
        <div className="flex items-center">
          {highlightId && !confirmingDelete && (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)} disabled={busy} className="text-[13px]">
              Delete thread
            </Button>
          )}
          <IconButton aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
      </header>
      {confirmingDelete && (
        <div className="mx-4 mb-2 flex flex-wrap items-center justify-between gap-x-2 rounded-xl bg-danger-tint py-1 pr-1 pl-4 text-sm">
          <span>Delete this conversation?</span>
          <div className="flex">
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={deleting} className="font-medium">
              Yes, delete
            </Button>
            <Button variant="quiet" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-5 pt-1 pb-5">
        {quote && (
          <blockquote className="line-clamp-6 font-serif text-[22px] leading-[1.35] break-words">
            “{quote}”
          </blockquote>
        )}
        {thread.map((m) =>
          m.role === 'user' ? (
            <p key={m.id} className="max-w-[85%] self-end rounded-2xl bg-chip px-3.5 py-2 text-sm break-words">
              {m.content}
            </p>
          ) : (
            <MessageView
              key={m.id}
              content={m.content}
              modelLabel={label(m.modelId)}
              failed={m.status === 'failed'}
            >
              {m === latest && (
                <Button onClick={reask} disabled={busy} className="text-[13px]">
                  <RefreshIcon size={14} />
                  {m.status === 'failed' ? 'Retry' : 'Re-ask'}
                </Button>
              )}
            </MessageView>
          ),
        )}
        {pending?.question && (
          <p className="max-w-[85%] self-end rounded-2xl bg-chip px-3.5 py-2 text-sm break-words">
            {pending.question}
          </p>
        )}
        {pending && streaming && (
          <MessageView
            content={textOf(streaming)}
            modelLabel={label(streaming.metadata?.modelId ?? null)}
            failed={false}
          />
        )}
        {pending && !streaming && <p className="text-sm text-muted">Thinking…</p>}
        {problem && (
          <div role="alert" className="flex flex-col gap-1 text-sm text-red-700">
            <p>{problem.message}</p>
            {problem.overCap && (
              <Link href="/settings" className="underline">
                Settings
              </Link>
            )}
          </div>
        )}
        {unanswered && !busy && (
          <Button onClick={reask} className="self-start text-[13px]">
            <RefreshIcon size={14} />
            Retry
          </Button>
        )}
      </div>

      {composing ? (
        <footer className="flex flex-col gap-2 border-t border-rule p-3">
          <ModelSwitcher models={available} value={modelId} onChange={setPicked} disabled />
          <form onSubmit={onAsk} className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Question
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                className="rounded border border-foreground/20 p-2"
              />
            </label>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={wholeBook} onChange={(e) => setWholeBook(e.target.checked)} />
                Use whole book
              </label>
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
              >
                Ask
              </button>
            </div>
          </form>
        </footer>
      ) : (
        <footer className="flex flex-col px-4 pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:pb-3">
          {!unanswered && (
            <form
              onSubmit={onFollowUp}
              className="flex items-center gap-2 rounded-[14px] border border-rule bg-surface p-1 pl-3.5 focus-within:outline-2 focus-within:outline-accent"
            >
              <label className="sr-only" htmlFor="thread-follow-up">
                Follow-up
              </label>
              <input
                id="thread-follow-up"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask a follow-up…"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-ink outline-none placeholder:text-muted"
              />
              <button
                type="submit"
                aria-label="Send"
                disabled={busy || !draft.trim() || !threadId}
                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-[10px] bg-ink text-bg transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-40"
              >
                <ArrowUpIcon size={16} strokeWidth={1.8} />
              </button>
            </form>
          )}
          <div className="flex items-center justify-between gap-3 text-xs text-muted">
            <ModelSwitcher models={available} value={modelId} onChange={setPicked} disabled={busy} />
            <span className="shrink-0">Context: {scope === 'book' ? 'whole book' : 'this page'}</span>
          </div>
        </footer>
      )}
    </aside>
  );
}

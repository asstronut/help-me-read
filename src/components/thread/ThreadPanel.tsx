'use client';

import { Chat, useChat } from '@ai-sdk/react';
import { APICallError, DefaultChatTransport, type UIMessage } from 'ai';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ModelInfo } from '@/lib/ai/models';
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

type Stored = { action: Action; highlightId: string; messages: ThreadMessage[] };

/** The thread as the server saved it, or null when it cannot be loaded. Never rejects. */
async function loadThread(threadId: string): Promise<Stored | null> {
  try {
    const res = await fetch(`/api/threads/${threadId}`);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      thread?: { action?: unknown; highlightId?: unknown };
      messages?: unknown;
    };
    const action = body.thread?.action;
    const highlightId = body.thread?.highlightId;
    if (
      typeof action !== 'string' ||
      !(action in TITLES) ||
      typeof highlightId !== 'string' ||
      !Array.isArray(body.messages)
    ) {
      return null;
    }
    return { action: action as Action, highlightId, messages: body.messages as ThreadMessage[] };
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
    setAction(stored.action);
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
        if (!stored) return setProblem(LOAD_PROBLEM);
        setAction(stored.action);
        setHighlightId(stored.highlightId);
        setThread(stored.messages);
        setLoaded(true);
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
    void createThread(props.action, props.selection, wholeBook ? 'book' : 'page').then((c) =>
      begin(c, question),
    );
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
      className="fixed inset-x-0 bottom-0 z-40 flex h-[70dvh] flex-col border-t border-black/10 bg-white text-black shadow-lg md:inset-x-auto md:top-0 md:right-0 md:h-dvh md:w-[420px] md:border-t-0 md:border-l"
    >
      <header className="flex items-center justify-between gap-2 border-b border-black/10 px-3 py-2">
        <h2 className="text-sm font-semibold">{action ? TITLES[action] : 'Thread'}</h2>
        <div className="flex gap-1">
          {highlightId && !confirmingDelete && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              className="rounded px-2 py-1 text-sm text-red-600 hover:bg-black/5"
            >
              Delete thread
            </button>
          )}
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm hover:bg-black/5">
            Close
          </button>
        </div>
      </header>
      {confirmingDelete && (
        <div className="flex items-center justify-between gap-2 border-b border-black/10 bg-red-50 px-3 py-2 text-sm">
          <span>Delete this conversation?</span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => void confirmDelete()}
              disabled={deleting}
              className="rounded bg-red-600 px-2 py-1 text-white"
            >
              Yes, delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              className="rounded px-2 py-1 hover:bg-black/5"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {thread.map((m) =>
          m.role === 'user' ? (
            <p key={m.id} className="self-end rounded-lg bg-black/5 px-3 py-2 text-sm break-words">
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
                <button
                  type="button"
                  onClick={reask}
                  disabled={busy}
                  className="rounded border border-black/20 px-2 py-0.5 text-xs disabled:opacity-50"
                >
                  {m.status === 'failed' ? 'Retry' : 'Re-ask'}
                </button>
              )}
            </MessageView>
          ),
        )}
        {pending?.question && (
          <p className="self-end rounded-lg bg-black/5 px-3 py-2 text-sm break-words">{pending.question}</p>
        )}
        {pending && streaming && (
          <MessageView
            content={textOf(streaming)}
            modelLabel={label(streaming.metadata?.modelId ?? null)}
            failed={false}
          />
        )}
        {pending && !streaming && <p className="text-sm opacity-60">Thinking…</p>}
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
          <button
            type="button"
            onClick={reask}
            className="self-start rounded border border-black/20 px-2 py-0.5 text-xs"
          >
            Retry
          </button>
        )}
      </div>

      <footer className="flex flex-col gap-2 border-t border-black/10 p-3">
        <ModelSwitcher
          models={available}
          value={modelId}
          onChange={setPicked}
          disabled={busy || composing}
        />
        {composing ? (
          <form onSubmit={onAsk} className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Question
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={3}
                className="rounded border border-black/20 p-2"
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
                className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                Ask
              </button>
            </div>
          </form>
        ) : (
          !unanswered && (
            <form onSubmit={onFollowUp} className="flex gap-2">
              <label className="sr-only" htmlFor="thread-follow-up">
                Follow-up
              </label>
              <input
                id="thread-follow-up"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Ask a follow-up"
                className="min-w-0 flex-1 rounded border border-black/20 px-2 py-1 text-sm"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim() || !threadId}
                className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                Send
              </button>
            </form>
          )
        )}
      </footer>
    </aside>
  );
}

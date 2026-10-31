'use client';

import { Chat, useChat } from '@ai-sdk/react';
import { APICallError, DefaultChatTransport, type UIMessage } from 'ai';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ModelInfo } from '@/lib/ai/models';
import type { Action, ContextScope, ReaderSelection } from '@/lib/types';
import { MessageView } from './MessageView';
import { ModelSwitcher } from './ModelSwitcher';

type Props = { onClose: () => void } & (
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

type Created = { threadId: string } | { problem: string };

async function createThread(
  action: Action,
  selection: ReaderSelection,
  scope: ContextScope,
): Promise<Created> {
  const res = await fetch('/api/threads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ bookId: selection.bookId, action, selection, scope }),
  }).catch(() => null);
  if (!res) return { problem: 'Could not start this thread.' };
  if (!res.ok) return { problem: await messageOf(res, 'Could not start this thread.') };
  return (await res.json()) as { threadId: string };
}

function describe(error: Error): Problem {
  if (!APICallError.isInstance(error)) {
    return { message: 'The answer stopped before it started.', overCap: false };
  }
  let message = 'The answer could not be fetched.';
  try {
    const body = JSON.parse(error.responseBody ?? '') as { message?: unknown };
    if (typeof body.message === 'string') message = body.message;
  } catch {}
  return { message, overCap: error.statusCode === 402 };
}

/** A thread beside the reader (a bottom sheet on a phone): answers stream in, with follow-ups, re-ask and retry. */
export function ThreadPanel(props: Props) {
  const { onClose } = props;
  const [threadId, setThreadId] = useState(props.threadId);
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

  /** Sends one turn and, once the stream settles, keeps what the server saved. */
  async function send(id: string, request: ChatRequest, question: string | null) {
    setProblem(null);
    setPending({ question });
    await chat.sendMessage({ text: question ?? '' }, { body: { threadId: id, ...request } });
    const answer = chat.lastMessage;
    const answerModel = answer?.role === 'assistant' ? answer.metadata?.modelId : undefined;
    if (answer && answerModel) {
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
      // Refused before an answer started, so nothing was saved.
      if (chat.error) setProblem(describe(chat.error));
      if (question) setDraft(question);
    }
    setMessages([]);
    setPending(null);
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
      fetch(`/api/threads/${props.threadId}`).then(async (res) => {
        if (!res.ok) {
          setProblem({ message: await messageOf(res, 'Could not open this thread.'), overCap: false });
          return;
        }
        const body = (await res.json()) as { thread: { action: Action }; messages: ThreadMessage[] };
        setAction(body.thread.action);
        setThread(body.messages);
        setLoaded(true);
      }, () => setProblem({ message: 'Could not open this thread.', overCap: false }));
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
        <button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm hover:bg-black/5">
          Close
        </button>
      </header>

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

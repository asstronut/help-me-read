import { expect } from 'vitest';
import { apiClient } from './api-client';
import { OWNER } from './users';

export type Api = ReturnType<typeof apiClient>;
export type Segment = { seq: number; label: string; paragraphs: string[] };
export type ModelView = {
  id: string;
  provider: string;
  label: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
  tested: boolean;
  available: boolean;
};
export type MessageView = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  modelId: string | null;
  status: 'complete' | 'failed';
  costUsd: number;
};

export const PDF_SEGMENTS: Segment[] = [
  {
    seq: 0,
    label: 'Page 1',
    paragraphs: [
      'She sat on the bank. The bank was steep. She sat on the bank.',
      'The river moved slowly under a pale and ephemeral light. Across the page break',
    ],
  },
  { seq: 1, label: 'Page 2', paragraphs: ['into page two.', 'Ephemeral joys fade quickly.'] },
  { seq: 2, label: 'Page 3', paragraphs: ['Final page.'] },
];

const PDF_ANCHOR = { format: 'pdf', page: 1, rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] };
const EPUB_ANCHOR = { format: 'epub', cfi: 'epubcfi(/6/2!/4/2/1:0)' };

export async function signedInOwner(): Promise<Api> {
  const api = apiClient();
  expect((await api.login(OWNER.email, OWNER.password)).status).toBe(200);
  return api;
}

export async function listModels(api: Api): Promise<ModelView[]> {
  const res = await api.get('/api/models');
  expect(res.status).toBe(200);
  return ((await res.json()) as { models: ModelView[] }).models;
}

export async function newBook(api: Api, format: 'pdf' | 'epub', segments: Segment[] | null) {
  const res = await api.post('/api/books', {
    title: 'Sample Book',
    author: 'Test Author',
    format,
    sizeBytes: 1234,
  });
  expect(res.status).toBe(201);
  const { bookId } = (await res.json()) as { bookId: string };
  if (segments) {
    const posted = await api.post(`/api/books/${bookId}/segments`, { segments, done: true });
    expect(posted.status).toBe(204);
  }
  return bookId;
}

export function selection(
  bookId: string,
  segmentSeq: number,
  text: string,
  prefix: string,
  format: 'pdf' | 'epub' = 'pdf',
) {
  return { bookId, segmentSeq, text, prefix, anchor: format === 'pdf' ? PDF_ANCHOR : EPUB_ANCHOR };
}

export async function createThread(api: Api, body: Record<string, unknown>) {
  const res = await api.post('/api/threads', body);
  expect(res.status).toBe(201);
  return (await res.json()) as { threadId: string; highlightId: string };
}

/** A define thread on "steep" in a fresh PDF book. */
export async function newDefineThread(api: Api): Promise<string> {
  const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
  const { threadId } = await createThread(api, {
    bookId,
    action: 'define',
    selection: selection(bookId, 0, 'steep', 'She sat on the bank. The bank was '),
    scope: 'page',
  });
  return threadId;
}

/** Concatenates the text deltas of an AI SDK UI message stream (SSE). */
export function streamedText(raw: string): string {
  return streamChunks(raw)
    .filter((c) => c.type === 'text-delta')
    .map((c) => c.delta ?? '')
    .join('');
}

export function streamChunks(raw: string): { type: string; delta?: string }[] {
  const chunks: { type: string; delta?: string }[] = [];
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice('data: '.length);
    if (data === '[DONE]') continue;
    chunks.push(JSON.parse(data) as { type: string; delta?: string });
  }
  return chunks;
}

export async function lastPrompt(api: Api): Promise<string> {
  const res = await api.get('/api/test/last-prompt');
  expect(res.status).toBe(200);
  const { prompt } = (await res.json()) as { prompt: string | null };
  expect(prompt).not.toBeNull();
  return prompt!;
}

export async function threadMessages(api: Api, threadId: string): Promise<MessageView[]> {
  const res = await api.get(`/api/threads/${threadId}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { messages: MessageView[] }).messages;
}

import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import {
  PDF_SEGMENTS,
  createThread,
  lastPrompt,
  listModels,
  newBook,
  selection,
  signedInOwner,
  streamedText,
  type Api,
  type ModelView,
  type Segment,
} from '../helpers/threads';
import { INTRUDER, OWNER, ensureUser } from '../helpers/users';

const FILLER =
  'the quiet river carried small boats past old stone bridges while patient readers turned pages beneath tall trees and listened to distant bells ring across the valley as evening settled slowly over every field and road'.split(
    ' ',
  );
function paragraph(n: number): string {
  const words = [`P${n}`];
  for (let i = 0; words.length < 60; i++) words.push(FILLER[(i + n) % FILLER.length]);
  return words.join(' ');
}
const CHAPTER_ONE = Array.from({ length: 12 }, (_, i) => paragraph(i + 1));
const EPUB_SEGMENTS: Segment[] = [
  { seq: 0, label: 'One', paragraphs: CHAPTER_ONE },
  { seq: 1, label: 'Two', paragraphs: ['Second chapter text.'] },
];

async function answerPrompt(api: Api, body: Record<string, unknown>, chat: object = {}) {
  const { threadId } = await createThread(api, body);
  const raw = await api.streamText(`/api/threads/${threadId}/chat`, chat);
  expect(streamedText(raw)).toBe('MOCK ANSWER');
  return lastPrompt(api);
}

let models: ModelView[];
let flashId: string;
let api: Api;

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  await ensureUser(INTRUDER.email, INTRUDER.password);
  api = await signedInOwner();
  models = await listModels(api);
  flashId = models.find((m) => m.provider === 'google' && /flash/i.test(m.id))!.id;
});

describe('threads: first answer', () => {
  test('define streams the mock answer and saves it with the Gemini Flash model', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const { threadId, highlightId } = await createThread(api, {
      bookId,
      action: 'define',
      selection: selection(bookId, 0, 'steep', 'She sat on the bank. The bank was '),
      scope: 'page',
    });

    const raw = await api.streamText(`/api/threads/${threadId}/chat`, {});
    expect(streamedText(raw)).toBe('MOCK ANSWER');

    const got = await api.get(`/api/threads/${threadId}`);
    expect(got.status).toBe(200);
    const body = (await got.json()) as {
      thread: { id: string; action: string; scope: string; highlightId: string };
      messages: { role: string; content: string; modelId: string; status: string }[];
    };
    expect(body.thread).toEqual({ id: threadId, action: 'define', scope: 'page', highlightId });
    const answers = body.messages.filter((m) => m.role === 'assistant');
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({
      content: 'MOCK ANSWER',
      status: 'complete',
      modelId: flashId,
    });

    const prompt = await lastPrompt(api);
    expect(prompt).toContain('Book: Sample Book by Test Author');
    expect(prompt).toContain('Location: Page 1');
    expect(prompt).toContain('She sat on the bank. The bank was ⟦steep⟧. She sat on the bank.');
    expect(prompt).toContain(PDF_SEGMENTS[0].paragraphs[1]);
    expect(prompt).toContain('IPA');
    expect(prompt).toContain('Answer in English');
  });

  test('a repeated phrase is located by its prefix', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const text = 'She sat on the bank.';

    const second = await answerPrompt(api, {
      bookId,
      action: 'explain',
      selection: selection(bookId, 0, text, 'She sat on the bank. The bank was steep. '),
      scope: 'page',
    });
    expect(second).toContain('The bank was steep. ⟦She sat on the bank.⟧');

    const first = await answerPrompt(api, {
      bookId,
      action: 'explain',
      selection: selection(bookId, 0, text, ''),
      scope: 'page',
    });
    expect(first).toContain('⟦She sat on the bank.⟧ The bank was steep.');
  });

  test('EPUB page context grows around the selected paragraph', async () => {
    const bookId = await newBook(api, 'epub', EPUB_SEGMENTS);
    const has = (prompt: string, n: number) => new RegExp(`\\bP${n}\\b`).test(prompt);
    const position = (prompt: string, n: number) => prompt.search(new RegExp(`\\bP${n}\\b`));

    const middle = await answerPrompt(api, {
      bookId,
      action: 'explain',
      selection: selection(bookId, 0, 'P6', CHAPTER_ONE.slice(0, 5).join(' ') + ' ', 'epub'),
      scope: 'page',
    });
    for (let n = 3; n <= 9; n++) expect(has(middle, n)).toBe(true);
    for (let n = 3; n < 9; n++) expect(position(middle, n)).toBeLessThan(position(middle, n + 1));
    expect(has(middle, 2)).toBe(false);
    expect(has(middle, 10)).toBe(false);

    const start = await answerPrompt(api, {
      bookId,
      action: 'explain',
      selection: selection(bookId, 0, 'P1', '', 'epub'),
      scope: 'page',
    });
    for (let n = 1; n <= 7; n++) expect(has(start, n)).toBe(true);
    expect(has(start, 8)).toBe(false);
  });

  test('ask with the whole book sends every segment and ends with the question', async () => {
    const bookId = await newBook(api, 'epub', EPUB_SEGMENTS);
    const prompt = await answerPrompt(
      api,
      {
        bookId,
        action: 'ask',
        selection: selection(bookId, 0, 'P6', CHAPTER_ONE.slice(0, 5).join(' ') + ' ', 'epub'),
        scope: 'book',
      },
      { text: 'Who?' },
    );
    expect(prompt).toContain('## One');
    expect(prompt).toContain('## Two');
    expect(prompt).toContain('Second chapter text.');
    expect(prompt.trimEnd().endsWith('Question: Who?')).toBe(true);
  });

  test('invalid thread requests are refused', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);

    const bookScopeDefine = await api.post('/api/threads', {
      bookId,
      action: 'define',
      selection: selection(bookId, 0, 'steep', ''),
      scope: 'book',
    });
    expect(bookScopeDefine.status).toBe(400);

    const tooLong = await api.post('/api/threads', {
      bookId,
      action: 'explain',
      selection: selection(bookId, 0, Array.from({ length: 2001 }, () => 'word').join(' '), ''),
      scope: 'page',
    });
    expect(tooLong.status).toBe(400);

    const pending = await newBook(api, 'pdf', null);
    const notExtracted = await api.post('/api/threads', {
      bookId: pending,
      action: 'explain',
      selection: selection(pending, 0, 'steep', ''),
      scope: 'page',
    });
    expect(notExtracted.status).toBe(409);
    expect(await notExtracted.json()).toEqual({
      message: "This book's text is still being prepared.",
    });
  });

  test("another user's book is 404", async () => {
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    const intruderId = users!.users.find((u) => u.email === INTRUDER.email)!.id;
    const { data: row, error } = await admin
      .from('books')
      .insert({
        owner_id: intruderId,
        title: 'Not Yours',
        format: 'pdf',
        storage_path: `${intruderId}/t.pdf`,
        size_bytes: 10,
        segment_count: 1,
        extracted_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    await admin.from('segments').insert({
      book_id: row!.id,
      owner_id: intruderId,
      seq: 0,
      label: 'Page 1',
      paragraphs: ['secret'],
    });


    const res = await api.post('/api/threads', {
      bookId: row!.id,
      action: 'explain',
      selection: selection(row!.id, 0, 'secret', ''),
      scope: 'page',
    });
    expect(res.status).toBe(404);
    await admin.from('books').delete().eq('id', row!.id);
  });

  test('every listed model has a unique id and non-negative prices', () => {
    expect(models.length).toBeGreaterThan(0);
    expect(new Set(models.map((m) => m.id)).size).toBe(models.length);
    for (const m of models) {
      expect(m.inputUsdPerMTok).toBeGreaterThanOrEqual(0);
      expect(m.outputUsdPerMTok).toBeGreaterThanOrEqual(0);
    }
  });
});

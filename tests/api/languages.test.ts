import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { Action } from '../../src/lib/types';
import { apiClient } from '../helpers/api-client';
import { putSettings, restoreSettings } from '../helpers/settings';
import {
  PDF_SEGMENTS,
  createThread,
  lastPrompt,
  newBook,
  selection,
  signedInOwner,
  streamedText,
  type Api,
} from '../helpers/threads';
import { INTRUDER, OWNER, adminClient, ensureUser, userId } from '../helpers/users';

let api: Api;

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  await ensureUser(INTRUDER.email, INTRUDER.password);
  api = await signedInOwner();
});
afterEach(() => restoreSettings(api));

const chat = (threadId: string, body: object) => api.streamText(`/api/threads/${threadId}/chat`, body);

/** A thread on "steep"; Ask needs its question with the first request, the others take none. */
async function startThread(action: Action, bookId?: string): Promise<{ threadId: string; first: object }> {
  const book = bookId ?? (await newBook(api, 'pdf', PDF_SEGMENTS));
  const { threadId } = await createThread(api, {
    bookId: book,
    action,
    selection: selection(book, 0, 'steep', 'She sat on the bank. The bank was '),
    scope: 'page',
  });
  return { threadId, first: action === 'ask' ? { text: 'Why is it steep?' } : {} };
}

/** Starts a thread, answers it, and returns the prompt the model got. */
async function firstPrompt(action: Action, bookId?: string): Promise<string> {
  const { threadId, first } = await startThread(action, bookId);
  expect(streamedText(await chat(threadId, first))).toBe('MOCK ANSWER');
  return lastPrompt(api);
}

const count = (text: string, part: string) => text.split(part).length - 1;

const SPLIT = { translationLanguage: 'Indonesian', answerLanguage: 'French' };

describe('languages in the prompt', () => {
  test('Translate names the Translation language for the translation and the Answer language for its note', async () => {
    expect((await putSettings(api, SPLIT)).status).toBe(200);
    const prompt = await firstPrompt('translate');
    expect(prompt).toContain('translate the selected text naturally into Indonesian.');
    expect(prompt).toContain('add one line of notes in French.');
    expect(count(prompt, 'Indonesian')).toBe(1);
  });

  test.each([
    ['define', 'define the selected term in French'],
    ['explain', 'in one short paragraph, in French'],
    ['simplify', 'plain, easy French'],
    ['ask', "If you can't tell, answer in French"],
  ] as [Action, string][])(
    '%s answers in the Answer language and never names the Translation language',
    async (action, expected) => {
      expect((await putSettings(api, SPLIT)).status).toBe(200);
      const prompt = await firstPrompt(action);
      expect(prompt).toContain(expected);
      expect(prompt).not.toContain('Indonesian');
    },
  );

  test('a typed question or follow-up is answered in the language it is written in', async () => {
    expect((await putSettings(api, SPLIT)).status).toBe(200);
    const ask = await startThread('ask');
    await chat(ask.threadId, ask.first);
    expect(await lastPrompt(api)).toContain('in the language the question is written in');

    const translate = await startThread('translate');
    await chat(translate.threadId, translate.first);
    await chat(translate.threadId, { text: 'Pourquoi ce mot ?' });
    const prompt = await lastPrompt(api);
    expect(prompt).toContain('Follow-ups: reply in the language the reader writes in.');
    expect(prompt).toContain("If you can't tell, reply in French.");
  });

  test('a thread keeps the languages it started with, and a new thread uses the changed ones', async () => {
    expect((await putSettings(api, SPLIT)).status).toBe(200);
    const { threadId, first } = await startThread('translate');
    await chat(threadId, first);

    expect((await putSettings(api, { translationLanguage: 'German', answerLanguage: 'Spanish' })).status).toBe(
      200,
    );
    await chat(threadId, { text: 'Why that word?' });
    const followUp = await lastPrompt(api);
    expect(followUp).toContain('into Indonesian.');
    expect(followUp).toContain("If you can't tell, reply in French.");
    expect(followUp).not.toMatch(/German|Spanish/);

    const next = await startThread('translate');
    await chat(next.threadId, next.first);
    const fresh = await lastPrompt(api);
    expect(fresh).toContain('into German.');
    expect(fresh).toContain('notes in Spanish.');
  });
});

type BookLanguagesBody = {
  translationLanguage: string;
  answerLanguage: string;
  translationLanguageOverride: string | null;
  answerLanguageOverride: string | null;
};

const patchBook = (bookId: string, body: unknown) => api.patch(`/api/books/${bookId}`, body);

// GET one links to the book's file, so these books have one stored.
const newStoredBook = () => newBook(api, 'pdf', PDF_SEGMENTS, { stored: true });

async function getBookLanguages(bookId: string): Promise<BookLanguagesBody> {
  const res = await api.get(`/api/books/${bookId}`);
  expect(res.status).toBe(200);
  return (await res.json()) as BookLanguagesBody;
}

describe('book language overrides', () => {
  test('a new book has none, and follows the defaults', async () => {
    const bookId = await newStoredBook();
    expect(await getBookLanguages(bookId)).toMatchObject({
      translationLanguageOverride: null,
      answerLanguageOverride: null,
      translationLanguage: 'English',
      answerLanguage: 'English',
    });
  });

  test('an override is saved on its own, read back, and cleared with null', async () => {
    const bookId = await newStoredBook();
    const set = await patchBook(bookId, { translationLanguageOverride: ' Japanese ' });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({
      translationLanguageOverride: 'Japanese',
      answerLanguageOverride: null,
      translationLanguage: 'Japanese',
      answerLanguage: 'English',
    });
    expect(await getBookLanguages(bookId)).toMatchObject({
      translationLanguageOverride: 'Japanese',
      answerLanguageOverride: null,
    });

    expect((await patchBook(bookId, { answerLanguageOverride: 'Spanish' })).status).toBe(200);
    expect(await getBookLanguages(bookId)).toMatchObject({
      translationLanguageOverride: 'Japanese',
      answerLanguageOverride: 'Spanish',
    });

    expect((await patchBook(bookId, { translationLanguageOverride: null })).status).toBe(200);
    expect(await getBookLanguages(bookId)).toMatchObject({
      translationLanguageOverride: null,
      answerLanguageOverride: 'Spanish',
      translationLanguage: 'English',
      answerLanguage: 'Spanish',
    });
  });

  test.each([
    ['an empty Translate into', { translationLanguageOverride: '' }, 'Translate into must be 1 to 40 characters'],
    [
      'a Translate into over 40 characters',
      { translationLanguageOverride: 'x'.repeat(41) },
      'Translate into must be 1 to 40 characters',
    ],
    ['a blank Answer in', { answerLanguageOverride: '  ' }, 'Answer in must be 1 to 40 characters'],
    ['an Answer in that is not text', { answerLanguageOverride: 7 }, 'Answer in must be 1 to 40 characters'],
  ])('%s is refused with a message naming the field', async (_name, body, message) => {
    const bookId = await newStoredBook();
    expect((await patchBook(bookId, { answerLanguageOverride: 'Spanish' })).status).toBe(200);
    const res = await patchBook(bookId, body);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe(message);
    expect(await getBookLanguages(bookId)).toMatchObject({
      translationLanguageOverride: null,
      answerLanguageOverride: 'Spanish',
    });
  });

  test('an unknown book is not found, and another reader cannot change a book', async () => {
    expect((await patchBook('00000000-0000-4000-8000-000000000000', { answerLanguageOverride: 'Spanish' })).status).toBe(
      404,
    );
    expect((await patchBook('not-an-id', { answerLanguageOverride: 'Spanish' })).status).toBe(404);

    const admin = adminClient();
    const intruderId = await userId(INTRUDER.email);
    const { data: foreign, error } = await admin
      .from('books')
      .insert({
        owner_id: intruderId,
        title: 'Not Yours',
        format: 'pdf',
        storage_path: `${intruderId}/x.pdf`,
        size_bytes: 10,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    expect((await patchBook(foreign!.id, { answerLanguageOverride: 'Spanish' })).status).toBe(404);
    const { data: row } = await admin
      .from('books')
      .select('answer_language_override')
      .eq('id', foreign!.id)
      .single();
    expect(row).toEqual({ answer_language_override: null });
  });

  test('changing the languages needs a session', async () => {
    const res = await apiClient().patch('/api/books/00000000-0000-4000-8000-000000000000', {});
    expect(res.status).toBe(401);
  });
});

describe("a book's languages in its prompts", () => {
  test('an override wins over the default, and a book without one follows a changed default', async () => {
    expect((await putSettings(api, SPLIT)).status).toBe(200);
    const withOverride = await newBook(api, 'pdf', PDF_SEGMENTS);
    const without = await newBook(api, 'pdf', PDF_SEGMENTS);
    expect((await patchBook(withOverride, { translationLanguageOverride: 'Japanese' })).status).toBe(200);

    const overridden = await firstPrompt('translate', withOverride);
    expect(overridden).toContain('into Japanese.');
    expect(overridden).toContain('notes in French.');
    expect(overridden).not.toContain('Indonesian');

    expect((await putSettings(api, { translationLanguage: 'German', answerLanguage: 'Spanish' })).status).toBe(
      200,
    );
    const followed = await firstPrompt('translate', without);
    expect(followed).toContain('into German.');
    expect(followed).toContain('notes in Spanish.');
    expect(await firstPrompt('translate', withOverride)).toContain('into Japanese.');
  });

  test('an Answer language override is used by Define and by the follow-up rule', async () => {
    expect((await putSettings(api, SPLIT)).status).toBe(200);
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    expect((await patchBook(bookId, { answerLanguageOverride: 'Japanese' })).status).toBe(200);
    const prompt = await firstPrompt('define', bookId);
    expect(prompt).toContain('define the selected term in Japanese');
    expect(prompt).toContain("If you can't tell, reply in Japanese.");
    expect(prompt).not.toContain('French');
  });

  test('a thread keeps its languages when the book override changes, and clearing the override returns to the default', async () => {
    expect((await putSettings(api, SPLIT)).status).toBe(200);
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    expect((await patchBook(bookId, { answerLanguageOverride: 'Japanese' })).status).toBe(200);
    const { threadId, first } = await startThread('define', bookId);
    await chat(threadId, first);

    expect((await patchBook(bookId, { answerLanguageOverride: 'Spanish' })).status).toBe(200);
    await chat(threadId, { text: 'And the next word?' });
    const followUp = await lastPrompt(api);
    expect(followUp).toContain("If you can't tell, reply in Japanese.");
    expect(followUp).not.toContain('Spanish');

    expect((await patchBook(bookId, { answerLanguageOverride: null })).status).toBe(200);
    expect(await firstPrompt('define', bookId)).toContain('define the selected term in French');
  });
});

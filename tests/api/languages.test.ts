import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import type { Action } from '../../src/lib/types';
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
import { OWNER, ensureUser } from '../helpers/users';

let api: Api;

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
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

/** Starts a thread and answers it, and returns the prompt the model got. */
async function firstPrompt(action: Action): Promise<string> {
  const { threadId, first } = await startThread(action);
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

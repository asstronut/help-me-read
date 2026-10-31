import { beforeAll, describe, expect, test } from 'vitest';
import {
  PDF_SEGMENTS,
  createThread,
  lastPrompt,
  listModels,
  newBook,
  newDefineThread,
  selection,
  signedInOwner,
  streamChunks,
  streamedText,
  threadMessages,
  type Api,
  type ModelView,
} from '../helpers/threads';
import { OWNER, ensureUser } from '../helpers/users';

const HAIKU = 'claude-haiku-5-5';

let api: Api;
let models: ModelView[];

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  api = await signedInOwner();
  models = await listModels(api);
});

const chat = (threadId: string, body: object, headers?: Record<string, string>) =>
  api.streamText(`/api/threads/${threadId}/chat`, body, headers);

describe('threads: follow-ups and re-ask', () => {
  test('a follow-up adds the question and an answer, with earlier turns in the prompt', async () => {
    const threadId = await newDefineThread(api);
    expect(streamedText(await chat(threadId, {}))).toBe('MOCK ANSWER');

    expect(streamedText(await chat(threadId, { text: 'More?' }))).toBe('MOCK ANSWER');

    const messages = await threadMessages(api, threadId);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['assistant', 'MOCK ANSWER'],
      ['user', 'More?'],
      ['assistant', 'MOCK ANSWER'],
    ]);
    const prompt = await lastPrompt(api);
    expect(prompt).toContain('She sat on the bank. The bank was ⟦steep⟧.');
    expect(prompt.indexOf('MOCK ANSWER')).toBeGreaterThan(-1);
    expect(prompt.indexOf('MOCK ANSWER')).toBeLessThan(prompt.indexOf('More?'));

    const again = await api.post(`/api/threads/${threadId}/chat`, {});
    expect(again.status).toBe(409);
  });

  test('re-ask answers the latest question again with the chosen model', async () => {
    const threadId = await newDefineThread(api);
    await chat(threadId, {});
    await chat(threadId, { text: 'More?' });

    expect(streamedText(await chat(threadId, { reask: true, modelId: HAIKU }))).toBe(
      'MOCK ANSWER',
    );

    const messages = await threadMessages(api, threadId);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['assistant', 'MOCK ANSWER'],
      ['user', 'More?'],
      ['assistant', 'MOCK ANSWER'],
      ['assistant', 'MOCK ANSWER'],
    ]);
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(messages.at(-1)!.modelId).toBe(HAIKU);
    expect((await lastPrompt(api)).trimEnd().endsWith('More?')).toBe(true);
  });

  test('an unknown model is refused', async () => {
    const threadId = await newDefineThread(api);
    const res = await api.post(`/api/threads/${threadId}/chat`, { modelId: 'nope' });
    expect(res.status).toBe(400);
    expect(await threadMessages(api, threadId)).toEqual([]);
  });

  test('each answer stores its cost from the model prices and reported tokens', async () => {
    const threadId = await newDefineThread(api);
    await chat(threadId, {});
    await chat(threadId, { reask: true, modelId: HAIKU });

    const [first, second] = await threadMessages(api, threadId);
    for (const answer of [first, second]) {
      const model = models.find((m) => m.id === answer.modelId)!;
      // Mock usage is 100 input and 50 output tokens; costs are stored to the micro-dollar.
      const microUsd = 100 * model.inputUsdPerMTok + 50 * model.outputUsdPerMTok;
      expect(answer.costUsd).toBe(Math.round(microUsd) / 1e6);
      expect(answer.costUsd).toBeGreaterThan(0);
    }
  });

  test('a provider failure keeps the partial answer as failed, and Retry recovers', async () => {
    const threadId = await newDefineThread(api);
    const raw = await chat(threadId, {}, { 'x-test-fail-after': '1' });
    expect(streamedText(raw)).toBe('MOCK ');
    expect(streamChunks(raw).some((c) => c.type === 'error')).toBe(true);

    const failed = await threadMessages(api, threadId);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({
      role: 'assistant',
      content: 'MOCK ',
      status: 'failed',
      costUsd: 0,
    });

    expect(streamedText(await chat(threadId, { reask: true }))).toBe('MOCK ANSWER');
    const retried = await threadMessages(api, threadId);
    expect(retried.map((m) => [m.status, m.content])).toEqual([
      ['failed', 'MOCK '],
      ['complete', 'MOCK ANSWER'],
    ]);
  });

  test('a failed first answer to Ask can be retried', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const { threadId } = await createThread(api, {
      bookId,
      action: 'ask',
      selection: selection(bookId, 0, 'steep', 'She sat on the bank. The bank was '),
      scope: 'page',
    });
    await chat(threadId, { text: 'Why?' }, { 'x-test-fail-after': '0' });
    expect((await threadMessages(api, threadId)).map((m) => [m.role, m.status])).toEqual([
      ['user', 'complete'],
      ['assistant', 'failed'],
    ]);

    expect(streamedText(await chat(threadId, { reask: true }))).toBe('MOCK ANSWER');
    expect((await lastPrompt(api)).trimEnd().endsWith('Question: Why?')).toBe(true);
    const messages = await threadMessages(api, threadId);
    expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', status: 'complete' });
  });
});

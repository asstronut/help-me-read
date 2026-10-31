import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import {
  lastPrompt,
  newDefineThread,
  signedInOwner,
  streamedText,
  threadMessages,
  type Api,
} from '../helpers/threads';
import { OWNER, ensureUser } from '../helpers/users';

type SettingsBody = {
  settings: {
    explanationLanguage: string;
    actionModels: Record<string, string>;
    monthlyCapUsd: number;
    theme: string;
  };
  monthSpendUsd: number;
};

const DEFAULTS = { explanationLanguage: 'English', actionModels: {}, monthlyCapUsd: 10, theme: 'light' };

let api: Api;

const getSettings = async () => {
  const res = await api.get('/api/settings');
  expect(res.status).toBe(200);
  return (await res.json()) as SettingsBody;
};
const put = (body: object) => api.put('/api/settings', { ...DEFAULTS, ...body });

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  api = await signedInOwner();
});
// Settings belong to the shared owner, so every test hands back the defaults.
afterEach(async () => {
  expect((await api.put('/api/settings', DEFAULTS)).status).toBe(200);
});

describe('settings', () => {
  test('the first read returns the defaults and this month spend', async () => {
    const body = await getSettings();
    expect(body.settings).toEqual(DEFAULTS);
    expect(body.monthSpendUsd).toBeGreaterThanOrEqual(0);
  });

  test('a saved setting is read back', async () => {
    expect((await put({ explanationLanguage: 'French', monthlyCapUsd: 12.5, theme: 'sepia' })).status).toBe(
      200,
    );
    expect((await getSettings()).settings).toEqual({
      ...DEFAULTS,
      explanationLanguage: 'French',
      monthlyCapUsd: 12.5,
      theme: 'sepia',
    });
  });

  test.each([
    ['a negative cap', { monthlyCapUsd: -1 }],
    ['a cap above 1000', { monthlyCapUsd: 1001 }],
    ['an unknown theme', { theme: 'blue' }],
    ['an unknown model', { actionModels: { define: 'nope' } }],
    ['an empty language', { explanationLanguage: '' }],
    ['a language over 40 characters', { explanationLanguage: 'x'.repeat(41) }],
  ])('%s is refused', async (_name, change) => {
    expect((await put(change)).status).toBe(400);
    expect((await getSettings()).settings).toEqual(DEFAULTS);
  });

  test('the explanation language reaches the next define prompt', async () => {
    expect((await put({ explanationLanguage: 'Indonesian' })).status).toBe(200);
    const threadId = await newDefineThread(api);
    const raw = await api.streamText(`/api/threads/${threadId}/chat`, {});
    expect(streamedText(raw)).toBe('MOCK ANSWER');
    expect(await lastPrompt(api)).toContain('Answer in Indonesian');
  });

  test("a chosen model answers the next define", async () => {
    expect((await put({ actionModels: { define: 'claude-haiku-5-5' } })).status).toBe(200);
    const threadId = await newDefineThread(api);
    const raw = await api.streamText(`/api/threads/${threadId}/chat`, {});
    expect(streamedText(raw)).toBe('MOCK ANSWER');
    const messages = await threadMessages(api, threadId);
    expect(messages.at(-1)?.modelId).toBe('claude-haiku-5-5');
  });

  test('a cap of zero refuses the next define', async () => {
    expect((await put({ monthlyCapUsd: 0 })).status).toBe(200);
    const threadId = await newDefineThread(api);
    const res = await api.post(`/api/threads/${threadId}/chat`, {});
    expect(res.status).toBe(402);
    expect(((await res.json()) as { message: string }).message).toContain('$0.00');
    expect((await (await api.get('/api/spend')).json()) as { capUsd: number }).toMatchObject({ capUsd: 0 });
  });
});

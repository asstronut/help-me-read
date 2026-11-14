import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { DEFAULT_SETTINGS } from '../helpers/default-settings';
import { putSettings, restoreSettings } from '../helpers/settings';
import {
  newDefineThread,
  signedInOwner,
  streamedText,
  threadMessages,
  type Api,
} from '../helpers/threads';
import { OWNER, ensureUser } from '../helpers/users';

type SettingsBody = {
  settings: {
    translationLanguage: string;
    answerLanguage: string;
    actionModels: Record<string, string>;
    monthlyCapUsd: number;
    theme: string;
  };
  monthSpendUsd: number;
};

let api: Api;

const getSettings = async () => {
  const res = await api.get('/api/settings');
  expect(res.status).toBe(200);
  return (await res.json()) as SettingsBody;
};
const put = (change: object) => putSettings(api, change);

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  api = await signedInOwner();
});
afterEach(() => restoreSettings(api));

describe('settings', () => {
  test('the first read returns the defaults and this month spend', async () => {
    const body = await getSettings();
    expect(body.settings).toEqual(DEFAULT_SETTINGS);
    expect(body.monthSpendUsd).toBeGreaterThanOrEqual(0);
  });

  test('a saved setting is read back', async () => {
    expect((await put({ monthlyCapUsd: 12.5, theme: 'sepia' })).status).toBe(200);
    expect((await getSettings()).settings).toEqual({
      ...DEFAULT_SETTINGS,
      monthlyCapUsd: 12.5,
      theme: 'sepia',
    });
  });

  test('both languages are saved, each on its own, and trimmed', async () => {
    expect((await put({ translationLanguage: ' Indonesian ', answerLanguage: 'French' })).status).toBe(
      200,
    );
    expect((await getSettings()).settings).toMatchObject({
      translationLanguage: 'Indonesian',
      answerLanguage: 'French',
    });
  });

  test.each([
    ['a negative cap', { monthlyCapUsd: -1 }],
    ['a cap above 1000', { monthlyCapUsd: 1001 }],
    ['an unknown theme', { theme: 'blue' }],
    ['an unknown model', { actionModels: { define: 'nope' } }],
  ])('%s is refused', async (_name, change) => {
    expect((await put(change)).status).toBe(400);
    expect((await getSettings()).settings).toEqual(DEFAULT_SETTINGS);
  });

  test.each([
    ['an empty Translate into', { translationLanguage: '' }, 'Translate into must be 1 to 40 characters'],
    [
      'a Translate into over 40 characters',
      { translationLanguage: 'x'.repeat(41) },
      'Translate into must be 1 to 40 characters',
    ],
    ['a blank Answer in', { answerLanguage: '   ' }, 'Answer in must be 1 to 40 characters'],
    [
      'an Answer in over 40 characters',
      { answerLanguage: 'x'.repeat(41) },
      'Answer in must be 1 to 40 characters',
    ],
  ])('%s is refused with a message naming the field', async (_name, change, message) => {
    const res = await put(change);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { message: string }).message).toBe(message);
    expect((await getSettings()).settings).toEqual(DEFAULT_SETTINGS);
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

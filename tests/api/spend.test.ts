import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import {
  lastPrompt,
  listModels,
  newDefineThread,
  signedInOwner,
  streamedText,
  threadMessages,
  type Api,
} from '../helpers/threads';
import { OWNER, adminClient, ensureUser, userId } from '../helpers/users';

// Spend assertions run in a month no real call lands in; only this file writes rows there.
const TEST_NOW = '2031-03-15T12:00:00Z';
const IN_TEST_MONTH = '2031-03-10T00:00:00Z';
const LAST_MONTH = '2031-02-20T00:00:00Z';
const ARRANGED_FROM = '2031-01-01T00:00:00Z';
const ARRANGED_TO = '2032-01-01T00:00:00Z';
// Sonnet's $2/MTok input price keeps every estimate a whole number of micro-dollars, as stored.
const SONNET = 'claude-sonnet-5-5';

let api: Api;
let ownerId: string;
const admin = adminClient();

async function clearArrangedSpend() {
  const { error } = await admin
    .from('usage_events')
    .delete()
    .eq('owner_id', ownerId)
    .gte('created_at', ARRANGED_FROM)
    .lt('created_at', ARRANGED_TO);
  expect(error).toBeNull();
}

async function arrangeSpend(costUsd: number, createdAt: string): Promise<string> {
  const { data, error } = await admin
    .from('usage_events')
    .insert({ owner_id: ownerId, model_id: 'test', cost_usd: costUsd, created_at: createdAt })
    .select('id')
    .single();
  expect(error).toBeNull();
  return data!.id;
}

async function monthSpend(now: string): Promise<{ monthSpendUsd: number; capUsd: number }> {
  const res = await api.get('/api/spend', { 'x-test-now': now });
  expect(res.status).toBe(200);
  return (await res.json()) as { monthSpendUsd: number; capUsd: number };
}

const define = (threadId: string, body: object = { modelId: SONNET }) =>
  api.post(`/api/threads/${threadId}/chat`, body, { 'x-test-now': TEST_NOW });

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  api = await signedInOwner();
  ownerId = await userId(OWNER.email);
});
beforeEach(clearArrangedSpend);
afterAll(clearArrangedSpend);

describe('spend', () => {
  test("month spend sums this UTC month's AI costs only", async () => {
    await arrangeSpend(0.5, IN_TEST_MONTH);
    await arrangeSpend(0.25, IN_TEST_MONTH);
    await arrangeSpend(3, LAST_MONTH);
    expect(await monthSpend(TEST_NOW)).toEqual({ monthSpendUsd: 0.75, capUsd: 10 });
  });

  test('the month rolls over at midnight UTC', async () => {
    const october = '2026-11-01T00:30:00+07:00';
    const november = '2026-11-01T00:00:00Z';
    const octoberBefore = (await monthSpend(october)).monthSpendUsd;
    const novemberBefore = (await monthSpend(november)).monthSpendUsd;
    const id = await arrangeSpend(0.125, '2026-10-31T23:30:00Z');
    try {
      expect((await monthSpend(october)).monthSpendUsd - octoberBefore).toBeCloseTo(0.125, 6);
      expect((await monthSpend(november)).monthSpendUsd).toBeCloseTo(novemberBefore, 6);
    } finally {
      await admin.from('usage_events').delete().eq('id', id);
    }
  });

  test('a call is refused once spend reaches the cap, and nothing is saved', async () => {
    await arrangeSpend(10, IN_TEST_MONTH);
    const threadId = await newDefineThread(api);

    const res = await define(threadId);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      message: "You've reached this month's AI limit of $10.00. Raise it in Settings.",
    });
    expect(await threadMessages(api, threadId)).toEqual([]);
  });

  test('spend plus the estimate exactly at the cap is allowed; a micro-dollar more is refused', async () => {
    const models = await listModels(api);
    const inputPrice = models.find((m) => m.id === SONNET)!.inputUsdPerMTok;

    const probe = await newDefineThread(api);
    expect(streamedText(await (await define(probe)).text())).toBe('MOCK ANSWER');
    const estimateMicroUsd = Math.ceil((await lastPrompt(api)).length / 4) * inputPrice;
    expect(Number.isInteger(estimateMicroUsd)).toBe(true);

    await arrangeSpend((10e6 - estimateMicroUsd) / 1e6, IN_TEST_MONTH);
    const atCap = await newDefineThread(api);
    const allowed = await define(atCap);
    expect(allowed.status).toBe(200);
    expect(streamedText(await allowed.text())).toBe('MOCK ANSWER');

    await arrangeSpend(0.000001, IN_TEST_MONTH);
    const overCap = await newDefineThread(api);
    expect((await define(overCap)).status).toBe(402);
    expect(await threadMessages(api, overCap)).toEqual([]);

    const followUp = await define(atCap, { text: 'More?', modelId: SONNET });
    expect(followUp.status).toBe(402);
    expect((await threadMessages(api, atCap)).map((m) => m.role)).toEqual(['assistant']);
  });
});

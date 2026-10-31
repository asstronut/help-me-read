import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
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
import { OWNER, adminClient, ensureUser, userId } from '../helpers/users';

type VocabEntry = {
  id: string;
  term: string;
  sentence: string;
  meaning: string | null;
  anchor: unknown;
  bookId: string | null;
  bookTitle: string | null;
  createdAt: string;
};

// The cap test runs in a month no real call lands in, and removes what it arranges there.
const CAP_NOW = '2031-04-15T12:00:00Z';
const CAP_FROM = '2031-04-01T00:00:00Z';
const CAP_TO = '2031-05-01T00:00:00Z';

let api: Api;
let ownerId: string;
const admin = adminClient();

async function clearVocab() {
  const { error } = await admin.from('vocab_entries').delete().eq('owner_id', ownerId);
  expect(error).toBeNull();
}

async function clearCapMonth() {
  const { error } = await admin
    .from('usage_events')
    .delete()
    .eq('owner_id', ownerId)
    .gte('created_at', CAP_FROM)
    .lt('created_at', CAP_TO);
  expect(error).toBeNull();
}

async function usageEventCount(): Promise<number> {
  const { count, error } = await admin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId);
  expect(error).toBeNull();
  return count ?? 0;
}

async function saveVocab(
  bookId: string,
  text: string,
  prefix: string,
  headers?: Record<string, string>,
): Promise<VocabEntry> {
  const res = await api.post('/api/vocab', { bookId, selection: selection(bookId, 0, text, prefix) }, headers);
  expect(res.status).toBe(201);
  return ((await res.json()) as { entry: VocabEntry }).entry;
}

async function listVocab(q?: string): Promise<VocabEntry[]> {
  const res = await api.get(q === undefined ? '/api/vocab' : `/api/vocab?q=${encodeURIComponent(q)}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { entries: VocabEntry[] }).entries;
}

async function entry(id: string): Promise<VocabEntry | undefined> {
  return (await listVocab()).find((e) => e.id === id);
}

async function monthSpendUsd(): Promise<number> {
  const res = await api.get('/api/spend');
  expect(res.status).toBe(200);
  return ((await res.json()) as { monthSpendUsd: number }).monthSpendUsd;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setMeaning(id: string, meaning: string) {
  const { error } = await admin.from('vocab_entries').update({ meaning }).eq('id', id);
  expect(error).toBeNull();
}

/** Parses RFC 4180 CSV into rows of fields. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  api = await signedInOwner();
  ownerId = await userId(OWNER.email);
});
beforeEach(clearVocab);
afterAll(async () => {
  await clearVocab();
  await clearCapMonth();
});

describe('vocab', () => {
  test('saves the term and its sentence at once, then fills the meaning in the background and charges it', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const spendBefore = await monthSpendUsd();

    const saved = await saveVocab(bookId, 'steep', 'She sat on the bank. The bank was ');
    expect(saved).toMatchObject({
      term: 'steep',
      sentence: 'The bank was steep.',
      bookId,
      bookTitle: 'Sample Book',
      anchor: selection(bookId, 0, 'steep', '').anchor,
    });

    await expect
      .poll(async () => (await entry(saved.id))?.meaning, { timeout: 5000, interval: 200 })
      .toBe('MOCK ANSWER');
    expect(await monthSpendUsd()).toBeGreaterThan(spendBefore);
    const prompt = await lastPrompt(api);
    expect(prompt).toContain('steep');
    expect(prompt).toContain('The bank was steep.');
  });

  test('the sentence follows the prefix when the term appears more than once', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    expect((await saveVocab(bookId, 'bank', 'She sat on the bank. The ')).sentence).toBe(
      'The bank was steep.',
    );
    expect((await saveVocab(bookId, 'bank', 'The bank was steep. She sat on the ')).sentence).toBe(
      'She sat on the bank.',
    );
  });

  test("a Define thread's first answer becomes the meaning at once, with no new charge", async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const prefix = 'She sat on the bank. The bank was ';
    const { threadId } = await createThread(api, {
      bookId,
      action: 'define',
      selection: selection(bookId, 0, 'steep', prefix),
      scope: 'page',
    });
    expect(streamedText(await api.streamText(`/api/threads/${threadId}/chat`, {}))).toBe('MOCK ANSWER');
    const eventsBefore = await usageEventCount();

    const saved = await saveVocab(bookId, 'steep', prefix);
    expect(saved.meaning).toBe('MOCK ANSWER');
    await sleep(1500);
    expect(await usageEventCount()).toBe(eventsBefore);
  });

  test('search matches term or meaning, ignoring case', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const steep = await saveVocab(bookId, 'steep', 'She sat on the bank. The bank was ');
    const river = await saveVocab(bookId, 'river', 'She sat on the bank. The bank was steep. She sat on the bank. The ');
    await setMeaning(river.id, 'A Flowing stream');

    expect(await listVocab('zzz')).toEqual([]);
    expect((await listVocab('STEE')).map((e) => e.id)).toEqual([steep.id]);
    expect((await listVocab('flowing')).map((e) => e.id)).toEqual([river.id]);
    expect((await listVocab()).map((e) => e.id)).toEqual([river.id, steep.id]);
  });

  test('CSV export has a header row and quotes fields so they read back unchanged', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const saved = await saveVocab(bookId, 'steep', 'She sat on the bank. The bank was ');
    await setMeaning(saved.id, 'a, "b"');

    const res = await api.get('/api/vocab/export?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('vocab.csv');
    const rows = parseCsv(await res.text());
    expect(rows[0]).toEqual(['term', 'meaning', 'sentence', 'book', 'created_at']);
    expect(rows).toHaveLength(2);
    expect(rows[1].slice(0, 4)).toEqual(['steep', 'a, "b"', 'The bank was steep.', 'Sample Book']);
  });

  test('Anki export has one line per entry with exactly one tab', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const steep = await saveVocab(bookId, 'steep', 'She sat on the bank. The bank was ');
    await saveVocab(bookId, 'bank', 'She sat on the ');
    await setMeaning(steep.id, 'rising\tsharply\nupward');

    const res = await api.get('/api/vocab/export?format=anki');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('vocab-anki.txt');
    const lines = (await res.text()).split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line.split('\t')).toHaveLength(2);
    expect(lines).toContain(
      'steep\trising sharply upward<br><i>The bank was steep.</i><br>— Sample Book',
    );
  });

  test('at the spend cap the entry is saved and its meaning stays empty', async () => {
    await clearCapMonth();
    const { error } = await admin
      .from('usage_events')
      .insert({ owner_id: ownerId, model_id: 'test', cost_usd: 10, created_at: '2031-04-10T00:00:00Z' });
    expect(error).toBeNull();
    try {
      const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
      const eventsBefore = await usageEventCount();
      const saved = await saveVocab(bookId, 'steep', 'She sat on the bank. The bank was ', {
        'x-test-now': CAP_NOW,
      });
      expect(saved.meaning).toBeNull();
      await sleep(2000);
      expect((await entry(saved.id))?.meaning).toBeNull();
      expect(await usageEventCount()).toBe(eventsBefore);
    } finally {
      await clearCapMonth();
    }
  });

  test('an entry survives deleting its book', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const saved = await saveVocab(bookId, 'steep', 'She sat on the bank. The bank was ');
    expect((await api.del(`/api/books/${bookId}`)).status).toBe(204);

    expect(await entry(saved.id)).toMatchObject({
      term: 'steep',
      sentence: 'The bank was steep.',
      bookId: null,
      bookTitle: null,
    });
  });

  test('delete removes an entry', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const saved = await saveVocab(bookId, 'steep', 'She sat on the bank. The bank was ');
    expect((await api.del(`/api/vocab/${saved.id}`)).status).toBe(204);
    expect(await entry(saved.id)).toBeUndefined();
  });
});

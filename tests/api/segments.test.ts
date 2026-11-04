import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { apiClient } from '../helpers/api-client';
import { INTRUDER, OWNER, ensureUser } from '../helpers/users';

type Api = ReturnType<typeof apiClient>;
type ListItem = { id: string; extracted: boolean };

async function signedInOwner() {
  const api = apiClient();
  expect((await api.login(OWNER.email, OWNER.password)).status).toBe(200);
  return api;
}

async function newBook(api: Api, upload = false): Promise<string> {
  const res = await api.post('/api/books', {
    title: 'Segment Book',
    author: null,
    format: 'pdf',
    sizeBytes: 1234,
  });
  expect(res.status).toBe(201);
  const { bookId, signedUploadUrl } = await res.json();
  if (upload) {
    const put = await fetch(signedUploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      body: new TextEncoder().encode('%PDF-1.4 x'),
    });
    expect(put.ok).toBe(true);
  }
  return bookId;
}

async function isExtracted(api: Api, bookId: string) {
  const { books } = (await (await api.get('/api/books')).json()) as { books: ListItem[] };
  return books.find((b) => b.id === bookId)?.extracted;
}

const segment = (seq: number, ...paragraphs: string[]) => ({
  seq,
  label: `Page ${seq + 1}`,
  paragraphs,
});

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  await ensureUser(INTRUDER.email, INTRUDER.password);
});

describe('segments', () => {
  test('requires a session', async () => {
    const res = await apiClient().post('/api/books/00000000-0000-0000-0000-000000000000/segments', {
      segments: [],
      done: true,
    });
    expect(res.status).toBe(401);
  });

  test('segments are readable back, and only done marks the book extracted', async () => {
    const api = await signedInOwner();
    const bookId = await newBook(api);
    const first = await api.post(`/api/books/${bookId}/segments`, {
      segments: [segment(0, 'one')],
      done: false,
    });
    expect(first.status).toBe(204);
    expect(await isExtracted(api, bookId)).toBe(false);

    const second = await api.post(`/api/books/${bookId}/segments`, {
      segments: [segment(1, 'two', 'three')],
      done: true,
    });
    expect(second.status).toBe(204);
    expect(await isExtracted(api, bookId)).toBe(true);

    const got0 = await api.get(`/api/books/${bookId}/segments?seq=0`);
    expect(got0.status).toBe(200);
    expect(await got0.json()).toEqual(segment(0, 'one'));
    expect(await (await api.get(`/api/books/${bookId}/segments?seq=1`)).json()).toEqual(
      segment(1, 'two', 'three'),
    );
  });

  test('segmentCount is the highest seq plus one', async () => {
    const api = await signedInOwner();
    const bookId = await newBook(api, true);
    const res = await api.post(`/api/books/${bookId}/segments`, {
      segments: [segment(0, 'a'), segment(1, 'b')],
      done: true,
    });
    expect(res.status).toBe(204);
    expect(await (await api.get(`/api/books/${bookId}`)).json()).toMatchObject({
      extracted: true,
      segmentCount: 2,
    });
  });

  test('a zero-segment book can still be marked done', async () => {
    const api = await signedInOwner();
    const bookId = await newBook(api, true);
    const res = await api.post(`/api/books/${bookId}/segments`, { segments: [], done: true });
    expect(res.status).toBe(204);
    expect(await (await api.get(`/api/books/${bookId}`)).json()).toMatchObject({
      extracted: true,
      segmentCount: 0,
    });
  });

  test('re-posting a seq replaces it', async () => {
    const api = await signedInOwner();
    const bookId = await newBook(api);
    await api.post(`/api/books/${bookId}/segments`, { segments: [segment(0, 'old')], done: false });
    const res = await api.post(`/api/books/${bookId}/segments`, {
      segments: [segment(0, 'new one', 'new two')],
      done: true,
    });
    expect(res.status).toBe(204);
    const got = await api.get(`/api/books/${bookId}/segments?seq=0`);
    expect(await got.json()).toEqual(segment(0, 'new one', 'new two'));
  });

  test('more than 50 segments in one request is refused', async () => {
    const api = await signedInOwner();
    const bookId = await newBook(api);
    const many = Array.from({ length: 51 }, (_, i) => segment(i, 'x'));
    const res = await api.post(`/api/books/${bookId}/segments`, { segments: many, done: true });
    expect(res.status).toBe(400);
    expect((await api.get(`/api/books/${bookId}/segments?seq=0`)).status).toBe(404);
    expect(await isExtracted(api, bookId)).toBe(false);

    const ok = await api.post(`/api/books/${bookId}/segments`, {
      segments: many.slice(0, 50),
      done: true,
    });
    expect(ok.status).toBe(204);
  });

  test('a malformed body is a 400', async () => {
    const api = await signedInOwner();
    const bookId = await newBook(api);
    const bad = [
      { done: true },
      { segments: [{ seq: -1, label: 'x', paragraphs: [] }], done: true },
      { segments: [{ seq: 0, label: 'x', paragraphs: [1] }], done: true },
      { segments: [], done: 'yes' },
    ];
    for (const body of bad) {
      expect((await api.post(`/api/books/${bookId}/segments`, body)).status).toBe(400);
    }
  });

  test('GET with an absent segment is 404 and a bad seq is 400', async () => {
    const api = await signedInOwner();
    const bookId = await newBook(api);
    expect((await api.get(`/api/books/${bookId}/segments?seq=7`)).status).toBe(404);
    expect((await api.get(`/api/books/${bookId}/segments?seq=abc`)).status).toBe(400);
    expect((await api.get(`/api/books/${bookId}/segments`)).status).toBe(400);
  });

  test("another user's book is unreachable", async () => {
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
        storage_path: `${intruderId}/y.pdf`,
        size_bytes: 10,
      })
      .select('id')
      .single();
    expect(error).toBeNull();
    await admin.from('segments').insert({
      book_id: row!.id,
      owner_id: intruderId,
      seq: 0,
      label: 'x',
      paragraphs: ['secret'],
    });

    const api = await signedInOwner();
    const post = await api.post(`/api/books/${row!.id}/segments`, {
      segments: [segment(0, 'mine now')],
      done: true,
    });
    expect(post.status).toBe(404);
    expect((await api.get(`/api/books/${row!.id}/segments?seq=0`)).status).toBe(404);
    await admin.from('books').delete().eq('id', row!.id);
  });

  test('unknown or non-uuid book is 404', async () => {
    const api = await signedInOwner();
    const body = { segments: [], done: true };
    expect(
      (await api.post('/api/books/00000000-0000-0000-0000-000000000000/segments', body)).status,
    ).toBe(404);
    expect((await api.post('/api/books/not-a-uuid/segments', body)).status).toBe(404);
  });
});

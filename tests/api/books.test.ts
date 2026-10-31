import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { MAX_UPLOAD_BYTES } from '../../src/lib/types';
import { apiClient } from '../helpers/api-client';
import { INTRUDER, OWNER, ensureUser } from '../helpers/users';

type ListItem = {
  id: string;
  title: string;
  author: string | null;
  format: string;
  extracted: boolean;
  lastOpenedAt: string | null;
};

async function signedInOwner() {
  const api = apiClient();
  expect((await api.login(OWNER.email, OWNER.password)).status).toBe(200);
  return api;
}

async function createBook(
  api: ReturnType<typeof apiClient>,
  overrides: Record<string, unknown> = {},
) {
  return api.post('/api/books', {
    title: 'Some Title',
    author: 'Some Author',
    format: 'pdf',
    sizeBytes: 1234,
    ...overrides,
  });
}

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  await ensureUser(INTRUDER.email, INTRUDER.password);
});

describe('books', () => {
  test('requires a session', async () => {
    expect((await apiClient().get('/api/books')).status).toBe(401);
    expect((await createBook(apiClient())).status).toBe(401);
  });

  test('POST returns an upload target and GET lists the book as not extracted', async () => {
    const api = await signedInOwner();
    const res = await createBook(api, { title: 'Listed Book' });
    expect(res.status).toBe(201);
    const { bookId, signedUploadUrl, token } = await res.json();
    expect(bookId).toEqual(expect.any(String));
    expect(signedUploadUrl).toEqual(
      expect.stringContaining('/storage/v1/object/upload/sign/books/'),
    );
    expect(token).toEqual(expect.any(String));

    const list = await api.get('/api/books');
    expect(list.status).toBe(200);
    const { books } = (await list.json()) as { books: ListItem[] };
    expect(books.find((b) => b.id === bookId)).toEqual({
      id: bookId,
      title: 'Listed Book',
      author: 'Some Author',
      format: 'pdf',
      extracted: false,
      lastOpenedAt: null,
    });
  });

  test('the signed URL accepts the file and GET one returns a readable fileUrl', async () => {
    const api = await signedInOwner();
    const bytes = new TextEncoder().encode('%PDF-1.4 fake body');
    const { bookId, signedUploadUrl } = await (await createBook(api)).json();
    const put = await fetch(signedUploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      body: bytes,
    });
    expect(put.ok).toBe(true);

    const one = await api.get(`/api/books/${bookId}`);
    expect(one.status).toBe(200);
    const body = await one.json();
    expect(body).toMatchObject({
      id: bookId,
      segmentCount: 0,
      extracted: false,
    });
    const file = await fetch(body.fileUrl);
    expect(file.status).toBe(200);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  test('size is checked on the server', async () => {
    const api = await signedInOwner();
    expect((await createBook(api, { sizeBytes: MAX_UPLOAD_BYTES + 1 })).status).toBe(400);
    expect((await createBook(api, { sizeBytes: 0 })).status).toBe(400);
    expect((await createBook(api, { sizeBytes: MAX_UPLOAD_BYTES })).status).toBe(201);
  });

  test('format is checked on the server', async () => {
    const api = await signedInOwner();
    expect((await createBook(api, { format: 'mobi' })).status).toBe(400);
  });

  test("another user's book is invisible and unreachable", async () => {
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
        storage_path: `${intruderId}/x.pdf`,
        size_bytes: 10,
      })
      .select('id')
      .single();
    expect(error).toBeNull();

    const api = await signedInOwner();
    expect((await api.get(`/api/books/${row!.id}`)).status).toBe(404);
    expect((await api.del(`/api/books/${row!.id}`)).status).toBe(404);
    const { books } = (await (await api.get('/api/books')).json()) as {
      books: ListItem[];
    };
    expect(books.some((b) => b.id === row!.id)).toBe(false);
    await admin.from('books').delete().eq('id', row!.id);
  });

  test('unknown book is 404', async () => {
    const api = await signedInOwner();
    expect((await api.get('/api/books/00000000-0000-0000-0000-000000000000')).status).toBe(404);
    expect((await api.get('/api/books/not-a-uuid')).status).toBe(404);
  });

  test('DELETE removes the book and its file', async () => {
    const api = await signedInOwner();
    const { bookId, signedUploadUrl } = await (await createBook(api)).json();
    await fetch(signedUploadUrl, {
      method: 'PUT',
      headers: { 'content-type': 'application/pdf' },
      body: new TextEncoder().encode('%PDF-1.4 x'),
    });
    const { fileUrl } = await (await api.get(`/api/books/${bookId}`)).json();
    expect((await fetch(fileUrl)).status).toBe(200);

    expect((await api.del(`/api/books/${bookId}`)).status).toBe(204);
    expect((await api.get(`/api/books/${bookId}`)).status).toBe(404);
    expect((await fetch(fileUrl)).ok).toBe(false);
  });
});

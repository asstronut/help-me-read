import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, test } from 'vitest';
import { apiClient } from '../helpers/api-client';
import { INTRUDER, OWNER, ensureUser } from '../helpers/users';

type ListItem = { id: string; lastOpenedAt: string | null };

async function signedIn(user: { email: string; password: string }) {
  const api = apiClient();
  expect((await api.login(user.email, user.password)).status).toBe(200);
  return api;
}

async function newBook(api: ReturnType<typeof apiClient>, title: string): Promise<string> {
  const res = await api.post('/api/books', { title, author: null, format: 'pdf', sizeBytes: 1234 });
  expect(res.status).toBe(201);
  return (await res.json()).bookId;
}

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  await ensureUser(INTRUDER.email, INTRUDER.password);
});

describe('reading position', () => {
  test('requires a session', async () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expect((await apiClient().get(`/api/books/${id}/position`)).status).toBe(401);
    expect((await apiClient().put(`/api/books/${id}/position`, { page: 1 })).status).toBe(401);
  });

  test('is null before anything is saved, then returns what was saved', async () => {
    const api = await signedIn(OWNER);
    const id = await newBook(api, 'Position Book');
    expect(await (await api.get(`/api/books/${id}/position`)).json()).toEqual({ location: null });

    expect((await api.put(`/api/books/${id}/position`, { page: 2 })).status).toBe(204);
    expect(await (await api.get(`/api/books/${id}/position`)).json()).toEqual({
      location: { page: 2 },
    });

    expect((await api.put(`/api/books/${id}/position`, { cfi: 'epubcfi(/6/4!/4/2)' })).status).toBe(
      204,
    );
    expect(await (await api.get(`/api/books/${id}/position`)).json()).toEqual({
      location: { cfi: 'epubcfi(/6/4!/4/2)' },
    });
  });

  test('saving a position moves the book to the top of the library', async () => {
    const api = await signedIn(OWNER);
    const a = await newBook(api, 'Position A');
    await newBook(api, 'Position B');

    expect((await api.put(`/api/books/${a}/position`, { page: 1 })).status).toBe(204);
    const { books } = (await (await api.get('/api/books')).json()) as { books: ListItem[] };
    expect(books[0].id).toBe(a);
    expect(books[0].lastOpenedAt).not.toBeNull();
  });

  test("another user's book is not found", async () => {
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

    const api = await signedIn(OWNER);
    expect((await api.put(`/api/books/${row!.id}/position`, { page: 3 })).status).toBe(404);
    expect((await api.get(`/api/books/${row!.id}/position`)).status).toBe(404);
    await admin.from('books').delete().eq('id', row!.id);
  });

  test('rejects a malformed location', async () => {
    const api = await signedIn(OWNER);
    const id = await newBook(api, 'Bad Position');
    for (const body of [{ page: 'x' }, { page: 0 }, { page: 1.5 }, {}, { cfi: '' }]) {
      expect((await api.put(`/api/books/${id}/position`, body)).status).toBe(400);
    }
  });
});

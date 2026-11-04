import { beforeAll, describe, expect, test } from 'vitest';
import {
  PDF_SEGMENTS,
  createThread,
  newBook,
  selection,
  signedInOwner,
  type Api,
} from '../helpers/threads';
import { INTRUDER, OWNER, adminClient, ensureUser, userId } from '../helpers/users';

type HighlightView = {
  id: string;
  kind: 'note' | 'thread';
  color: string;
  anchor: unknown;
  threadId: string | null;
  note: string | null;
};

let api: Api;

beforeAll(async () => {
  await ensureUser(OWNER.email, OWNER.password);
  await ensureUser(INTRUDER.email, INTRUDER.password);
  api = await signedInOwner();
});

async function listHighlights(bookId: string): Promise<HighlightView[]> {
  const res = await api.get(`/api/highlights?bookId=${bookId}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { highlights: HighlightView[] }).highlights;
}

async function addNote(bookId: string, color = 'green'): Promise<HighlightView> {
  const res = await api.post('/api/highlights', {
    bookId,
    selection: selection(bookId, 2, 'Final page.', ''),
    color,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as HighlightView;
}

describe('highlights', () => {
  test('a note highlight is created and listed with its anchor', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const created = await addNote(bookId);
    expect(created).toMatchObject({ kind: 'note', color: 'green', threadId: null, note: null });

    const listed = await listHighlights(bookId);
    expect(listed).toEqual([created]);
    expect(listed[0].anchor).toEqual(selection(bookId, 2, 'Final page.', '').anchor);
  });

  test('a thread highlight is listed with its thread', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const { threadId, highlightId } = await createThread(api, {
      bookId,
      action: 'define',
      selection: selection(bookId, 0, 'steep', 'She sat on the bank. The bank was '),
      scope: 'page',
    });
    expect(await listHighlights(bookId)).toEqual([
      expect.objectContaining({ id: highlightId, kind: 'thread', color: 'yellow', threadId }),
    ]);
  });

  test('PATCH changes the colour and the note', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const { id } = await addNote(bookId);

    const res = await api.patch(`/api/highlights/${id}`, { note: 'ok', color: 'pink' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, color: 'pink', note: 'ok' });
    expect((await listHighlights(bookId))[0]).toMatchObject({ color: 'pink', note: 'ok' });
  });

  test('colours outside the four are refused', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const post = await api.post('/api/highlights', {
      bookId,
      selection: selection(bookId, 2, 'Final page.', ''),
      color: 'red',
    });
    expect(post.status).toBe(400);

    const { id } = await addNote(bookId);
    expect((await api.patch(`/api/highlights/${id}`, { color: 'red' })).status).toBe(400);
    expect((await listHighlights(bookId)).map((h) => h.color)).toEqual(['green']);
  });

  test('a selection from another book is refused', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const otherId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const res = await api.post('/api/highlights', {
      bookId,
      selection: selection(otherId, 2, 'Final page.', ''),
      color: 'green',
    });
    expect(res.status).toBe(400);
  });

  test('DELETE removes a note highlight', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const { id } = await addNote(bookId);
    expect((await api.del(`/api/highlights/${id}`)).status).toBe(204);
    expect(await listHighlights(bookId)).toEqual([]);
    expect((await api.del(`/api/highlights/${id}`)).status).toBe(404);
  });

  test('deleting a thread highlight deletes its thread', async () => {
    const bookId = await newBook(api, 'pdf', PDF_SEGMENTS);
    const { threadId, highlightId } = await createThread(api, {
      bookId,
      action: 'define',
      selection: selection(bookId, 0, 'steep', 'She sat on the bank. The bank was '),
      scope: 'page',
    });
    await api.streamText(`/api/threads/${threadId}/chat`, {});

    expect((await api.del(`/api/highlights/${highlightId}`)).status).toBe(204);
    expect((await api.get(`/api/threads/${threadId}`)).status).toBe(404);
    expect(await listHighlights(bookId)).toEqual([]);
  });

  test("another user's highlight is unreachable", async () => {
    const admin = adminClient();
    const intruderId = await userId(INTRUDER.email);
    const { data: book, error: bookError } = await admin
      .from('books')
      .insert({
        owner_id: intruderId,
        title: 'Not Yours',
        format: 'pdf',
        storage_path: `${intruderId}/h.pdf`,
        size_bytes: 10,
      })
      .select('id')
      .single();
    expect(bookError).toBeNull();
    const { data: highlight, error } = await admin
      .from('highlights')
      .insert({
        owner_id: intruderId,
        book_id: book!.id,
        kind: 'note',
        color: 'yellow',
        segment_seq: 0,
        anchor: { format: 'pdf', page: 1, rects: [] },
        quote: 'secret',
      })
      .select('id')
      .single();
    expect(error).toBeNull();

    expect((await api.get(`/api/highlights?bookId=${book!.id}`)).status).toBe(404);
    expect((await api.patch(`/api/highlights/${highlight!.id}`, { note: 'mine' })).status).toBe(404);
    expect((await api.del(`/api/highlights/${highlight!.id}`)).status).toBe(404);
    const post = await api.post('/api/highlights', {
      bookId: book!.id,
      selection: selection(book!.id, 0, 'secret', ''),
      color: 'green',
    });
    expect(post.status).toBe(404);

    const { data: still } = await admin
      .from('highlights')
      .select('note')
      .eq('id', highlight!.id)
      .single();
    expect(still).toEqual({ note: null });
    await admin.from('books').delete().eq('id', book!.id);
  });

  test('unknown or malformed ids are 404', async () => {
    const missing = '00000000-0000-0000-0000-000000000000';
    expect((await api.get(`/api/highlights?bookId=${missing}`)).status).toBe(404);
    expect((await api.get('/api/highlights?bookId=nope')).status).toBe(404);
    expect((await api.patch(`/api/highlights/${missing}`, { note: 'x' })).status).toBe(404);
    expect((await api.patch('/api/highlights/nope', { note: 'x' })).status).toBe(404);
    expect((await api.del('/api/highlights/nope')).status).toBe(404);
  });
});

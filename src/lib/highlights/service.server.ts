import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AnchorSchema, HighlightColorSchema, SelectionSchema } from '@/lib/selection/schema';
import type { Database } from '@/lib/supabase/database.types';
import type { HighlightView } from '@/lib/types';

type Db = SupabaseClient<Database>;

const fail = (status: number, message: string) => Response.json({ message }, { status });
const BOOK_NOT_FOUND = () => fail(404, 'Book not found');
export const HIGHLIGHT_NOT_FOUND = () => fail(404, 'Highlight not found');

const VIEW_COLUMNS = 'id, kind, color, anchor, note, threads(id)';

type Row = {
  id: string;
  kind: string;
  color: string;
  anchor: unknown;
  note: string | null;
  threads: { id: string }[];
};

function toView(row: Row): HighlightView {
  return {
    id: row.id,
    kind: row.kind === 'thread' ? 'thread' : 'note',
    color: HighlightColorSchema.parse(row.color),
    anchor: AnchorSchema.parse(row.anchor),
    threadId: row.threads[0]?.id ?? null,
    note: row.note,
  };
}

async function assertBookVisible(supabase: Db, bookId: string) {
  const { data, error } = await supabase.from('books').select('id').eq('id', bookId).maybeSingle();
  if (error) throw error;
  if (!data) throw BOOK_NOT_FOUND();
}

export async function listHighlights(supabase: Db, bookId: string): Promise<HighlightView[]> {
  await assertBookVisible(supabase, bookId);
  const { data, error } = await supabase
    .from('highlights')
    .select(VIEW_COLUMNS)
    .eq('book_id', bookId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data.map(toView);
}

export const CreateHighlightSchema = z.object({
  bookId: z.uuid(),
  selection: SelectionSchema,
  color: HighlightColorSchema,
});

/** Saves a plain note highlight (no AI) on the selection. Throws a Response on refusal. */
export async function createNoteHighlight(
  supabase: Db,
  { bookId, selection, color }: z.infer<typeof CreateHighlightSchema>,
): Promise<HighlightView> {
  if (selection.bookId !== bookId) throw fail(400, 'The selection belongs to another book');
  await assertBookVisible(supabase, bookId);
  const { data, error } = await supabase
    .from('highlights')
    .insert({
      book_id: bookId,
      kind: 'note',
      color,
      segment_seq: selection.segmentSeq,
      anchor: selection.anchor,
      quote: selection.text,
      prefix: selection.prefix,
    })
    .select(VIEW_COLUMNS)
    .single();
  if (error) throw error;
  return toView(data);
}

export const UpdateHighlightSchema = z
  .object({ color: HighlightColorSchema.optional(), note: z.string().nullable().optional() })
  .refine((u) => u.color !== undefined || u.note !== undefined);

export async function updateHighlight(
  supabase: Db,
  highlightId: string,
  { color, note }: z.infer<typeof UpdateHighlightSchema>,
): Promise<HighlightView> {
  const { data, error } = await supabase
    .from('highlights')
    .update({
      ...(color !== undefined && { color }),
      ...(note !== undefined && { note: note?.trim() || null }),
    })
    .eq('id', highlightId)
    .select(VIEW_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw HIGHLIGHT_NOT_FOUND();
  return toView(data);
}

/** Deletes the highlight; a thread highlight takes its thread and messages with it. */
export async function deleteHighlight(supabase: Db, highlightId: string): Promise<void> {
  const { data, error } = await supabase
    .from('highlights')
    .delete()
    .eq('id', highlightId)
    .select('id');
  if (error) throw error;
  if (data.length === 0) throw HIGHLIGHT_NOT_FOUND();
}

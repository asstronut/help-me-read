import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { AnchorSchema, HighlightColorSchema, SelectionSchema } from '@/lib/selection/schema';
import type { Database } from '@/lib/supabase/database.types';
import { ACTIONS, type HighlightView } from '@/lib/types';

type Db = SupabaseClient<Database>;

const fail = (status: number, message: string) => Response.json({ message }, { status });
const BOOK_NOT_FOUND = () => fail(404, 'Book not found');
export const HIGHLIGHT_NOT_FOUND = () => fail(404, 'Highlight not found');

const VIEW_COLUMNS = 'id, book_id, kind, color, anchor, quote, segment_seq, note, threads(id, action)';

type Row = {
  id: string;
  book_id: string;
  kind: string;
  color: string;
  anchor: unknown;
  quote: string;
  segment_seq: number;
  note: string | null;
  threads: { id: string; action: string }[];
};

const ActionSchema = z.enum(ACTIONS);

/** The labels of the book's segments with these numbers. (A highlight has no foreign key to its segment.) */
async function segmentLabels(supabase: Db, bookId: string, seqs: number[]): Promise<Map<number, string>> {
  if (seqs.length === 0) return new Map();
  const { data, error } = await supabase
    .from('segments')
    .select('seq, label')
    .eq('book_id', bookId)
    .in('seq', [...new Set(seqs)]);
  if (error) throw error;
  return new Map(data.map((s) => [s.seq, s.label]));
}

function toView(row: Row, labels: Map<number, string>): HighlightView {
  const thread = row.threads[0];
  return {
    id: row.id,
    kind: row.kind === 'thread' ? 'thread' : 'note',
    color: HighlightColorSchema.parse(row.color),
    anchor: AnchorSchema.parse(row.anchor),
    quote: row.quote,
    segmentLabel: labels.get(row.segment_seq) ?? null,
    threadId: thread?.id ?? null,
    threadAction: thread ? ActionSchema.parse(thread.action) : null,
    note: row.note,
  };
}

/** Views of one book's highlights, with their segment labels. */
async function toViews(supabase: Db, bookId: string, rows: Row[]): Promise<HighlightView[]> {
  const labels = await segmentLabels(supabase, bookId, rows.map((r) => r.segment_seq));
  return rows.map((r) => toView(r, labels));
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
  return toViews(supabase, bookId, data);
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
  return (await toViews(supabase, bookId, [data]))[0];
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
  return (await toViews(supabase, data.book_id, [data]))[0];
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

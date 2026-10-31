import type { SupabaseClient } from '@supabase/supabase-js';
import { generateText } from 'ai';
import { after } from 'next/server';
import { z } from 'zod';
import { callCostUsd, costReportingOptions, reportedCostUsdOf } from '@/lib/ai/cost';
import { availableModels, resolveModel } from '@/lib/ai/models';
import { buildVocabMeaningPrompt } from '@/lib/ai/prompts';
import { getLanguageModel } from '@/lib/ai/registry.server';
import { assertWithinCap } from '@/lib/ai/spend.server';
import { AnchorSchema, SelectionSchema } from '@/lib/selection/schema';
import type { Database } from '@/lib/supabase/database.types';
import type { TestControls } from '@/lib/test-controls.server';
import { EXPLANATION_LANGUAGE, settingsModels } from '@/lib/threads/service.server';
import type { Anchor, ReaderSelection } from '@/lib/types';
import { sentenceAround } from './sentence';

type Db = SupabaseClient<Database>;

export type VocabEntryView = {
  id: string;
  term: string;
  sentence: string;
  /** null until a meaning is known. */
  meaning: string | null;
  anchor: Anchor | null;
  /** null once the book is deleted. */
  bookId: string | null;
  bookTitle: string | null;
  createdAt: string;
};

const fail = (status: number, message: string) => Response.json({ message }, { status });

const COLUMNS = 'id, term, sentence, meaning, anchor, book_id, created_at, books(title)';

type Row = {
  id: string;
  term: string;
  sentence: string;
  meaning: string;
  anchor: unknown;
  book_id: string | null;
  created_at: string;
  books: { title: string } | null;
};

function toView(row: Row): VocabEntryView {
  const anchor = AnchorSchema.safeParse(row.anchor);
  return {
    id: row.id,
    term: row.term,
    sentence: row.sentence,
    // The column holds '' while the meaning is unknown.
    meaning: row.meaning === '' ? null : row.meaning,
    anchor: anchor.success ? anchor.data : null,
    bookId: row.book_id,
    bookTitle: row.books?.title ?? null,
    createdAt: row.created_at,
  };
}

// ---------- saving ----------

export const SaveVocabSchema = z.object({ bookId: z.uuid(), selection: SelectionSchema });
export type SaveVocabInput = { bookId: string; selection: ReaderSelection };

/** The first complete answer of a Define thread on the same words in the same place, if any. */
async function defineAnswer(supabase: Db, bookId: string, selection: ReaderSelection) {
  const { data: threads, error } = await supabase
    .from('threads')
    .select('id, highlights!inner(book_id, segment_seq, quote)')
    .eq('action', 'define')
    .eq('highlights.book_id', bookId)
    .eq('highlights.segment_seq', selection.segmentSeq)
    .eq('highlights.quote', selection.text);
  if (error) throw error;
  if (threads.length === 0) return null;

  const { data: answer, error: answerError } = await supabase
    .from('messages')
    .select('content')
    .in(
      'thread_id',
      threads.map((t) => t.id),
    )
    .eq('role', 'assistant')
    .eq('status', 'complete')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (answerError) throw answerError;
  return answer?.content ?? null;
}

async function segmentParagraphs(supabase: Db, bookId: string, seq: number): Promise<string[]> {
  const { data, error } = await supabase
    .from('segments')
    .select('paragraphs')
    .eq('book_id', bookId)
    .eq('seq', seq)
    .maybeSingle();
  if (error) throw error;
  return data?.paragraphs ?? [];
}

/**
 * Saves the term, its sentence and anchor. The meaning is a Define thread's answer on the same
 * words when there is one; otherwise it is filled after the response by one short call.
 */
export async function saveVocab(
  supabase: Db,
  { bookId, selection }: SaveVocabInput,
  controls: TestControls,
): Promise<VocabEntryView> {
  if (selection.bookId !== bookId) throw fail(400, 'The selection belongs to another book');
  const { data: book, error: bookError } = await supabase
    .from('books')
    .select('id')
    .eq('id', bookId)
    .maybeSingle();
  if (bookError) throw bookError;
  if (!book) throw fail(404, 'Book not found');

  const term = selection.text.trim();
  const paragraphs = await segmentParagraphs(supabase, bookId, selection.segmentSeq);
  const sentence = sentenceAround(paragraphs, selection.text, selection.prefix);
  const meaning = await defineAnswer(supabase, bookId, selection);

  const { data, error } = await supabase
    .from('vocab_entries')
    .insert({ book_id: bookId, term, sentence, meaning: meaning ?? '', anchor: selection.anchor })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  const entry = toView(data);

  if (entry.meaning === null) {
    after(() =>
      fillMeaning(supabase, entry, controls).catch((e: unknown) => {
        console.error('Filling the vocab meaning failed', e);
      }),
    );
  }
  return entry;
}

/** Asks the Define model for a one-line meaning and charges the call. Within the spend cap only. */
async function fillMeaning(supabase: Db, entry: VocabEntryView, controls: TestControls) {
  const model = resolveModel('define', await settingsModels(supabase), availableModels(process.env));
  const { instructions, prompt } = buildVocabMeaningPrompt(
    entry.term,
    entry.sentence,
    EXPLANATION_LANGUAGE,
  );
  try {
    await assertWithinCap(supabase, model, `${instructions}\n\n${prompt}`.length, controls.now);
  } catch (e) {
    if (e instanceof Response) return; // at the cap the meaning stays empty
    throw e;
  }

  const result = await generateText({
    model: getLanguageModel(model.id, controls),
    instructions,
    prompt,
    providerOptions: costReportingOptions(model),
  });
  const usage = {
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
  };
  const { error: usageError } = await supabase.from('usage_events').insert({
    model_id: model.id,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cost_usd: callCostUsd(model, usage, reportedCostUsdOf(result.providerMetadata)),
  });
  if (usageError) throw usageError;

  // A meaning set in the meantime is kept.
  const { error } = await supabase
    .from('vocab_entries')
    .update({ meaning: result.text.trim() })
    .eq('id', entry.id)
    .eq('meaning', '');
  if (error) throw error;
}

// ---------- reading and deleting ----------

/** Entries newest first; `q` matches term or meaning, ignoring case. */
export async function listVocab(supabase: Db, q: string): Promise<VocabEntryView[]> {
  const { data, error } = await supabase
    .from('vocab_entries')
    .select(COLUMNS)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const needle = q.trim().toLowerCase();
  return data
    .map(toView)
    .filter(
      (e) =>
        needle === '' ||
        e.term.toLowerCase().includes(needle) ||
        (e.meaning?.toLowerCase().includes(needle) ?? false),
    );
}

export async function deleteVocab(supabase: Db, entryId: string): Promise<void> {
  const { error } = await supabase.from('vocab_entries').delete().eq('id', entryId);
  if (error) throw error;
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { streamText } from 'ai';
import { z } from 'zod';
import { availableModels, resolveModel, type ModelInfo } from '@/lib/ai/models';
import { buildFirstUserMessage, buildSystemPrompt } from '@/lib/ai/prompts';
import { getLanguageModel } from '@/lib/ai/registry.server';
import { buildContext } from '@/lib/context/build';
import type { Database } from '@/lib/supabase/database.types';
import type { TestControls } from '@/lib/test-controls.server';
import {
  MAX_SELECTION_WORDS,
  type Action,
  type BookFormat,
  type ContextScope,
  type ReaderSelection,
  type Segment,
} from '@/lib/types';

type Db = SupabaseClient<Database>;

const ACTIONS = ['translate', 'define', 'explain', 'simplify', 'ask'] as const;
// Until settings exist (Task 13) every answer is in English.
const EXPLANATION_LANGUAGE = 'English';

const fail = (status: number, message: string) => Response.json({ message }, { status });
const BOOK_NOT_FOUND = () => fail(404, 'Book not found');
export const THREAD_NOT_FOUND = () => fail(404, 'Thread not found');

// ---------- creating a thread ----------

const RectSchema = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const AnchorSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('pdf'), page: z.number().int().min(1), rects: z.array(RectSchema) }),
  z.object({ format: z.literal('epub'), cfi: z.string().min(1) }),
]);
const SelectionSchema = z.object({
  bookId: z.uuid(),
  segmentSeq: z.number().int().min(0),
  text: z.string().refine((t) => t.trim() !== ''),
  prefix: z.string(),
  anchor: AnchorSchema,
});
export const CreateThreadSchema = z.object({
  bookId: z.uuid(),
  action: z.enum(ACTIONS),
  selection: SelectionSchema,
  scope: z.enum(['page', 'book']),
});
export type CreateThreadInput = {
  bookId: string;
  action: Action;
  selection: ReaderSelection;
  scope: ContextScope;
};

const wordCount = (text: string) => text.trim().split(/\s+/).length;

/** Validates the request, then saves a yellow thread highlight on the selection and its thread. Throws a Response on refusal. */
export async function createThread(
  supabase: Db,
  input: CreateThreadInput,
): Promise<{ threadId: string; highlightId: string }> {
  const { bookId, action, selection, scope } = input;
  if (selection.bookId !== bookId) throw fail(400, 'The selection belongs to another book');
  if (scope === 'book' && action !== 'ask') {
    throw fail(400, 'Only Ask can use the whole book');
  }
  if (wordCount(selection.text) > MAX_SELECTION_WORDS) {
    throw fail(400, `Select at most ${MAX_SELECTION_WORDS} words`);
  }

  const { data: book, error: bookError } = await supabase
    .from('books')
    .select('id, extracted_at')
    .eq('id', bookId)
    .maybeSingle();
  if (bookError) throw bookError;
  if (!book) throw BOOK_NOT_FOUND();
  if (!book.extracted_at) throw fail(409, "This book's text is still being prepared.");

  const { data: segment, error: segmentError } = await supabase
    .from('segments')
    .select('seq')
    .eq('book_id', bookId)
    .eq('seq', selection.segmentSeq)
    .maybeSingle();
  if (segmentError) throw segmentError;
  if (!segment) throw fail(400, 'The selection is in an unknown segment');

  const { data: highlight, error: highlightError } = await supabase
    .from('highlights')
    .insert({
      book_id: bookId,
      kind: 'thread',
      color: 'yellow',
      segment_seq: selection.segmentSeq,
      anchor: selection.anchor,
      quote: selection.text,
      prefix: selection.prefix,
    })
    .select('id')
    .single();
  if (highlightError) throw highlightError;

  const { data: thread, error: threadError } = await supabase
    .from('threads')
    .insert({ highlight_id: highlight.id, action, context_scope: scope })
    .select('id')
    .single();
  if (threadError) {
    await supabase.from('highlights').delete().eq('id', highlight.id);
    throw threadError;
  }
  return { threadId: thread.id, highlightId: highlight.id };
}

// ---------- reading a thread ----------

type ThreadRecord = {
  id: string;
  action: Action;
  scope: ContextScope;
  highlightId: string;
  bookId: string;
  segmentSeq: number;
  quote: string;
  prefix: string;
  book: { title: string; author: string | null; format: BookFormat };
};

export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  modelId: string | null;
  status: 'complete' | 'failed';
  costUsd: number;
};

async function loadThread(supabase: Db, threadId: string): Promise<ThreadRecord> {
  const { data, error } = await supabase
    .from('threads')
    .select(
      'id, action, context_scope, highlight_id, highlights(book_id, segment_seq, quote, prefix, books(title, author, format))',
    )
    .eq('id', threadId)
    .maybeSingle();
  if (error) throw error;
  const highlight = data?.highlights;
  const book = highlight?.books;
  if (!data || !highlight || !book) throw THREAD_NOT_FOUND();
  return {
    id: data.id,
    action: data.action as Action,
    scope: data.context_scope as ContextScope,
    highlightId: data.highlight_id,
    bookId: highlight.book_id,
    segmentSeq: highlight.segment_seq,
    quote: highlight.quote,
    prefix: highlight.prefix,
    book: { title: book.title, author: book.author, format: book.format as BookFormat },
  };
}

async function loadMessages(supabase: Db, threadId: string): Promise<StoredMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, role, content, model_id, status, cost_usd')
    .eq('thread_id', threadId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data.map((m) => ({
    id: m.id,
    role: m.role as StoredMessage['role'],
    content: m.content,
    modelId: m.model_id,
    status: m.status as StoredMessage['status'],
    costUsd: Number(m.cost_usd),
  }));
}

export async function getThread(supabase: Db, threadId: string) {
  const thread = await loadThread(supabase, threadId);
  return {
    thread: {
      id: thread.id,
      action: thread.action,
      scope: thread.scope,
      highlightId: thread.highlightId,
    },
    messages: await loadMessages(supabase, threadId),
  };
}

// ---------- answering ----------

export const ChatSchema = z.object({
  text: z.string().optional(),
  modelId: z.string().optional(),
});
export type ChatInput = z.infer<typeof ChatSchema>;

const SettingsModelsSchema = z.partialRecord(z.enum(ACTIONS), z.string());

async function settingsModels(supabase: Db): Promise<Partial<Record<Action, string>>> {
  const { data, error } = await supabase.from('settings').select('action_models').maybeSingle();
  if (error) throw error;
  const parsed = SettingsModelsSchema.safeParse(data?.action_models ?? {});
  return parsed.success ? parsed.data : {};
}

async function chooseModel(supabase: Db, action: Action, modelId?: string): Promise<ModelInfo> {
  const available = availableModels(process.env);
  if (modelId === undefined) return resolveModel(action, await settingsModels(supabase), available);
  const chosen = available.find((m) => m.id === modelId);
  if (!chosen) throw fail(400, 'That model is not available');
  return chosen;
}

async function loadContextSegments(supabase: Db, thread: ThreadRecord): Promise<Segment[]> {
  let query = supabase
    .from('segments')
    .select('seq, label, paragraphs')
    .eq('book_id', thread.bookId)
    .order('seq', { ascending: true });
  if (thread.scope === 'page') query = query.eq('seq', thread.segmentSeq);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

/** The first user message, rebuilt from stored data: book, location, context and selection (and the question for Ask). */
async function firstUserMessage(
  supabase: Db,
  thread: ThreadRecord,
  question: string | undefined,
): Promise<string> {
  const segments = await loadContextSegments(supabase, thread);
  const context = buildContext({
    format: thread.book.format,
    scope: thread.scope,
    segments,
    segmentSeq: thread.segmentSeq,
    text: thread.quote,
    prefix: thread.prefix,
  });
  const label = segments.find((s) => s.seq === thread.segmentSeq)?.label ?? '';
  return buildFirstUserMessage({
    action: thread.action,
    selection: { text: thread.quote },
    context,
    meta: { title: thread.book.title, author: thread.book.author, segmentLabel: label },
    question,
  });
}

async function saveMessage(
  supabase: Db,
  threadId: string,
  message: {
    role: 'user' | 'assistant';
    content: string;
    modelId?: string;
    inputTokens?: number;
    outputTokens?: number;
  },
) {
  const { error } = await supabase.from('messages').insert({
    thread_id: threadId,
    role: message.role,
    content: message.content,
    model_id: message.modelId ?? null,
    status: 'complete',
    input_tokens: message.inputTokens ?? 0,
    output_tokens: message.outputTokens ?? 0,
  });
  if (error) throw error;
}

/**
 * Streams the thread's next answer as an AI SDK UI message stream. The prompt is rebuilt from stored
 * data on every turn; client history is never used. The answer is saved when the stream finishes.
 */
export async function streamAnswer(
  supabase: Db,
  threadId: string,
  input: ChatInput,
  controls: TestControls,
): Promise<Response> {
  const thread = await loadThread(supabase, threadId);
  const history = await loadMessages(supabase, threadId);
  if (history.length > 0) throw fail(409, 'This thread already has an answer.');

  const question = input.text?.trim();
  if (thread.action === 'ask' && !question) throw fail(400, 'Ask needs a question');
  if (thread.action !== 'ask' && input.text !== undefined) {
    throw fail(400, 'Only Ask takes a question on the first turn');
  }

  const model = await chooseModel(supabase, thread.action, input.modelId);
  const instructions = buildSystemPrompt(thread.action, EXPLANATION_LANGUAGE);
  const firstMessage = await firstUserMessage(supabase, thread, question);
  if (question) await saveMessage(supabase, threadId, { role: 'user', content: question });

  const result = streamText({
    model: getLanguageModel(model.id, controls),
    instructions,
    messages: [{ role: 'user', content: firstMessage }],
    onEnd: async ({ text, totalUsage }) => {
      await saveMessage(supabase, threadId, {
        role: 'assistant',
        content: text,
        modelId: model.id,
        inputTokens: totalUsage.inputTokens,
        outputTokens: totalUsage.outputTokens,
      });
    },
  });
  return result.toUIMessageStreamResponse();
}

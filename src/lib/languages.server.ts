import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { defaultLanguages, getSettings } from '@/lib/settings/settings.server';
import type { Database } from '@/lib/supabase/database.types';
import {
  LanguageNameSchema,
  bookLanguages,
  languageError,
  type BookLanguages,
  type LanguageOverrides,
} from '@/lib/languages';

type Db = SupabaseClient<Database>;

/** The languages a Book uses (its overrides over the current defaults); null when there is no such Book. */
export async function getBookLanguages(supabase: Db, bookId: string): Promise<BookLanguages | null> {
  const { data, error } = await supabase
    .from('books')
    .select('translation_language_override, answer_language_override')
    .eq('id', bookId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const defaults = defaultLanguages(await getSettings(supabase));
  return bookLanguages(defaults, {
    translation: data.translation_language_override,
    answer: data.answer_language_override,
  });
}

const OverridesPatchSchema = z.object({
  translationLanguageOverride: LanguageNameSchema.nullable().optional(),
  answerLanguageOverride: LanguageNameSchema.nullable().optional(),
});

/** The overrides to change (null clears one; one left out stays), or a message naming the first invalid field. */
export function validateOverridesPatch(
  input: unknown,
): { patch: Partial<LanguageOverrides> } | { error: string } {
  const parsed = OverridesPatchSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === 'translationLanguageOverride') return { error: languageError('translation') };
    if (field === 'answerLanguageOverride') return { error: languageError('answer') };
    return { error: 'Send translationLanguageOverride and answerLanguageOverride, each a language or null' };
  }
  const { translationLanguageOverride, answerLanguageOverride } = parsed.data;
  return {
    patch: {
      ...(translationLanguageOverride !== undefined && { translation: translationLanguageOverride }),
      ...(answerLanguageOverride !== undefined && { answer: answerLanguageOverride }),
    },
  };
}

/** Changes the Book's overrides and returns its languages; null when there is no such Book. */
export async function saveBookOverrides(
  supabase: Db,
  bookId: string,
  patch: Partial<LanguageOverrides>,
): Promise<BookLanguages | null> {
  const columns = {
    ...(patch.translation !== undefined && { translation_language_override: patch.translation }),
    ...(patch.answer !== undefined && { answer_language_override: patch.answer }),
  };
  if (Object.keys(columns).length > 0) {
    const { data, error } = await supabase
      .from('books')
      .update(columns)
      .eq('id', bookId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
  }
  return getBookLanguages(supabase, bookId);
}

/** A Book's languages as the book API names them. */
export function bookLanguagesJson({ overrides, effective }: BookLanguages) {
  return {
    translationLanguageOverride: overrides.translation,
    answerLanguageOverride: overrides.answer,
    translationLanguage: effective.translation,
    answerLanguage: effective.answer,
  };
}

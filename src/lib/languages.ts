import { z } from 'zod';

/** The two languages an Action works in (see GLOSSARY.md). */
export type Languages = { translation: string; answer: string };

/** What the reader sees each language called, in the pickers and in validation messages. */
export const LANGUAGE_LABELS: Record<keyof Languages, string> = {
  translation: 'Translate into',
  answer: 'Answer in',
};

export const COMMON_LANGUAGES: readonly string[] = [
  'English',
  'Indonesian',
  'Spanish',
  'French',
  'German',
  'Japanese',
  'Chinese',
  'Arabic',
];

export const LanguageNameSchema = z.string().trim().min(1).max(40);

export const languageError = (field: keyof Languages) =>
  `${LANGUAGE_LABELS[field]} must be 1 to 40 characters`;

/** A Book's own choice for each language; null follows the Default language. */
export type LanguageOverrides = { translation: string | null; answer: string | null };

/** The one rule for which languages a Book uses: its own override, else the default. */
export function resolveLanguages(defaults: Languages, overrides: LanguageOverrides): Languages {
  return {
    translation: overrides.translation ?? defaults.translation,
    answer: overrides.answer ?? defaults.answer,
  };
}

/** A Book's languages: what it uses now, and what that comes from. */
export type BookLanguages = {
  effective: Languages;
  overrides: LanguageOverrides;
  defaults: Languages;
};

export function bookLanguages(defaults: Languages, overrides: LanguageOverrides): BookLanguages {
  return { effective: resolveLanguages(defaults, overrides), overrides, defaults };
}

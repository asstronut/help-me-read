-- One "explanation language" becomes two: the Translation language (what Translate turns the
-- selection into, and what a Vocab meaning is written in) and the Answer language (what Define,
-- Explain, Simplify and Ask answer in). Each has a default in settings and an optional override
-- per book; a thread keeps the pair it started with.

alter table public.settings
  add column translation_language text not null default 'English'
    check (char_length(translation_language) between 1 and 40),
  add column answer_language text not null default 'English'
    check (char_length(answer_language) between 1 and 40);

-- An existing reader's one language becomes both, so nothing changes until they pick something new.
update public.settings
set translation_language = explanation_language,
    answer_language = explanation_language;

-- Null means the book follows the default.
alter table public.books
  add column translation_language_override text
    check (char_length(translation_language_override) between 1 and 40),
  add column answer_language_override text
    check (char_length(answer_language_override) between 1 and 40);

alter table public.threads
  add column translation_language text,
  add column answer_language text;

-- An existing thread was answered in its owner's explanation language (English without settings).
update public.threads t
set translation_language = coalesce(
      (select s.explanation_language from public.settings s where s.owner_id = t.owner_id),
      'English'),
    answer_language = coalesce(
      (select s.explanation_language from public.settings s where s.owner_id = t.owner_id),
      'English');

alter table public.threads
  alter column translation_language set not null,
  alter column answer_language set not null,
  add check (char_length(translation_language) between 1 and 40),
  add check (char_length(answer_language) between 1 and 40);

alter table public.settings drop column explanation_language;

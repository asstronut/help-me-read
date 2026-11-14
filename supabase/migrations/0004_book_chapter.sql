-- The chapter the reader was in when they last left a book, shown in the Library beside the author:
-- the same label the reader's top bar shows. Null when unknown, or when the book's contents have no
-- entry for that place.
alter table public.books
  add column chapter_label text check (char_length(chapter_label) between 1 and 200);

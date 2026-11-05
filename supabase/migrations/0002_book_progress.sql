-- How far through each book the reader is, shown in the Library: a fraction from 0 to 1, the same
-- number the reader's progress footer shows (PDF: page / page count; EPUB: foliate-js's fraction).
-- Null until the book is first read.
alter table public.books
  add column progress real check (progress >= 0 and progress <= 1);

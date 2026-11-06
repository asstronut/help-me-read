import type { Database } from '@/lib/supabase/database.types';
import type { BookFormat } from '@/lib/types';

export type BookRow = Database['public']['Tables']['books']['Row'];

export type BookItem = {
  id: string;
  title: string;
  author: string | null;
  format: BookFormat;
  extracted: boolean;
  lastOpenedAt: string | null;
  /** How far through the book the reader is, 0 to 1; null until it is first read. */
  progress: number | null;
};

export const BOOK_COLUMNS =
  'id, title, author, format, storage_path, segment_count, extracted_at, last_opened_at, progress';

export function toBookItem(
  row: Pick<BookRow, 'id' | 'title' | 'author' | 'format' | 'extracted_at' | 'last_opened_at' | 'progress'>,
): BookItem {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    format: row.format as BookFormat,
    extracted: row.extracted_at !== null,
    lastOpenedAt: row.last_opened_at,
    progress: row.progress,
  };
}

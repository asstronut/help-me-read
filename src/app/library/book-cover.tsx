import type { BookItem } from '@/lib/books/book-item';
import { cn } from '@/components/ui/cn';

// Cover colours, all theme tokens, so each theme gets its own set of covers.
const COVERS = [
  'bg-ink text-bg',
  'bg-accent text-bg',
  'bg-chip text-ink',
  'bg-accent-tint text-ink',
  'border border-rule bg-panel text-ink',
];

/** The same book always gets the same cover colours. */
export function coverClasses(bookId: string): string {
  let sum = 0;
  for (const ch of bookId) sum += ch.charCodeAt(0);
  return COVERS[sum % COVERS.length];
}

/** "38%", or "New" for a book not read yet. */
export function progressLabel(progress: number | null): string {
  return progress === null ? 'New' : `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%`;
}

/** A plain cover drawn from the book's title (and author, when `withAuthor`), 2:3 like a book. */
export function BookCover({
  book,
  withAuthor = false,
  className,
}: {
  book: Pick<BookItem, 'id' | 'title' | 'author'>;
  withAuthor?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex aspect-[2/3] flex-col justify-between overflow-hidden rounded-[3px_6px_6px_3px] px-3 py-3.5',
        coverClasses(book.id),
        className,
      )}
    >
      <span className="line-clamp-6 font-serif text-base leading-tight hyphens-auto">{book.title}</span>
      {withAuthor && book.author && (
        <span className="line-clamp-2 text-[11px] tracking-[0.08em] uppercase opacity-85">{book.author}</span>
      )}
    </span>
  );
}

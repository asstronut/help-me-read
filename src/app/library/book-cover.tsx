import type { BookItem } from '@/lib/books/book-item';
import { cn } from '@/components/ui/cn';

// Cover colours, all theme tokens, so each theme gets its own set of covers. The pale
// ones sit close to the page background, so they carry a hairline border to stand out.
const COVERS = [
  'bg-ink text-bg',
  'bg-accent text-bg',
  'border border-rule bg-chip text-ink',
  'border border-rule bg-accent-tint text-ink',
  'border border-rule bg-panel text-ink',
];

/** FNV-1a, so IDs that differ by a character or two still land on different covers. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The same book always gets the same cover colours. */
export function coverClasses(bookId: string): string {
  return COVERS[hash(bookId) % COVERS.length];
}

/** "38%", or "New" for a book not read yet. */
export function progressLabel(progress: number | null): string {
  return progress === null ? 'New' : `${Math.round(Math.min(Math.max(progress, 0), 1) * 100)}%`;
}

/** A plain cover drawn from the book's title and author, 2:3 like a book. */
export function BookCover({
  book,
  className,
}: {
  book: Pick<BookItem, 'id' | 'title' | 'author'>;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'relative flex aspect-[2/3] flex-col justify-between overflow-hidden rounded-[3px_6px_6px_3px] py-3.5 pr-3 pl-5',
        // The spine: a darker band down the left edge (the shadow token laid twice, so it shows
        // on the dark covers too), and a crease in the text colour where it meets the cover.
        'before:absolute before:inset-y-0 before:left-0 before:w-2 before:bg-shadow before:shadow-[inset_0_0_0_1rem_var(--shadow)]',
        'after:absolute after:inset-y-0 after:left-2 after:w-px after:bg-current after:opacity-15',
        coverClasses(book.id),
        className,
      )}
    >
      {/* The right padding keeps the title clear of the ⋯ button in the cover's corner. */}
      <span className="line-clamp-6 pr-6 font-serif text-base leading-tight hyphens-auto">{book.title}</span>
      {book.author && <span className="line-clamp-2 text-xs opacity-80">{book.author}</span>}
    </span>
  );
}

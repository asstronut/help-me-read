import { Suspense } from 'react';
import { ReadView } from '@/components/reader/ReadView';
import { AnchorSchema } from '@/lib/selection/schema';
import type { Anchor } from '@/lib/types';

type PageProps = {
  params: Promise<{ bookId: string }>;
  searchParams: Promise<{ thread?: string | string[]; at?: string | string[] }>;
};

/** The anchor in `?at=<url-encoded anchor JSON>`, or null when it is missing or malformed. */
function parseAnchor(at: string | string[] | undefined): Anchor | null {
  if (typeof at !== 'string') return null;
  try {
    const parsed = AnchorSchema.safeParse(JSON.parse(at));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function Reader({ params, searchParams }: PageProps) {
  const { bookId } = await params;
  const { thread, at } = await searchParams;
  // `?thread=<id>` reopens that thread beside the book; `?at=` opens the book at an anchor.
  return (
    <ReadView
      bookId={bookId}
      threadId={typeof thread === 'string' ? thread : null}
      at={parseAnchor(at)}
    />
  );
}

export default function ReadPage(props: PageProps) {
  return (
    <Suspense fallback={<p className="p-4 text-sm opacity-70">Loading…</p>}>
      <Reader {...props} />
    </Suspense>
  );
}
